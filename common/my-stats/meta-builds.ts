import { MapFamily } from '../games/map-family'
import {
  ARMY_MIX_MINUTES,
  BuildStepMetric,
  PlayerMetrics,
  STARTING_WORKERS,
  WORKER_IDS,
} from '../games/player-metrics'
import { AssignedRaceChar } from '../races'
import { getBuildFamily } from './build-family'
import {
  BuildSample,
  BuildStepSummary,
  quantile,
  summarizeBuildSide,
  WORKER_MINUTES,
} from './builds'
import { capPerPlayer, isComparable, nameOf, Sample, toSample, wentOutFirst } from './coach'
import type { DatedGameMetrics, MyStatsShape } from './my-stats'
import { getSidesOf, isTeamGame, splitsByMap } from './player-games'

/** How far back from the latest game the meta looks, so old patches and map pools drop out. */
const META_WINDOW_MS = 180 * 24 * 60 * 60_000
/** How much a 1v1 game counts by the player's ladder rank. Ranks not listed don't count. */
const RANK_WEIGHTS: Readonly<Record<string, number>> = { s: 2, a: 1 }
/**
 * The fewest S and A rank players whose EAPM tells which unranked players play at their level.
 * With fewer, the fastest quarter of everyone counts instead.
 */
const MIN_RANKED_TOP_PLAYERS = 20
/** Where the fastest quarter of players starts, by their EAPM. */
const TOP_EAPM_QUANTILE = 0.75
/** How many games one player can add, their latest, so no one player sets the meta. */
const MAX_GAMES_PER_PLAYER = 10
/** The fewest top players' games, and players, a build needs to be listed. */
export const MIN_META_BUILD_GAMES = 8
export const MIN_META_BUILD_PLAYERS = 4
/** The most builds listed. */
const MAX_META_BUILDS = 6
/** The share of top players' games, the games and the players a build needs to be standard. */
const STANDARD_SHARE = 0.15
const STANDARD_GAMES = 15
const STANDARD_PLAYERS = 5
/**
 * A build's results are pulled toward the average as if it had this many more games that went
 * like everyone else's, so a few lucky games can't make it stand out.
 */
const PRIOR_GAMES = 20
/** How far a build order goes before what's left is listed by when most games take it. */
export const ORDER_END_MS = 7 * 60_000
/** Steps after {@link ORDER_END_MS} listed, the earliest first. */
const MAX_LATER_STEPS = 8
/** A step at least this share of games take is part of the build, and fewer an option. */
export const CORE_STEP_SHARE = 0.8
/** A step most players take within this window of each other is one everyone does the same. */
export const TIGHT_STEP_MS = 15_000
/** A step the middle half of games take further apart than this depends on the game. */
export const VARIED_STEP_MS = 90_000
/** How far off a typical step can be before a game is judged as missing it. */
const MISSING_STEP_COST = 3
/** The fewest games of a split, like against one opening, for it to be offered. */
const MIN_SPLIT_GAMES = 25
/** In 2v2, the fewest top games with the teammate's race to show them apart from any teammate. */
const MIN_ALLY_GAMES = 30
/** Army units this many a game on average, at a minute, are part of the army then. */
const MIN_ARMY_COUNT = 0.5
/** The minutes the army is shown at. */
const ARMY_MINUTES: ReadonlyArray<number> = [6, 8]
/** Static defense counted by this, see {@link MetaBuild.defense}. */
const DEFENSE_BY_MS = 6 * 60_000
/** Photon Cannons, Bunkers, Missile Turrets, and Sunken and Spore Colonies. */
const DEFENSE_KEYS: ReadonlyArray<string> = ['u162', 'u125', 'u124', 'u146', 'u144']

