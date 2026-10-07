import { GameStatsResult } from '../games/game-stats'
import { getMapDisplayName, getMapKey, MapFamily } from '../games/map-family'
import { CHECKPOINT_MINUTES, GameMetrics, GameShape, PlayerMetrics } from '../games/player-metrics'
import { isMyPlayerName } from '../games/player-names'
import { ALL_ASSIGNED_RACE_CHARS, AssignedRaceChar } from '../races'
import { DEFAULT_EAPM_FLOOR } from './coach'
import { findMe, getMyResult, getSidesOf, isTeamGame, splitsByMap } from './player-games'

/** How many of the latest games the recent results show. */
export const RECENT_GAMES = 20
/** The most games the trends can show. */
export const TREND_GAMES = 100
/** How many teammates, and how many opponents, are listed. */
const MAX_PEOPLE = 8

export type MyStatsRange = '7d' | '30d' | 'all'
export type MyStatsShape = Exclude<GameShape, 'other'>

export interface MyStatsQuery {
  names: string[]
  range: MyStatsRange
  shape?: MyStatsShape
  race?: AssignedRaceChar
  /** Only used in 1v1. */
  opponentRace?: AssignedRaceChar
  /** Only used in game types that split by map, see `splitsByMap`. */
  mapFamily?: MapFamily
  /** The EAPM other players need for the comparisons to count them. */
  eapmFloor?: number
}

/** A game's metrics along with when it was played. */
export interface DatedGameMetrics extends GameMetrics {
  gameTimeMs: number
}

/** Games, and how many of them were won and lost. Games without a result count in neither. */
export interface WinLoss {
  games: number
  wins: number
  losses: number
}

/** An average of a number over the games that had it. */
export interface Average {
  value: number
  games: number
}

export interface MyStatsGame {
  gameId: string
  gameTimeMs: number
  mapName: string
  shape: GameShape
  result: GameStatsResult
  race?: AssignedRaceChar
  /** The races of the user's teammates and of everyone playing against them. */
  teammateRaces: AssignedRaceChar[]
  opponentRaces: AssignedRaceChar[]
  durationMs: number
  apm?: number
  eapm?: number
  /** Numbers for the trends, missing when the game didn't last long enough to have them. */
  workers6?: number
  income6?: number
  bankMid?: number
  /** The share of the game spent supply blocked, after the first 3 minutes. */
  supplyBlockedShare?: number
}

export interface MatchupRow extends WinLoss {
  /** `other` gathers games without two even teams or a free for all, like 2v1 or 3v3v2. */
  shape: GameShape
  /** In 1v1, the races on each side. */
  race?: AssignedRaceChar
  opponentRace?: AssignedRaceChar
  apm?: number
  durationMs?: number
}

export interface LengthRow extends WinLoss {
  /** The longest game in this group, in minutes, or undefined for the longest games. */
  maxMinutes?: number
}

export interface PersonRow extends WinLoss {
  name: string
  /** Every race they played in these games, the one they played most first. */
  races: Array<{ race: AssignedRaceChar; games: number }>
  relation: 'teammate' | 'opponent'
}

export interface MapRow extends WinLoss {
  /**
   * The map's name without its version, as played most, or for money maps, the first name it was
   * seen under.
   */
  mapName: string
  family: MapFamily
}

export interface MacroAverages {
  workers6?: Average
  workers10?: Average
  income6?: Average
  income10?: Average
  supply100Ms?: Average
  supply150Ms?: Average
  bankMid?: Average
  supplyBlockedShare?: Average
  armyKilled?: Average
  armyLost?: Average
}

export interface TeamStats {
  byTeamRaces: Array<WinLoss & { races: AssignedRaceChar[] }>
  incomeShare?: Average
  killShare?: Average
  /** Losses where the user was the first of their team out. */
  firstOutLosses: number
  losses: number
}

export interface MyStatsResult {
  /** Analyzed games of the user's that match the query. */
  games: number
  record: WinLoss
  apm?: Average
  eapm?: Average
  durationMs?: Average
  /** The latest games, oldest first. */
  recent: MyStatsGame[]
  /** The latest games for the trends, oldest first, up to {@link TREND_GAMES}. */
  trend: MyStatsGame[]
  byMatchup: MatchupRow[]
  byLength: LengthRow[]
  macro: MacroAverages
  /**
   * The same numbers for other players in these kinds of games: the same game type, race and
   * opponent race as the filters, at or above the EAPM floor.
   */
  macroOthers: MacroAverages
  /** How many other players' games {@link macroOthers} comes from. */
  othersGames: number
  /** The people the user played with most, then against most. */
  teammates: PersonRow[]
  opponents: PersonRow[]
  maps: MapRow[]
  /**
   * Team games summed up for every race the user played in them, and for any race. The page can
   * narrow this panel down without changing the rest.
   */
  team?: Partial<Record<'any' | AssignedRaceChar, TeamStats>>
}

