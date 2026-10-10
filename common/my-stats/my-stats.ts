import { GameStatsResult } from '../games/game-stats'
import { LadderRank } from '../games/ladder'
import { getMapDisplayName, getMapKey, MapFamily } from '../games/map-family'
import { CHECKPOINT_MINUTES, GameMetrics, GameShape, PlayerMetrics } from '../games/player-metrics'
import { isMyPlayerName } from '../games/player-names'
import { ALL_ASSIGNED_RACE_CHARS, AssignedRaceChar } from '../races'
import { DEFAULT_EAPM_FLOOR, getRankMmr, pickRank, RankMmr } from './coach'
import { findMe, getMyResult, getSidesOf, isTeamGame, splitsByMap } from './player-games'

/** How many of the latest games the recent results show. */
export const RECENT_GAMES = 20
/** The most games the trends can show. */
export const TREND_GAMES = 100

export type MyStatsRange = '7d' | '30d' | 'all'

/** A 2v2 team's races, in alphabetical order. */
export type RacePair = `${AssignedRaceChar}${AssignedRaceChar}`
export const RACE_PAIRS: ReadonlyArray<RacePair> = ['pp', 'pt', 'pz', 'tt', 'tz', 'zz']
export type MyStatsShape = Exclude<GameShape, 'other'>

export interface MyStatsQuery {
  names: string[]
  range: MyStatsRange
  shape?: MyStatsShape
  race?: AssignedRaceChar
  /** Only used in 1v1. */
  opponentRace?: AssignedRaceChar
  /** Only used in 2v2: the opposing team's races. */
  opponentPair?: RacePair
  /**
   * Only used in game types that split by map, see `splitsByMap`. Without one, the family the user
   * played most is picked.
   */
  mapFamily?: MapFamily
  /** The EAPM other players need for the comparisons to count them. */
  eapmFloor?: number
  /** Only used in 1v1: the ladder rank other players need, see `CoachQuery`. */
  rank?: LadderRank | 'any'
}

/** A game's metrics along with when it was played. */
export interface DatedGameMetrics extends GameMetrics {
  gameTimeMs: number
  /** Whether it's from the ladder baseline the app ships, rather than the user's replays. */
  ladderBaseline?: boolean
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
  /** In 2v2, the opposing team's races, in alphabetical order. */
  opponentRaces?: AssignedRaceChar[]
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
  /** Of {@link othersGames}, how many are from the ladder baseline the app ships. */
  othersFromBaseline: number
  /** The ladder rank other players were picked by, in 1v1. */
  rank?: LadderRank
  /** In 1v1, the rank of the user's latest ranked game here, which `auto` picks. */
  autoRank?: LadderRank
  /** In 1v1, the MMRs each rank covers. */
  rankMmr?: RankMmr
  /**
   * In game types that split by map, the family these numbers are for: the one picked, or else the
   * one the user played most. See `splitsByMap`.
   */
  mapFamily?: MapFamily
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
  if (query.opponentPair && !playsAgainstPair(g.game, g.opponents, query.opponentPair)) {
    return false
  }
  return true
}

function races(players: ReadonlyArray<PlayerMetrics>) {
  return players.flatMap(p => (p.race ? [p.race] : [])).sort()
}