/** The kind of game to show the meta of, like the coach's scope. */
export interface MetaQuery {
  shape: MyStatsShape
  race: AssignedRaceChar
  /** Only used in 1v1. */
  opponentRace?: AssignedRaceChar
  /** Only used in 2v2: the teammate's race. */
  allyRace?: AssignedRaceChar
  /**
   * The kind of map, in game types that split by map. In 2v2, which plays differently on money
   * maps too, the one with the most top games unless one is picked.
   */
  mapFamily?: MapFamily
  /** Only used in 2v2: the opponents' races, in alphabetical order, like `pz`. */
  opponents?: string
  /** Only used in 1v1: the opponent's opening, like `t raxCC`, see {@link MetaResult.openings}. */
  opponentOpening?: string
}

/** One step of a build order, as the typical game took it, with how all of the games did. */
export interface MetaStep {
  /** The build key, see `buildKey`. */
  key: string
  /** Which of these it is, like the second Gateway. */
  nth: number
  /** When the typical game took it, and the supply then. */
  timeMs: number
  supply?: number
  /** Workers the typical game had made by then, counting the ones it started with. */
  workers?: number
  /** The middle half of all the games take it between these. */
  earlyMs: number
  lateMs: number
  /** The share of all the games that take it. */
  share: number
}

/** A build top players use, how it does, and how they play it. */
export interface MetaBuild {
  /** See `getBuildFamily`. */
  family: string
  /** Top players' games with it. */
  games: number
  players: number
  /**
   * Its share of top players' games here with a build named, by how much each game counts. Games
   * over too soon to name one are left out, see {@link MetaResult.shortShare}.
   */
  share: number
  /** Wins and losses, each team's counted once. */
  wins: number
  losses: number
  /**
   * How it wins against everyone else's builds here: 0.5 is like the rest. In 1v1, judged against
   * what the players' MMRs expected. Pulled toward 0.5 when it has few games.
   */
  winScore: number
  /** The games {@link winScore} is from. */
  winGames: number
  /** Whether it's the build top players play here, more than any other. */
  standard: boolean
  /**
   * The steps to {@link ORDER_END_MS} of the game closest to how top players play it, the ones at
   * least half of the games take, in that game's order.
   */
  order: MetaStep[]
  /** Steps after the order, by when most games take them. */
  later: BuildStepSummary[]
  /** The game the order is from. */
  typical: { gameId: string; fromLibrary: boolean }
  /** Workers at each of {@link WORKER_MINUTES}, when most of the games got that far. */
  workersAt: Array<number | null>
  /** The army units most games have at each of {@link ARMY_MINUTES}, on average. */
  armyAt: Array<{ minute: number; units: Array<{ unitId: number; count: number }> }>
  /** Static defense of each kind most games build by {@link DEFENSE_BY_MS}, and how many. */
  defense: Array<{ key: string; count: number }>
}

/** A way to split the games, like against one opening, and how many top games it has. */
export interface MetaSplit<T extends string> {
  value: T
  games: number
}

/** The builds top players use in one kind of game, and how they play them. */
export interface MetaResult {
  /** How top players were picked: by ladder rank in 1v1, otherwise by EAPM. */
  topBy: 'rank' | 'eapm'
  /** The early game EAPM an unranked player, or any player outside 1v1, needed to count. */
  eapmCutoff?: number
  /** Top players' games, after each player's are capped. */
  games: number
  players: number
  /** Of {@link games}, how many come from the user's replays rather than the ladder baseline. */
  libraryGames: number
  fromMs?: number
  toMs?: number
  /** The most played first. */
  builds: MetaBuild[]
  /** The share of top players' games with a build named, see {@link MetaBuild.share}, of others. */
  otherShare: number
  /**
   * The share of top players' games over before their build showed, which builds' shares leave
   * out, see `getBuildFamily`.
   */
  shortShare: number
  /** With too few games to list builds, the ones seen, the most played first. */
  seen: Array<{ family: string; games: number; players: number }>
  /** In 2v2, the kind of map shown, and the kinds with top games. */
  mapFamily?: MapFamily
  mapFamilies?: Array<MetaSplit<MapFamily>>
  /** In 2v2, whether teammates of any race count, since too few had the one asked for. */
  anyAlly?: boolean
  /** In 2v2, the pairs of opponents' races with enough top games to look at alone. */
  opponentPairs?: Array<MetaSplit<string>>
  /** In 1v1, the opponent's openings with enough top games to look at alone. */
  openings?: Array<MetaSplit<string>>
}