/** How far back each range reaches. `all` has no limit. */
export const RANGE_MS: Readonly<Partial<Record<MyStatsRange, number>>> = {
  '7d': 7 * 24 * 60 * 60_000,
  '30d': 30 * 24 * 60 * 60_000,
}

const LENGTH_GROUPS_MINUTES = [8, 15, 25]

function tally(record: WinLoss, result: GameStatsResult) {
  record.games += 1
  if (result === 'win') {
    record.wins += 1
  } else if (result === 'loss') {
    record.losses += 1
  }
}

function emptyRecord(): WinLoss {
  return { games: 0, wins: 0, losses: 0 }
}

class Averager {
  private total = 0
  private count = 0

  add(value: number | null | undefined) {
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      this.total += value
      this.count += 1
    }
  }

  get(): Average | undefined {
    return this.count ? { value: this.total / this.count, games: this.count } : undefined
  }
}

interface MyGame {
  game: DatedGameMetrics
  me: PlayerMetrics
  result: GameStatsResult
  teammates: PlayerMetrics[]
  opponents: PlayerMetrics[]
}

function toMyGame(game: DatedGameMetrics, names: ReadonlyArray<string>): MyGame | undefined {
  const me = findMe(game, names)
  if (!me) {
    return undefined
  }
  return { game, me, result: getMyResult(game, me, names), ...getSidesOf(game, me) }
}

function isInRange(game: DatedGameMetrics, range: MyStatsRange, nowMs: number) {
  const rangeMs = RANGE_MS[range]
  return rangeMs === undefined || game.gameTimeMs >= nowMs - rangeMs
}

function matchesQuery(g: MyGame, query: MyStatsQuery, nowMs: number) {
  if (!isInRange(g.game, query.range, nowMs)) {
    return false
  }
  if (query.shape && g.game.shape !== query.shape) {
    return false
  }
  if (query.mapFamily && splitsByMap(query.shape) && g.game.mapFamily !== query.mapFamily) {
    return false
  }
  if (query.race && g.me.race !== query.race) {
    return false
  }
  if (
    query.opponentRace &&
    (g.game.shape !== '1v1' || g.opponents[0]?.race !== query.opponentRace)
  ) {
    return false
  }
  return true
}

function races(players: ReadonlyArray<PlayerMetrics>) {
  return players.flatMap(p => (p.race ? [p.race] : [])).sort()
}

function toGame({ game, me, result, teammates, opponents }: MyGame): MyStatsGame {
  return {
    gameId: game.gameId,
    gameTimeMs: game.gameTimeMs,
    mapName: game.mapName,
    shape: game.shape,
    result,
    race: me.race,
    teammateRaces: races(teammates),
    opponentRaces: races(opponents),
    durationMs: game.durationMs,
    apm: me.apm,
    eapm: me.eapm,
    workers6: me.workers[CHECKPOINT_MINUTES.indexOf(6)] ?? undefined,
    income6: me.income[CHECKPOINT_MINUTES.indexOf(6)] ?? undefined,
    bankMid: me.bank[1] ?? undefined,
    supplyBlockedShare: me.supplyBlockedShare ?? undefined,
  }
}

function getMatchupRows(games: ReadonlyArray<MyGame>): MatchupRow[] {
  const rows = new Map<string, MatchupRow & { apmAverage: Averager; length: Averager }>()
  for (const g of games) {
    const oneVsOne = g.game.shape === '1v1'
    const race = oneVsOne ? g.me.race : undefined
    const opponentRace = oneVsOne ? g.opponents[0]?.race : undefined
    const key = `${g.game.shape}:${race ?? ''}:${opponentRace ?? ''}`
    let row = rows.get(key)
    if (!row) {
      row = {
        ...emptyRecord(),
        shape: g.game.shape,
        race,
        opponentRace,
        apmAverage: new Averager(),
        length: new Averager(),
      }
      rows.set(key, row)
    }
    tally(row, g.result)
    row.apmAverage.add(g.me.apm)
    row.length.add(g.game.durationMs)
  }
  const order: ReadonlyArray<GameShape> = ['1v1', '2v2', '3v3', '4v4', 'ffa', 'other']
  return Array.from(rows.values(), ({ apmAverage, length, ...row }) => ({
    ...row,
    apm: apmAverage.get()?.value,
    durationMs: length.get()?.value,
  })).sort(
    (a, b) =>
      order.indexOf(a.shape) - order.indexOf(b.shape) ||
      (a.race ?? '').localeCompare(b.race ?? '') ||
      (a.opponentRace ?? '').localeCompare(b.opponentRace ?? ''),
  )
}