function playsAgainstPair(
  game: GameMetrics,
  opponents: ReadonlyArray<PlayerMetrics>,
  pair: RacePair,
) {
  return game.shape === '2v2' && races(opponents).join('') === pair
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
    const opponentRaces = g.game.shape === '2v2' ? races(g.opponents) : undefined
    const key = `${g.game.shape}:${race ?? ''}:${opponentRace ?? ''}:${opponentRaces?.join('') ?? ''}`
    let row = rows.get(key)
    if (!row) {
      row = {
        ...emptyRecord(),
        shape: g.game.shape,
        race,
        opponentRace,
        opponentRaces,
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
      (a.opponentRace ?? '').localeCompare(b.opponentRace ?? '') ||
      (a.opponentRaces?.join('') ?? '').localeCompare(b.opponentRaces?.join('') ?? ''),
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

/** Players who didn't play long enough to compare with, the user included. */
const MIN_COMPARED_PLAYED_MS = 5 * 60_000

/** Whether a player played long enough in a game for their numbers to be compared. */
function playedEnough(game: DatedGameMetrics, player: PlayerMetrics) {
  return (player.leftAtMs ?? game.durationMs) >= MIN_COMPARED_PLAYED_MS
}

/**
 * Other players to compare the user's numbers with: anyone but the user in games of the type the
 * filters pick, playing the race they pick against the opponents' races they pick, at or above the
 * EAPM floor and, in 1v1, at `rank`, who played at least 5 minutes. Games from any time count,
 * since how others play doesn't depend on when the user did.
 */
function getOthers(
  allGames: ReadonlyArray<DatedGameMetrics>,
  query: MyStatsQuery,
  rank: LadderRank | undefined,
): Array<{ player: PlayerMetrics; baseline: boolean }> {
  const floor = query.eapmFloor ?? DEFAULT_EAPM_FLOOR
  return allGames.flatMap(game => {
    if (query.shape && game.shape !== query.shape) {
      return []
    }
    if (query.mapFamily && splitsByMap(query.shape) && game.mapFamily !== query.mapFamily) {
      return []
    }
    const me = findMe(game, query.names)
    const players = game.players.filter(
      p =>
        p !== me &&
        p.human &&
        (p.eapm ?? 0) >= floor &&
        (!rank || p.rank === rank) &&
        playedEnough(game, p) &&
        (!query.race || p.race === query.race) &&
        (!query.opponentRace ||
          (game.shape === '1v1' &&
            getSidesOf(game, p).opponents[0]?.race === query.opponentRace)) &&
        (!query.opponentPair ||
          playsAgainstPair(game, getSidesOf(game, p).opponents, query.opponentPair)),
    )
    return players.map(player => ({ player, baseline: game.ladderBaseline === true }))
  })
}

/**
 * The map family to sum up in game types that split by map: the one picked, or else the one the user
 * played most of the games the rest of `query` picks. Families are never summed up together, since
 * each plays like a different game.
 */
function pickMapFamily(
  myGames: ReadonlyArray<MyGame>,
  query: MyStatsQuery,
  nowMs: number,
): MapFamily | undefined {
  if (!splitsByMap(query.shape)) {
    return undefined
  }
  if (query.mapFamily) {
    return query.mapFamily
  }
  const counts = new Map<MapFamily, number>()
  for (const g of myGames) {
    if (matchesQuery(g, query, nowMs)) {
      counts.set(g.game.mapFamily, (counts.get(g.game.mapFamily) ?? 0) + 1)
    }
  }
  return Array.from(counts).sort(([, a], [, b]) => b - a)[0]?.[0]
}

/** Sums up the user's analyzed games that match `query`. */
export function computeMyStats(
  allGames: ReadonlyArray<DatedGameMetrics>,
  pickedQuery: MyStatsQuery,
  nowMs: number,
): MyStatsResult {
  const myGames = allGames
    .map(game => toMyGame(game, pickedQuery.names))
    .filter((g): g is MyGame => g !== undefined)
    .sort((a, b) => a.game.gameTimeMs - b.game.gameTimeMs)
  const mapFamily = pickMapFamily(myGames, pickedQuery, nowMs)
  const query = { ...pickedQuery, mapFamily }
  const games = myGames.filter(g => matchesQuery(g, query, nowMs))

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
  const { auto: autoRank, rank } =
    query.shape === '1v1'
      ? pickRank(allGames, query.names, query.rank, game => {
          const g = toMyGame(game, query.names)
          return !!g && matchesQuery(g, query, nowMs)
        })
      : { auto: undefined, rank: undefined }
  // Each game type plays differently, and the ladder games the app ships are all 1v1, so other
  // players are only compared with once a game type is picked.
  const others = query.shape ? getOthers(allGames, query, rank) : []
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
    // Held to the same rule as the others they're compared with.
    macro: getMacroAverages(games.filter(g => playedEnough(g.game, g.me)).map(g => g.me)),
    macroOthers: getMacroAverages(others.map(o => o.player)),
    othersGames: others.length,
    othersFromBaseline: others.filter(o => o.baseline).length,
    rank,
    autoRank,
    rankMmr: query.shape === '1v1' ? getRankMmr(allGames) : undefined,
    mapFamily,
    teammates: people.filter(p => p.relation === 'teammate'),
    opponents: people.filter(p => p.relation === 'opponent'),
    maps: getMaps(games),
    // The panel picks its own race, so it gets the user's games of every race.
    team: getTeamStatsByRace(
      myGames.filter(g => matchesQuery(g, { ...query, race: undefined }, nowMs)),
    ),
  }
}