type TopSample = Sample & { weight: number; family: string | undefined }

function sum(values: ReadonlyArray<number>) {
  return values.reduce((total, value) => total + value, 0)
}

function median(values: ReadonlyArray<number>) {
  return quantile(values, 0.5)
}

/** A player's EAPM in the early game, which short games and long ones both have. */
function earlyEapm(p: PlayerMetrics) {
  return p.eapmByPhase?.[0] ?? p.eapm
}

/** How likely the player was to win, by their MMR and their opponent's, or even without both. */
function expectedWin(s: Sample) {
  const mmr = s.player.mmr
  const opponentMmr = s.opponent?.mmr
  if (mmr === undefined || opponentMmr === undefined) {
    return 0.5
  }
  return 1 / (1 + 10 ** ((opponentMmr - mmr) / 400))
}

/**
 * The games a build's results are judged on: decided ones, each team once in team games, leaving
 * out players their team carried.
 */
function decidedOf(samples: ReadonlyArray<TopSample>) {
  const seen = new Set<string>()
  return samples.filter(s => {
    if (s.player.result !== 'win' && s.player.result !== 'loss') {
      return false
    }
    if (!isTeamGame(s.game.shape)) {
      return true
    }
    const team = `${s.game.gameId}:${s.player.team}`
    if (wentOutFirst(s) || seen.has(team)) {
      return false
    }
    seen.add(team)
    return true
  })
}

/** How much better than expected these games went, in all. */
function surplusOf(samples: ReadonlyArray<TopSample>) {
  return sum(samples.map(s => (s.player.result === 'win' ? 1 : 0) - expectedWin(s)))
}

/**
 * The step ids a game took, numbered the way `summarizeBuildSide` numbers them, with each one's
 * step.
 */
function stepsById(player: PlayerMetrics) {
  const seen = new Map<string, number>()
  return new Map<string, BuildStepMetric & { nth: number }>(
    (player.buildSteps ?? []).map(step => {
      const nth = (seen.get(step.key) ?? 0) + 1
      seen.set(step.key, nth)
      return [`${step.key}#${nth}`, { ...step, nth }]
    }),
  )
}

const idOf = (step: Pick<BuildStepSummary, 'key' | 'nth'>) => `${step.key}#${step.nth}`

/**
 * The game that took a build's steps closest to when most of its games did: for each step most
 * games take, how far off it was against how spread out the games are, or a fixed cost if it
 * didn't take it. Games that got through the build order first, if most did.
 */
function typicalOf(samples: ReadonlyArray<TopSample>, steps: ReadonlyArray<BuildStepSummary>) {
  const core = steps.filter(step => step.share >= CORE_STEP_SHARE && step.timeMs <= ORDER_END_MS)
  const cost = (s: TopSample) => {
    const taken = stepsById(s.player)
    return sum(
      core.map(step => {
        const at = taken.get(idOf(step))
        if (!at) {
          return MISSING_STEP_COST
        }
        const spread = Math.max(step.lateMs - step.earlyMs, TIGHT_STEP_MS)
        return Math.min(Math.abs(at.timeMs - step.timeMs) / spread, MISSING_STEP_COST)
      }),
    )
  }
  // A build most games of are over before the order ends, like an all-in, is judged by them.
  const lasted = samples.filter(s => s.playedMs >= ORDER_END_MS)
  return (lasted.length * 2 >= samples.length ? lasted : samples)
    .map(s => ({ s, cost: cost(s) }))
    .sort(
      (a, b) =>
        a.cost - b.cost || b.s.weight - a.s.weight || b.s.game.gameTimeMs - a.s.game.gameTimeMs,
    )[0].s
}

function toBuildSample(s: TopSample): BuildSample {
  const teamGame = isTeamGame(s.game.shape)
  return {
    player: s.player,
    name: nameOf(s.player),
    side: teamGame ? String(s.player.team) : nameOf(s.player),
    result: s.player.result,
    gameId: s.game.gameId,
    withUser: false,
    carried: teamGame && wentOutFirst(s),
    playedMs: s.playedMs,
    weight: s.weight,
  }
}