function getLengthRows(games: ReadonlyArray<MyGame>): LengthRow[] {
  const rows: LengthRow[] = [
    ...LENGTH_GROUPS_MINUTES.map(maxMinutes => ({ ...emptyRecord(), maxMinutes })),
    emptyRecord(),
  ]
  for (const g of games) {
    const minutes = g.game.durationMs / 60_000
    const row = rows.find(r => r.maxMinutes === undefined || minutes < r.maxMinutes)!
    tally(row, g.result)
  }
  return rows
}

function getMacroAverages(players: ReadonlyArray<PlayerMetrics>): MacroAverages {
  const at = (minute: number) => CHECKPOINT_MINUTES.indexOf(minute)
  const averages = {
    workers6: new Averager(),
    workers10: new Averager(),
    income6: new Averager(),
    income10: new Averager(),
    supply100Ms: new Averager(),
    supply150Ms: new Averager(),
    bankMid: new Averager(),
    supplyBlockedShare: new Averager(),
    armyKilled: new Averager(),
    armyLost: new Averager(),
  }
  for (const me of players) {
    averages.workers6.add(me.workers[at(6)])
    averages.workers10.add(me.workers[at(10)])
    averages.income6.add(me.income[at(6)])
    averages.income10.add(me.income[at(10)])
    averages.supply100Ms.add(me.supplyTimesMs[0])
    averages.supply150Ms.add(me.supplyTimesMs[1])
    averages.bankMid.add(me.bank[1])
    averages.supplyBlockedShare.add(me.supplyBlockedShare)
    averages.armyKilled.add(me.armyKilled)
    averages.armyLost.add(me.armyLost)
  }
  return Object.fromEntries(
    Object.entries(averages).map(([key, averager]) => [key, averager.get()]),
  ) as MacroAverages
}

function getPeople(games: ReadonlyArray<MyGame>, names: ReadonlyArray<string>): PersonRow[] {
  type Tally = Omit<PersonRow, 'races'> & { raceCounts: Map<AssignedRaceChar, number> }
  const people = new Map<string, Tally>()
  const add = (p: PlayerMetrics, relation: PersonRow['relation'], result: GameStatsResult) => {
    const name = p.names.join(' + ')
    if (p.names.some(n => isMyPlayerName(n, names))) {
      return
    }
    const key = `${relation}:${name.toLowerCase()}`
    let person = people.get(key)
    if (!person) {
      person = { ...emptyRecord(), name, relation, raceCounts: new Map() }
      people.set(key, person)
    }
    tally(person, result)
    if (p.race) {
      person.raceCounts.set(p.race, (person.raceCounts.get(p.race) ?? 0) + 1)
    }
  }
  for (const g of games) {
    g.teammates.forEach(p => add(p, 'teammate', g.result))
    g.opponents.forEach(p => add(p, 'opponent', g.result))
  }
  return Array.from(people.values(), ({ raceCounts, ...person }) => ({
    ...person,
    races: Array.from(raceCounts, ([race, games]) => ({ race, games })).sort(
      (a, b) => b.games - a.games,
    ),
  })).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))
}

/**
 * The user's record on each map. Every version of a standard map counts toward it, named by the one
 * played most, see `getMapKey`. Money maps are grouped by kind.
 */
function getMaps(games: ReadonlyArray<MyGame>): MapRow[] {
  const maps = new Map<string, MapRow & { names: Map<string, number> }>()
  for (const g of games) {
    const family = g.game.mapFamily
    const key = family === 'standard' ? `standard:${getMapKey(g.game.mapName)}` : family
    let row = maps.get(key)
    if (!row) {
      row = { ...emptyRecord(), mapName: g.game.mapName, family, names: new Map() }
      maps.set(key, row)
    }
    row.names.set(g.game.mapName, (row.names.get(g.game.mapName) ?? 0) + 1)
    tally(row, g.result)
  }
  return Array.from(maps.values(), ({ names, ...row }) => {
    if (row.family !== 'standard') {
      return row
    }
    const [mostPlayed] = Array.from(names).sort(([, a], [, b]) => b - a)[0]
    return { ...row, mapName: getMapDisplayName(mostPlayed) }
  }).sort((a, b) => b.games - a.games || a.mapName.localeCompare(b.mapName))
}