/** How a build's games play it, see {@link MetaBuild}. */
function describeBuild(samples: ReadonlyArray<TopSample>) {
  const side = summarizeBuildSide(samples.map(toBuildSample))
  const typical = typicalOf(samples, side.steps)
  const byId = new Map(side.steps.map(step => [idOf(step), step]))
  const workerTimes = Object.entries(typical.player.unitTimes ?? {})
    .filter(([unitId]) => WORKER_IDS.has(Number(unitId)))
    .flatMap(([, times]) => times)
  const order: MetaStep[] = Array.from(stepsById(typical.player).values()).flatMap(step => {
    const all = byId.get(idOf(step))
    if (!all || step.timeMs > ORDER_END_MS) {
      return []
    }
    return [
      {
        key: step.key,
        nth: step.nth,
        timeMs: step.timeMs,
        supply: step.supply,
        workers: typical.player.unitTimes
          ? STARTING_WORKERS + workerTimes.filter(ms => ms < step.timeMs).length
          : undefined,
        earlyMs: all.earlyMs,
        lateMs: all.lateMs,
        share: all.share,
      },
    ]
  })
  const inOrder = new Set(order.map(idOf))
  const later = side.steps
    .filter(step => step.timeMs > ORDER_END_MS && !inOrder.has(idOf(step)))
    .slice(0, MAX_LATER_STEPS)

  const reached = (minute: number) =>
    samples.filter(s => s.playedMs >= minute * 60_000).length * 2 >= samples.length
  const workersAt = WORKER_MINUTES.map((minute, i) => (reached(minute) ? side.workersAt[i] : null))
  const armyAt = ARMY_MINUTES.filter(reached).map(minute => {
    const index = ARMY_MIX_MINUTES.indexOf(minute)
    return {
      minute,
      units: side.armyMix
        .map(entry => ({ unitId: entry.unitId, count: entry.counts[index] ?? 0 }))
        .filter(unit => unit.count >= MIN_ARMY_COUNT)
        .sort((a, b) => b.count - a.count),
    }
  })
  const defense = DEFENSE_KEYS.flatMap(key => {
    const count = median(
      samples.map(
        s =>
          (s.player.buildSteps ?? []).filter(
            step => step.key === key && step.timeMs <= DEFENSE_BY_MS,
          ).length,
      ),
    )
    return count >= 1 ? [{ key, count: Math.round(count) }] : []
  })

  return {
    side,
    order,
    later,
    typical: { gameId: typical.game.gameId, fromLibrary: !typical.game.ladderBaseline },
    workersAt,
    armyAt,
    defense,
  }
}

function playersOf(samples: ReadonlyArray<TopSample>) {
  return new Set(samples.map(s => nameOf(s.player))).size
}

function isListable(samples: ReadonlyArray<TopSample>) {
  return samples.length >= MIN_META_BUILD_GAMES && playersOf(samples) >= MIN_META_BUILD_PLAYERS
}

/**
 * Games by build, with a build too rare to list counted as the build it's a variant of, like a
 * Robo build's Reaver variant as the Robo build, down to the opening. A build named by its opening
 * alone stays as it is.
 */
function rollUp(samples: ReadonlyArray<TopSample>): Map<string, TopSample[]> {
  const byFamily = new Map<string, TopSample[]>()
  for (const s of samples) {
    byFamily.set(s.family!, [...(byFamily.get(s.family!) ?? []), s])
  }
  const longest = Math.max(...Array.from(byFamily.keys(), family => family.split(' ').length))
  // The race and the opening name the shortest build.
  for (let length = longest; length > 2; length--) {
    for (const [family, games] of Array.from(byFamily)) {
      const parts = family.split(' ')
      if (parts.length === length && !isListable(games)) {
        const parent = parts.slice(0, -1).join(' ')
        byFamily.set(parent, [...(byFamily.get(parent) ?? []), ...games])
        byFamily.delete(family)
      }
    }
  }
  return byFamily
}

/** The splits worth offering, with the most games first. */
function splitsOf<T extends string>(values: ReadonlyArray<T | undefined>): Array<MetaSplit<T>> {
  const counts = new Map<T, number>()
  for (const value of values) {
    if (value !== undefined) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  return Array.from(counts, ([value, games]) => ({ value, games }))
    .filter(split => split.games >= MIN_SPLIT_GAMES)
    .sort((a, b) => b.games - a.games)
}

/** A player's opening, the race and how they opened, like `t raxCC`. */
function openingOf(family: string | undefined) {
  return family?.split(' ').slice(0, 2).join(' ')
}

/**
 * The builds the best players use in one kind of game, the most played first, with how each
 * does and the order the game closest to its usual play took its steps in. Every analyzed game
 * counts, the ladder baseline's and the user's own replays', the user's own play included. Top
 * players are picked player by player: in 1v1, S rank (counted twice) and A rank, and unranked
 * players as fast in the early game as them; otherwise the fastest quarter of players.
 */
export function computeMetaBuilds(
  everyGame: ReadonlyArray<DatedGameMetrics>,
  query: MetaQuery,
): MetaResult {
  const { shape, race, opponentRace } = query
  const is2v2 = shape === '2v2'
  const mapFamily = splitsByMap(shape) ? query.mapFamily : undefined
  const isOfKind = (game: DatedGameMetrics, p: PlayerMetrics) =>
    game.shape === shape &&
    (!mapFamily || game.mapFamily === mapFamily) &&
    p.race === race &&
    p.human &&
    (shape !== '1v1' || getSidesOf(game, p).opponents[0]?.race === opponentRace)

  const all = everyGame.flatMap(game =>
    game.players
      .filter(p => isOfKind(game, p) && isComparable(game, p))
      .map(p => toSample(game, p)),
  )
  const topBy = shape === '1v1' ? 'rank' : 'eapm'
  const empty: MetaResult = {
    topBy,
    games: 0,
    players: 0,
    libraryGames: 0,
    builds: [],
    otherShare: 0,
    shortShare: 0,
    seen: [],
  }
  if (!all.length) {
    return empty
  }
  const toMs = Math.max(...all.map(s => s.game.gameTimeMs))
  const fromMs = toMs - META_WINDOW_MS
  const recent = all.filter(s => s.game.gameTimeMs >= fromMs)

  // Players are judged by their usual speed over their games here, not game by game.
  const eapmsByPlayer = new Map<string, number[]>()
  for (const s of recent) {
    const eapm = earlyEapm(s.player)
    if (eapm !== undefined && eapm !== null) {
      const name = nameOf(s.player)
      eapmsByPlayer.set(name, [...(eapmsByPlayer.get(name) ?? []), eapm])
    }
  }
  const playerEapm = new Map(Array.from(eapmsByPlayer, ([name, eapms]) => [name, median(eapms)]))
  const fastestQuarter = playerEapm.size
    ? quantile(Array.from(playerEapm.values()), TOP_EAPM_QUANTILE)
    : undefined
  const rankedTop = new Set(
    recent.flatMap(s => (s.player.rank && RANK_WEIGHTS[s.player.rank] ? [nameOf(s.player)] : [])),
  )
  const rankedTopEapms = Array.from(rankedTop).flatMap(name => playerEapm.get(name) ?? [])
  const eapmCutoff =
    shape === '1v1' && rankedTopEapms.length >= MIN_RANKED_TOP_PLAYERS
      ? median(rankedTopEapms)
      : fastestQuarter
  const weightOf = (s: Sample) => {
    if (shape === '1v1' && s.player.rank) {
      return RANK_WEIGHTS[s.player.rank] ?? 0
    }
    const eapm = playerEapm.get(nameOf(s.player))
    return eapmCutoff !== undefined && eapm !== undefined && eapm >= eapmCutoff ? 1 : 0
  }
  let top: TopSample[] = capPerPlayer(
    recent
      .map(s => ({ ...s, weight: weightOf(s) }))
      .filter(s => s.weight > 0)
      .sort((a, b) => b.game.gameTimeMs - a.game.gameTimeMs),
    MAX_GAMES_PER_PLAYER,
  ).map(s => ({ ...s, family: getBuildFamily(s.player, { shape, playedMs: s.playedMs }) }))

  // Ways to split the games, each offered from the games left by the ones before it.
  const result: Partial<MetaResult> = {}
  if (is2v2) {
    const withAlly = top.filter(
      s => !query.allyRace || s.teammates.some(t => t.race === query.allyRace),
    )
    result.anyAlly = !!query.allyRace && withAlly.length < MIN_ALLY_GAMES
    top = result.anyAlly ? top : withAlly
    result.mapFamilies = splitsOf(top.map(s => s.game.mapFamily))
    result.mapFamily =
      query.mapFamily ?? result.mapFamilies[0]?.value ?? top[0]?.game.mapFamily ?? undefined
    top = top.filter(s => s.game.mapFamily === result.mapFamily)
    const pairOf = (s: Sample) =>
      getSidesOf(s.game, s.player)
        .opponents.map(p => p.race ?? '')
        .sort()
        .join('')
    result.opponentPairs = splitsOf(top.map(pairOf))
    if (query.opponents) {
      top = top.filter(s => pairOf(s) === query.opponents)
    }
  }
  if (shape === '1v1') {
    const openings = new Map(
      top.map(({ game, opponent }) => [
        game.gameId,
        opponent &&
          openingOf(
            getBuildFamily(opponent, {
              shape,
              playedMs: Math.min(opponent.leftAtMs ?? game.durationMs, game.durationMs),
            }),
          ),
      ]),
    )
    result.openings = splitsOf(top.map(s => openings.get(s.game.gameId)))
    if (query.opponentOpening) {
      top = top.filter(s => openings.get(s.game.gameId) === query.opponentOpening)
    }
  }

  const totalWeight = sum(top.map(s => s.weight))
  const named = top.filter(s => s.family)
  const namedWeight = sum(named.map(s => s.weight))
  const families = Array.from(rollUp(named), ([family, samples]) => ({
    family,
    samples,
    players: playersOf(samples),
    share: namedWeight ? sum(samples.map(s => s.weight)) / namedWeight : 0,
  })).sort((a, b) => b.share - a.share)

  const decided = decidedOf(top)
  const averageSurplus = decided.length ? surplusOf(decided) / decided.length : 0
  const builds = families
    .filter(f => f.samples.length >= MIN_META_BUILD_GAMES && f.players >= MIN_META_BUILD_PLAYERS)
    .slice(0, MAX_META_BUILDS)
    .map((f, i): MetaBuild => {
      const games = decidedOf(f.samples)
      const winScore =
        0.5 + (surplusOf(games) - games.length * averageSurplus) / (games.length + PRIOR_GAMES)
      const { side, ...described } = describeBuild(f.samples)
      return {
        family: f.family,
        games: f.samples.length,
        players: f.players,
        share: f.share,
        wins: side.wins,
        losses: side.losses,
        winScore,
        winGames: games.length,
        standard:
          i === 0 &&
          f.share >= STANDARD_SHARE &&
          f.samples.length >= STANDARD_GAMES &&
          f.players >= STANDARD_PLAYERS,
        ...described,
      }
    })

  return {
    ...empty,
    ...result,
    eapmCutoff,
    games: top.length,
    players: new Set(top.map(s => nameOf(s.player))).size,
    libraryGames: top.filter(s => !s.game.ladderBaseline).length,
    fromMs,
    toMs,
    builds,
    otherShare: Math.max(0, 1 - sum(builds.map(b => b.share))),
    shortShare: totalWeight ? 1 - namedWeight / totalWeight : 0,
    seen: builds.length
      ? []
      : families
          .slice(0, MAX_META_BUILDS)
          .map(f => ({ family: f.family, games: f.samples.length, players: f.players })),
  }
}