function getTeamStats(games: ReadonlyArray<MyGame>): TeamStats | undefined {
  const teamGames = games.filter(g => isTeamGame(g.game.shape))
  if (!teamGames.length) {
    return undefined
  }
  const byRaces = new Map<string, WinLoss & { races: AssignedRaceChar[] }>()
  const incomeShare = new Averager()
  const killShare = new Averager()
  let losses = 0
  let firstOutLosses = 0
  for (const g of teamGames) {
    const teammateRaces = races(g.teammates)
    const key = teammateRaces.join('')
    let row = byRaces.get(key)
    if (!row) {
      row = { ...emptyRecord(), races: teammateRaces }
      byRaces.set(key, row)
    }
    tally(row, g.result)
    incomeShare.add(g.me.teamShare?.income)
    killShare.add(g.me.teamShare?.armyKilled)
    if (g.result === 'loss') {
      losses += 1
      if (g.me.outOrder === 1) {
        firstOutLosses += 1
      }
    }
  }
  return {
    byTeamRaces: Array.from(byRaces.values()).sort((a, b) => b.games - a.games),
    incomeShare: incomeShare.get(),
    killShare: killShare.get(),
    firstOutLosses,
    losses,
  }
}

function getTeamStatsByRace(games: ReadonlyArray<MyGame>): MyStatsResult['team'] {
  const any = getTeamStats(games)
  if (!any) {
    return undefined
  }
  const byRace: NonNullable<MyStatsResult['team']> = { any }
  for (const race of ALL_ASSIGNED_RACE_CHARS) {
    byRace[race] = getTeamStats(games.filter(g => g.me.race === race))
  }
  return byRace
}

/** Players who didn't play long enough to compare with. */
const MIN_OTHER_PLAYED_MS = 5 * 60_000

/**
 * Other players to compare the user's numbers with: anyone but the user in games of the type the
 * filters pick, playing the race they pick, at or above the EAPM floor. Games from any time count,
 * since how others play doesn't depend on when the user did.
 */
function getOthers(
  allGames: ReadonlyArray<DatedGameMetrics>,
  query: MyStatsQuery,
): PlayerMetrics[] {
  const floor = query.eapmFloor ?? DEFAULT_EAPM_FLOOR
  return allGames.flatMap(game => {
    if (query.shape && game.shape !== query.shape) {
      return []
    }
    if (query.mapFamily && splitsByMap(query.shape) && game.mapFamily !== query.mapFamily) {
      return []
    }
    const me = findMe(game, query.names)
    return game.players.filter(
      p =>
        p !== me &&
        p.human &&
        (p.eapm ?? 0) >= floor &&
        (p.leftAtMs === undefined || p.leftAtMs >= MIN_OTHER_PLAYED_MS) &&
        (!query.race || p.race === query.race) &&
        (!query.opponentRace ||
          (game.shape === '1v1' && getSidesOf(game, p).opponents[0]?.race === query.opponentRace)),
    )
  })
}

/** Sums up the user's analyzed games that match `query`. */
export function computeMyStats(
  allGames: ReadonlyArray<DatedGameMetrics>,
  query: MyStatsQuery,
  nowMs: number,
): MyStatsResult {
  const games = allGames
    .map(game => toMyGame(game, query.names))
    .filter((g): g is MyGame => g !== undefined && matchesQuery(g, query, nowMs))
    .sort((a, b) => a.game.gameTimeMs - b.game.gameTimeMs)

  const record = emptyRecord()
  const apm = new Averager()
  const eapm = new Averager()
  const durationMs = new Averager()
  for (const g of games) {
    tally(record, g.result)
    apm.add(g.me.apm)
    eapm.add(g.me.eapm)
    durationMs.add(g.game.durationMs)
  }

  const people = getPeople(games, query.names)
  const others = getOthers(allGames, query)
  return {
    games: games.length,
    record,
    apm: apm.get(),
    eapm: eapm.get(),
    durationMs: durationMs.get(),
    recent: games.slice(-RECENT_GAMES).map(toGame),
    trend: games.slice(-TREND_GAMES).map(toGame),
    byMatchup: getMatchupRows(games),
    byLength: getLengthRows(games),
    macro: getMacroAverages(games.map(g => g.me)),
    macroOthers: getMacroAverages(others),
    othersGames: others.length,
    teammates: people.filter(p => p.relation === 'teammate').slice(0, MAX_PEOPLE),
    opponents: people.filter(p => p.relation === 'opponent').slice(0, MAX_PEOPLE),
    maps: getMaps(games),
    team: getTeamStatsByRace(games),
  }
}
