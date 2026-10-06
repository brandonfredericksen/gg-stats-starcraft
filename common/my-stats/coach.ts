import { GameStatsResult } from '../games/game-stats'
import { MapFamily } from '../games/map-family'
import { CHECKPOINT_MINUTES, PlayerMetrics } from '../games/player-metrics'
import { AssignedRaceChar } from '../races'
import type { DatedGameMetrics, MyStatsShape } from './my-stats'
import { findMe, getMyResult, getSidesOf, isTeamGame, splitsByMap } from './player-games'

/** How many of the user's games a number needs before it's compared. */
export const COACH_MIN_USER_GAMES = 10
/** How many games of other players a number needs before it's a fair benchmark. */
export const COACH_MIN_POOL_GAMES = 30
/** The EAPM floors the user can pick for other players, lowest first. */
export const EAPM_FLOORS = [100, 150, 200, 250] as const
/** The EAPM other players need to count, unless the user picks another. */
export const DEFAULT_EAPM_FLOOR = EAPM_FLOORS[0]
/** The fewest of the user's games a kind of game needs to be offered, so a stray game isn't. */
const MIN_SCOPE_GAMES = 3
/** How many wins and how many losses comparing them needs. */
export const COACH_MIN_RESULT_GAMES = 5
/** How many games one opponent can add, so someone met often doesn't become the benchmark. */
const MAX_GAMES_PER_PLAYER = 5
/** Players who left before this didn't play a game worth comparing. */
const MIN_PLAYED_MS = 5 * 60_000
/** Players with the same opening, needed to compare against them rather than everyone. */
const MIN_SAME_OPENING_GAMES = 15
/** A gap is a number worse than this share of other players, in the user's typical game. */
const GAP_SCORE = 0.3
/** A strength is a number better than this share of other players. */
const STRENGTH_SCORE = 0.7
/** How many of the user's games have to be on the same side of the benchmark for it to count. */
const CONSISTENT_SHARE = 0.6
const MAX_GAPS = 5
const MAX_STRENGTHS = 3
/** How many of the user's latest games their recent form looks at. */
export const RECENT_FORM_GAMES = 10
/** How many games before those recent form needs to compare them with. */
export const MIN_EARLIER_GAMES = 5
/** The most things the coach asks the user to work on in their next game. */
const MAX_GOALS = 3
/** A build made in fewer games than this share isn't given a typical time. */
const MIN_TIMING_SHARE = 0.25
/** Timings closer than this to other players' aren't worth pointing out. */
const MIN_TIMING_DIFF_MS = 15_000
/** Builds started this late don't say much about a build order. */
const TIMING_WINDOW_MS = 15 * 60_000

export type CoachUnit = 'count' | 'perMinute' | 'time' | 'share' | 'ratio'

export type CoachMetricKey =
  | 'workers4'
  | 'workers6'
  | 'workers8'
  | 'workers10'
  | 'income6'
  | 'income10'
  | 'production6'
  | 'production8'
  | 'production10'
  | 'secondBase'
  | 'thirdBase'
  | 'supply100'
  | 'supply150'
  | 'supply200'
  | 'bankEarly'
  | 'bankMid'
  | 'bankLate'
  | 'supplyBlocked'
  | 'army7'
  | 'army10'
  | 'armyTrade'
  | 'workersLost'
  | 'overlordsLost'
  | 'eapm'
  | 'eapmEarly'
  | 'eapmMid'
  | 'eapmLate'
  | 'apmEarly'
  | 'apmMid'
  | 'apmLate'
  | 'hotkeysEarly'
  | 'hotkeysMid'
  | 'hotkeysLate'
  | 'productionCommandsMid'
  | 'productionCommandsLate'

interface CoachMetric {
  key: CoachMetricKey
  value: (p: PlayerMetrics) => number | null | undefined
  higherIsBetter: boolean
  /** The smallest difference from other players worth pointing out. */
  minDiff: number
  unit: CoachUnit
  /** Decided by the first 8 minutes, before a game is usually won or lost. */
  early?: boolean
  /** Depends on the opening, so it's compared with players who opened the same way when possible. */
  openingDependent?: boolean
  /** Not a gap in team games, where more isn't better once bases are saturated. */
  notInTeamGames?: boolean
  /** Only means something for this race. */
  race?: AssignedRaceChar
}

const at = (minute: number) => CHECKPOINT_MINUTES.indexOf(minute)

const METRICS: ReadonlyArray<CoachMetric> = [
  ...[4, 6, 8, 10].map((minute): CoachMetric => ({
    key: `workers${minute}` as CoachMetricKey,
    value: p => p.workers[at(minute)],
    higherIsBetter: true,
    minDiff: 2,
    unit: 'count',
    early: minute <= 8,
    openingDependent: minute <= 6,
    notInTeamGames: minute > 8,
  })),
  ...[6, 10].map((minute): CoachMetric => ({
    key: `income${minute}` as CoachMetricKey,
    value: p => p.income[at(minute)],
    higherIsBetter: true,
    minDiff: 60,
    unit: 'perMinute',
    early: minute <= 8,
    openingDependent: minute <= 6,
  })),
  ...[6, 8, 10].map((minute): CoachMetric => ({
    key: `production${minute}` as CoachMetricKey,
    value: p => p.production[at(minute)],
    higherIsBetter: true,
    minDiff: 1,
    unit: 'count',
    early: minute <= 8,
    openingDependent: true,
  })),
  {
    key: 'secondBase',
    value: p => p.townHallTimesMs[0],
    higherIsBetter: false,
    minDiff: 20_000,
    unit: 'time',
    openingDependent: true,
  },
  {
    key: 'thirdBase',
    value: p => p.townHallTimesMs[1],
    higherIsBetter: false,
    minDiff: 30_000,
    unit: 'time',
    openingDependent: true,
  },
  ...[100, 150, 200].map((supply, i): CoachMetric => ({
    key: `supply${supply}` as CoachMetricKey,
    value: p => p.supplyTimesMs[i],
    higherIsBetter: false,
    minDiff: 20_000,
    unit: 'time',
  })),
  ...(['bankEarly', 'bankMid', 'bankLate'] as const).map((key, i): CoachMetric => ({
    key,
    value: p => p.bank[i],
    higherIsBetter: false,
    minDiff: 100,
    unit: 'count',
    early: i === 0,
  })),
  {
    key: 'supplyBlocked',
    value: p => p.supplyBlockedShare,
    higherIsBetter: false,
    minDiff: 0.02,
    unit: 'share',
  },
  ...[7, 10].map((minute): CoachMetric => ({
    key: `army${minute}` as CoachMetricKey,
    value: p => p.armyScore[at(minute)],
    higherIsBetter: true,
    minDiff: 200,
    unit: 'count',
    early: minute <= 8,
  })),
  {
    key: 'armyTrade',
    value: p => (p.armyKilled !== undefined && p.armyLost ? p.armyKilled / p.armyLost : null),
    higherIsBetter: true,
    minDiff: 0.2,
    unit: 'ratio',
  },
  {
    key: 'workersLost',
    value: p => p.workersLost,
    higherIsBetter: false,
    minDiff: 3,
    unit: 'count',
  },
  {
    key: 'overlordsLost',
    value: p => p.overlordsLost,
    higherIsBetter: false,
    minDiff: 1,
    unit: 'count',
    race: 'z',
  },
  { key: 'eapm', value: p => p.eapm, higherIsBetter: true, minDiff: 15, unit: 'count' },
  ...(['eapmEarly', 'eapmMid', 'eapmLate'] as const).map((key, i): CoachMetric => ({
    key,
    value: p => p.eapmByPhase?.[i],
    higherIsBetter: true,
    minDiff: 15,
    // Already a rate, like plain EAPM, so it's shown as a bare number.
    unit: 'count',
    early: i === 0,
  })),
  ...(['apmEarly', 'apmMid', 'apmLate'] as const).map((key, i): CoachMetric => ({
    key,
    value: p => p.apmByPhase?.[i],
    higherIsBetter: true,
    minDiff: 15,
    unit: 'count',
    early: i === 0,
  })),
  ...(['hotkeysEarly', 'hotkeysMid', 'hotkeysLate'] as const).map((key, i): CoachMetric => ({
    key,
    value: p => p.hotkeyRecallsPerMin?.[i],
    higherIsBetter: true,
    minDiff: 1.5,
    unit: 'perMinute',
    early: i === 0,
  })),
  ...(['productionCommandsMid', 'productionCommandsLate'] as const).map((key, i): CoachMetric => ({
    key,
    value: p => p.productionPerMin?.[i + 1],
    higherIsBetter: true,
    minDiff: 0.5,
    unit: 'perMinute',
  })),
]

/** One of the user's numbers next to other players'. */
export interface CoachFinding {
  key: CoachMetricKey
  unit: CoachUnit
  higherIsBetter: boolean
  /** The user's typical game. */
  userValue: number
  /** Other players' typical game. */
  poolValue: number
  /** The share of other players the user does better than, in their typical game, from 0 to 1. */
  beats: number
  userGames: number
  poolGames: number
  /** Whether the benchmark is players who opened the same way as the user. */
  sameOpening: boolean
  /**
   * For a bank that's too high: how many fewer production buildings the user had at 8 minutes
   * than other players, which is often why.
   */
  fewerProduction?: number
}

/** How a number differs between the user's wins and losses. */
export interface CoachResultFinding {
  key: CoachMetricKey
  unit: CoachUnit
  higherIsBetter: boolean
  winValue: number
  lossValue: number
  wins: number
  losses: number
  /** Better in wins by enough to matter, rather than about the same or better in losses. */
  notable: boolean
}

/** When the user first starts something, next to when other players do. */
export interface CoachTiming {
  /** A building, tech or upgrade level, see `buildKey`. */
  buildKey: string
  /** Missing when that side makes it in too few games to have a typical time. */
  userMs?: number
  poolMs?: number
  userGames: number
  poolGames: number
  sameOpening: boolean
  /** Both sides usually make it, and their times are far enough apart to matter. */
  notable: boolean
}

/** The coach's look at one kind of game: a game type, the user's race, and what else matters. */
export interface CoachBucket {
  shape: MyStatsShape
  race: AssignedRaceChar
  opponentRace?: AssignedRaceChar
  mapFamily?: MapFamily
  userGames: number
  /** The user's games of this kind left out because someone left in the first few minutes. */
  skippedGames: number
  /** The maps the user played these games on, most played first. */
  mapNames: string[]
  /** The user's games here with a known result, which comparing wins with losses needs. */
  wins: number
  losses: number
  poolGames: number
  /** The opening the user plays most here, as build keys. */
  opening: string[]
  gaps: CoachFinding[]
  strengths: CoachFinding[]
  inLosses: CoachResultFinding[]
  timings: CoachTiming[]
  /** Every number with enough games on both sides to compare, flagged or not, in a fixed order. */
  compared: CoachFinding[]
  recentForm: CoachRecentForm
  /** What to work on in the next game, most important first. Empty until there's enough to compare. */
  goals: CoachGoal[]
  /** What a coach would say about these games, most important first. */
  notes: CoachNote[]
}

/** One of the user's games, enough to name it and open it. */
export interface CoachGame {
  gameId: string
  gameTimeMs: number
  mapName: string
  result: GameStatsResult
}

/** How one number moved in the user's latest games, against their games before those. */
export interface CoachChange {
  key: CoachMetricKey
  unit: CoachUnit
  higherIsBetter: boolean
  recentValue: number
  earlierValue: number
  recentGames: number
  earlierGames: number
  /** Better or worse by enough to matter, or about the same. */
  direction: 'better' | 'worse' | 'same'
  /** How far it moved, in steps of the smallest difference worth pointing out. */
  size: number
}

/** The user's latest games, next to the ones before them. */
export interface CoachRecentForm {
  /** The latest games, up to {@link RECENT_FORM_GAMES}, oldest first. */
  games: CoachGame[]
  wins: number
  losses: number
  /** The games before those. */
  earlierGames: number
  earlierWins: number
  earlierLosses: number
  /** Every number with enough games on both sides, in a fixed order. */
  changes: CoachChange[]
}

/**
 * Where a goal's target comes from: other players' typical game, the user's typical win, or the
 * user's typical game before their latest ones.
 */
export type CoachGoalBasis = 'others' | 'wins' | 'earlier'

/** Something to aim for in the next game, and the number to reach. */
export interface CoachGoal {
  key: CoachMetricKey
  unit: CoachUnit
  higherIsBetter: boolean
  basis: CoachGoalBasis
  target: number
  /** The user's typical game. */
  userValue: number
  /** The user's typical game, in their latest games. Missing when too few of them have it. */
  recentValue?: number
  /** The share of other players the user does better than, for goals based on them. */
  beats?: number
  /** It's also worse in the user's losses than in their wins, so it's likely costing games. */
  inLosses: boolean
  /** The user's latest game, and whether it reached the target. Missing if it didn't have it. */
  lastValue?: number
  lastHit?: boolean
}

/** Something a coach would say, about one finding. */
export type CoachNote =
  | { kind: 'form'; form: CoachRecentForm }
  | { kind: 'inLosses'; finding: CoachResultFinding }
  | { kind: 'slipping'; change: CoachChange }
  | { kind: 'improving'; change: CoachChange }
  | { kind: 'strength'; finding: CoachFinding }
  | { kind: 'timing'; timing: CoachTiming }

/** A kind of game the coach can look at: the filters that pick it, and the user's games of it. */
export interface CoachScope {
  shape: MyStatsShape
  race: AssignedRaceChar
  /** Only in 1v1, which the coach always splits by matchup. */
  opponentRace?: AssignedRaceChar
  /** Only in game types that split by map. */
  mapFamily?: MapFamily
  games: number
}

/** The kind of game to coach, and who the user is. Without a kind picked, the most played one. */
export interface CoachQuery {
  names: string[]
  shape?: MyStatsShape
  race?: AssignedRaceChar
  /** Only used in 1v1. */
  opponentRace?: AssignedRaceChar
  /** Only used in game types that split by map, see `splitsByMap`. */
  mapFamily?: MapFamily
  /** The EAPM other players need to count. */
  eapmFloor?: number
}

export type CoachResult = {
  /** Every kind of game the user has played enough of, most played first. */
  scopes: CoachScope[]
  eapmFloor: number
} & (
  | { status: 'noGames' }
  | {
      status: 'ready'
      /** The kind of game coached: the one asked for, or the most played. */
      scope: Omit<CoachScope, 'games'>
      buckets: CoachBucket[]
    }
)

function median(values: ReadonlyArray<number>): number {
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The share of `pool` that `value` does better than, counting ties as half. */
function beatsShare(value: number, pool: ReadonlyArray<number>, higherIsBetter: boolean) {
  let score = 0
  for (const other of pool) {
    if (other === value) {
      score += 0.5
    } else if (higherIsBetter ? value > other : value < other) {
      score += 1
    }
  }
  return pool.length ? score / pool.length : 0.5
}

function numbersOf(players: ReadonlyArray<PlayerMetrics>, metric: CoachMetric): number[] {
  return players.flatMap(p => {
    const value = metric.value(p)
    return value !== null && value !== undefined && Number.isFinite(value) ? [value] : []
  })
}

function openingKey(p: PlayerMetrics) {
  return p.opening.join(',')
}

function mostCommon<T>(values: ReadonlyArray<T>): T | undefined {
  const counts = new Map<T, number>()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return Array.from(counts).sort(([, a], [, b]) => b - a)[0]?.[0]
}

/** Someone leaving early makes a team game uneven, so nothing in it is compared. */
function isUneven(game: DatedGameMetrics) {
  return game.players.some(p => p.human && p.leftAtMs !== undefined && p.leftAtMs < MIN_PLAYED_MS)
}

/**
 * How many games of other players a comparison needs: fewer when they're players who opened the
 * same way, since that group is already a closer match.
 */
function minPoolGames(sameOpening: boolean) {
  return sameOpening ? MIN_SAME_OPENING_GAMES : COACH_MIN_POOL_GAMES
}

function compare(
  metric: CoachMetric,
  user: ReadonlyArray<PlayerMetrics>,
  pool: ReadonlyArray<PlayerMetrics>,
  samePool: ReadonlyArray<PlayerMetrics> | undefined,
): CoachFinding | undefined {
  const userValues = numbersOf(user, metric)
  const sameOpening = !!(
    metric.openingDependent &&
    samePool &&
    numbersOf(samePool, metric).length >= MIN_SAME_OPENING_GAMES
  )
  const poolValues = numbersOf(sameOpening ? samePool! : pool, metric)
  if (userValues.length < COACH_MIN_USER_GAMES || poolValues.length < minPoolGames(sameOpening)) {
    return undefined
  }
  const poolValue = median(poolValues)
  return {
    key: metric.key,
    unit: metric.unit,
    higherIsBetter: metric.higherIsBetter,
    userValue: median(userValues),
    poolValue,
    beats: median(userValues.map(v => beatsShare(v, poolValues, metric.higherIsBetter))),
    userGames: userValues.length,
    poolGames: poolValues.length,
    sameOpening,
  }
}

function isBetter(metric: CoachMetric, value: number, than: number) {
  return metric.higherIsBetter ? value > than : value < than
}

/** Whether most of the user's games land on the same side of other players' typical game. */
function isConsistent(
  metric: CoachMetric,
  user: ReadonlyArray<PlayerMetrics>,
  finding: CoachFinding,
  better: boolean,
) {
  const values = numbersOf(user, metric)
  const onSide = values.filter(v => isBetter(metric, v, finding.poolValue) === better).length
  return onSide / values.length >= CONSISTENT_SHARE
}

function getResultFindings(
  wins: ReadonlyArray<PlayerMetrics>,
  losses: ReadonlyArray<PlayerMetrics>,
  metrics: ReadonlyArray<CoachMetric>,
): CoachResultFinding[] {
  const findings: Array<CoachResultFinding & { size: number }> = []
  for (const metric of metrics.filter(m => m.early)) {
    const winValues = numbersOf(wins, metric)
    const lossValues = numbersOf(losses, metric)
    if (winValues.length < COACH_MIN_RESULT_GAMES || lossValues.length < COACH_MIN_RESULT_GAMES) {
      continue
    }
    const winValue = median(winValues)
    const lossValue = median(lossValues)
    const diff = Math.abs(winValue - lossValue)
    const notable = isBetter(metric, winValue, lossValue) && diff >= metric.minDiff
    const all = [...winValues, ...lossValues]
    const middle = median(all)
    const spread = median(all.map(v => Math.abs(v - middle))) || metric.minDiff
    findings.push({
      key: metric.key,
      unit: metric.unit,
      higherIsBetter: metric.higherIsBetter,
      winValue,
      lossValue,
      wins: winValues.length,
      losses: lossValues.length,
      notable,
      size: diff / spread,
    })
  }
  // The ones that matter first, then everything else, each by how far apart wins and losses are.
  return findings
    .sort((a, b) => Number(b.notable) - Number(a.notable) || b.size - a.size)
    .map(({ size: _, ...finding }) => finding)
}

function getTimings(
  user: ReadonlyArray<PlayerMetrics>,
  pool: ReadonlyArray<PlayerMetrics>,
  samePool: ReadonlyArray<PlayerMetrics> | undefined,
): CoachTiming[] {
  const sameOpening = !!samePool && samePool.length >= MIN_SAME_OPENING_GAMES
  const comparePool = sameOpening ? samePool! : pool
  if (user.length < COACH_MIN_USER_GAMES || comparePool.length < minPoolGames(sameOpening)) {
    return []
  }
  const timesOf = (players: ReadonlyArray<PlayerMetrics>, key: string) =>
    players.flatMap(p => {
      const ms = p.firstStartsMs[key]
      return ms !== undefined && ms <= TIMING_WINDOW_MS ? [ms] : []
    })
  const typical = (times: number[], games: number) =>
    times.length >= Math.max(3, games * MIN_TIMING_SHARE) ? median(times) : undefined
  const keys = new Set([...user, ...comparePool].flatMap(p => Object.keys(p.firstStartsMs)))
  const timings: CoachTiming[] = []
  for (const key of keys) {
    const userTimes = timesOf(user, key)
    const poolTimes = timesOf(comparePool, key)
    // Whatever the user or most players usually make, so neither side's habits go missing.
    if (userTimes.length < user.length / 2 && poolTimes.length < comparePool.length / 2) {
      continue
    }
    const userMs = typical(userTimes, user.length)
    const poolMs = typical(poolTimes, comparePool.length)
    // Only things both sides usually make are pointed out, so a rare tech choice isn't read as a
    // late one.
    const bothUsual =
      userTimes.length >= user.length / 2 && poolTimes.length >= comparePool.length / 2
    timings.push({
      buildKey: key,
      userMs,
      poolMs,
      userGames: userTimes.length,
      poolGames: poolTimes.length,
      sameOpening,
      notable:
        bothUsual &&
        userMs !== undefined &&
        poolMs !== undefined &&
        Math.abs(userMs - poolMs) >= MIN_TIMING_DIFF_MS,
    })
  }
  // In build order, by when it usually starts.
  return timings.sort(
    (a, b) => (a.poolMs ?? a.userMs ?? Infinity) - (b.poolMs ?? b.userMs ?? Infinity),
  )
}

interface UserGame extends CoachGame {
  player: PlayerMetrics
}

interface BucketGames {
  mapFamily?: MapFamily
  /** The user's games of this kind that can be compared. */
  user: UserGame[]
  /** The user's games of this kind that someone left too early to compare. */
  skipped: number
  /** How many of the user's games were on each map. */
  maps: Map<string, number>
}

/** Whether a player stayed long enough, in a game even enough, for the coach to use it. */
function isComparable(game: DatedGameMetrics, player: PlayerMetrics) {
  if (player.leftAtMs !== undefined && player.leftAtMs < MIN_PLAYED_MS) {
    return false
  }
  return !(isTeamGame(game.shape) && isUneven(game))
}

/** Every kind of game the user played enough of, as the coach would count them, most first. */
function getScopes(
  allGames: ReadonlyArray<DatedGameMetrics>,
  names: ReadonlyArray<string>,
): CoachScope[] {
  const scopes = new Map<string, CoachScope>()
  for (const game of allGames) {
    const me = findMe(game, names)
    if (!me?.race || game.shape === 'other' || !isComparable(game, me)) {
      continue
    }
    const opponentRace = game.shape === '1v1' ? getSidesOf(game, me).opponents[0]?.race : undefined
    if (game.shape === '1v1' && !opponentRace) {
      continue
    }
    const mapFamily = splitsByMap(game.shape) ? game.mapFamily : undefined
    const key = `${game.shape}:${me.race}:${opponentRace ?? ''}:${mapFamily ?? ''}`
    const scope = scopes.get(key) ?? {
      shape: game.shape,
      race: me.race,
      opponentRace,
      mapFamily,
      games: 0,
    }
    scope.games += 1
    scopes.set(key, scope)
  }
  return Array.from(scopes.values())
    .filter(scope => scope.games >= MIN_SCOPE_GAMES)
    .sort((a, b) => b.games - a.games)
}

function countResults(games: ReadonlyArray<CoachGame>) {
  return {
    wins: games.filter(g => g.result === 'win').length,
    losses: games.filter(g => g.result === 'loss').length,
  }
}

/** The user's latest games, and how each number in them moved from the games before. */
function getRecentForm(
  user: ReadonlyArray<UserGame>,
  metrics: ReadonlyArray<CoachMetric>,
): CoachRecentForm {
  const recent = user.slice(-RECENT_FORM_GAMES)
  const earlier = user.slice(0, -RECENT_FORM_GAMES)
  const changes: CoachChange[] = []
  if (earlier.length >= MIN_EARLIER_GAMES) {
    for (const metric of metrics) {
      const recentValues = numbersOf(
        recent.map(g => g.player),
        metric,
      )
      const earlierValues = numbersOf(
        earlier.map(g => g.player),
        metric,
      )
      if (
        recentValues.length < COACH_MIN_RESULT_GAMES ||
        earlierValues.length < MIN_EARLIER_GAMES
      ) {
        continue
      }
      const recentValue = median(recentValues)
      const earlierValue = median(earlierValues)
      const diff = Math.abs(recentValue - earlierValue)
      let direction: CoachChange['direction'] = 'same'
      if (diff >= metric.minDiff) {
        direction = isBetter(metric, recentValue, earlierValue) ? 'better' : 'worse'
      }
      changes.push({
        key: metric.key,
        unit: metric.unit,
        higherIsBetter: metric.higherIsBetter,
        recentValue,
        earlierValue,
        recentGames: recentValues.length,
        earlierGames: earlierValues.length,
        direction,
        size: diff / metric.minDiff,
      })
    }
  }
  const earlierResults = countResults(earlier)
  return {
    games: recent.map(({ player: _, ...game }) => game),
    ...countResults(recent),
    earlierGames: earlier.length,
    earlierWins: earlierResults.wins,
    earlierLosses: earlierResults.losses,
    changes,
  }
}

/**
 * Numbers that come from the same thing, like workers at 6 and at 8 minutes. Fixing one usually
 * fixes the rest, so only one of each is made a goal.
 */
function getMetricFamily(key: CoachMetricKey) {
  return key.endsWith('Base') ? 'base' : key.replace(/(\d+|Early|Mid|Late)$/, '')
}

/**
 * What to aim for in the next game, one of each family. Gaps against other players come first,
 * the ones that also show up in the user's losses before the rest. Without enough of those, what
 * changes in their losses (aiming for their typical win), then what slipped in their latest games
 * (aiming for where they were before).
 */
function getGoals(
  gaps: ReadonlyArray<CoachFinding & { metric: CoachMetric }>,
  inLosses: ReadonlyArray<CoachResultFinding>,
  changes: ReadonlyArray<CoachChange>,
  user: ReadonlyArray<UserGame>,
): CoachGoal[] {
  const players = user.map(g => g.player)
  const recent = players.slice(-RECENT_FORM_GAMES)
  const last = players.at(-1)
  const costly = new Set(inLosses.filter(f => f.notable).map(f => f.key))
  const candidates: Array<{
    metric: CoachMetric
    basis: CoachGoalBasis
    target: number
    beats?: number
  }> = [
    ...gaps
      .toSorted(
        (a, b) => Number(costly.has(b.key)) - Number(costly.has(a.key)) || a.beats - b.beats,
      )
      .map(gap => ({
        metric: gap.metric,
        basis: 'others' as const,
        target: gap.poolValue,
        beats: gap.beats,
      })),
    ...inLosses
      .filter(f => f.notable)
      .map(f => ({
        metric: METRICS.find(m => m.key === f.key)!,
        basis: 'wins' as const,
        target: f.winValue,
      })),
    ...changes
      .filter(c => c.direction === 'worse')
      .toSorted((a, b) => b.size - a.size)
      .map(c => ({
        metric: METRICS.find(m => m.key === c.key)!,
        basis: 'earlier' as const,
        target: c.earlierValue,
      })),
  ]

  const families = new Set<string>()
  const goals: CoachGoal[] = []
  for (const { metric, basis, target, beats } of candidates) {
    const family = getMetricFamily(metric.key)
    if (goals.length >= MAX_GOALS || families.has(family)) {
      continue
    }
    families.add(family)
    const userValues = numbersOf(players, metric)
    const recentValues = numbersOf(recent, metric)
    const lastValue = last ? metric.value(last) : undefined
    const hasLast = lastValue !== null && lastValue !== undefined && Number.isFinite(lastValue)
    goals.push({
      key: metric.key,
      unit: metric.unit,
      higherIsBetter: metric.higherIsBetter,
      basis,
      target,
      userValue: median(userValues),
      recentValue: recentValues.length >= COACH_MIN_RESULT_GAMES ? median(recentValues) : undefined,
      beats,
      inLosses: costly.has(metric.key),
      lastValue: hasLast ? lastValue : undefined,
      lastHit: hasLast ? lastValue === target || isBetter(metric, lastValue, target) : undefined,
    })
  }
  return goals
}

/** The few things a coach would say first about these games, most important first. */
function getNotes(
  bucket: Pick<CoachBucket, 'recentForm' | 'inLosses' | 'strengths' | 'timings'>,
): CoachNote[] {
  const notes: CoachNote[] = []
  const form = bucket.recentForm
  if (form.earlierGames >= MIN_EARLIER_GAMES && form.wins + form.losses > 0) {
    notes.push({ kind: 'form', form })
  }
  const inLosses = bucket.inLosses.find(f => f.notable)
  if (inLosses) {
    notes.push({ kind: 'inLosses', finding: inLosses })
  }
  const biggest = (direction: CoachChange['direction']) =>
    form.changes.filter(c => c.direction === direction).sort((a, b) => b.size - a.size)[0]
  const slipping = biggest('worse')
  if (slipping) {
    notes.push({ kind: 'slipping', change: slipping })
  }
  const improving = biggest('better')
  if (improving) {
    notes.push({ kind: 'improving', change: improving })
  }
  if (bucket.strengths.length) {
    notes.push({ kind: 'strength', finding: bucket.strengths[0] })
  }
  const timingGap = (t: CoachTiming) => Math.abs((t.userMs ?? 0) - (t.poolMs ?? 0))
  const timing = bucket.timings
    .filter(t => t.notable)
    .sort((a, b) => timingGap(b) - timingGap(a))[0]
  if (timing) {
    notes.push({ kind: 'timing', timing })
  }
  return notes
}

/**
 * Compares the user's games of one kind with other players of the same race in the same kind of
 * game, from every analyzed replay, to find what they do worse and better than most, how they've
 * played lately, and what to work on next. Other players need at least `eapmFloor` EAPM. Without a
 * kind of game picked, it looks at the one the user played most.
 */
export function computeCoach(
  allGames: ReadonlyArray<DatedGameMetrics>,
  query: CoachQuery,
): CoachResult {
  const eapmFloor = query.eapmFloor ?? DEFAULT_EAPM_FLOOR
  const scopes = getScopes(allGames, query.names)
  const picked =
    query.shape && query.race && (query.shape !== '1v1' || query.opponentRace) ? query : scopes[0]
  if (!picked?.shape || !picked.race) {
    return { status: 'noGames', scopes, eapmFloor }
  }
  const shape = picked.shape
  const race = picked.race
  const opponentRace = shape === '1v1' ? picked.opponentRace : undefined
  const teamGame = isTeamGame(shape)
  const splitByMap = splitsByMap(shape)
  const mapFamily = splitByMap ? picked.mapFamily : undefined
  // Every number that means something for this race is shown; only some can be pointed out.
  const shownMetrics = METRICS.filter(m => !m.race || m.race === race)
  const metrics = shownMetrics.filter(m => !(teamGame && m.notInTeamGames))

  const isOfKind = (game: DatedGameMetrics, player: PlayerMetrics) =>
    game.shape === shape &&
    (!mapFamily || game.mapFamily === mapFamily) &&
    player.race === race &&
    player.human &&
    (shape !== '1v1' || getSidesOf(game, player).opponents[0]?.race === opponentRace)
  const fitsBucket = (game: DatedGameMetrics, player: PlayerMetrics) =>
    isOfKind(game, player) && isComparable(game, player)

  const buckets = new Map<string, BucketGames>()
  const poolByFamily = new Map<string, PlayerMetrics[]>()
  const gamesPerName = new Map<string, number>()
  for (const game of allGames) {
    const family = splitByMap ? game.mapFamily : 'any'
    const me = findMe(game, query.names)
    if (me && isOfKind(game, me)) {
      const bucket = buckets.get(family) ?? {
        mapFamily: splitByMap ? game.mapFamily : undefined,
        user: [],
        skipped: 0,
        maps: new Map<string, number>(),
      }
      bucket.maps.set(game.mapName, (bucket.maps.get(game.mapName) ?? 0) + 1)
      if (isComparable(game, me)) {
        bucket.user.push({
          player: me,
          gameId: game.gameId,
          gameTimeMs: game.gameTimeMs,
          mapName: game.mapName,
          result: getMyResult(game, me, query.names),
        })
      } else {
        bucket.skipped += 1
      }
      buckets.set(family, bucket)
    }
    for (const p of game.players) {
      if (p === me || !fitsBucket(game, p) || (p.eapm ?? 0) < eapmFloor) {
        continue
      }
      const name = p.names.join(' + ').toLowerCase()
      const played = gamesPerName.get(`${family}:${name}`) ?? 0
      if (played >= MAX_GAMES_PER_PLAYER) {
        continue
      }
      gamesPerName.set(`${family}:${name}`, played + 1)
      poolByFamily.set(family, [...(poolByFamily.get(family) ?? []), p])
    }
  }

  const results = Array.from(buckets, ([family, bucket]): CoachBucket => {
    const userGames = bucket.user.toSorted((a, b) => a.gameTimeMs - b.gameTimeMs)
    const user = userGames.map(g => g.player)
    const pool = poolByFamily.get(family) ?? []
    const opening = mostCommon(user.map(openingKey).filter(Boolean))
    const samePool = opening ? pool.filter(p => openingKey(p) === opening) : undefined

    const gaps: Array<CoachFinding & { metric: CoachMetric }> = []
    const strengths: Array<CoachFinding & { metric: CoachMetric }> = []
    const compared: CoachFinding[] = []
    for (const metric of shownMetrics) {
      const finding = compare(metric, user, pool, samePool)
      if (finding) {
        compared.push(finding)
      }
      if (
        !finding ||
        !metrics.includes(metric) ||
        Math.abs(finding.userValue - finding.poolValue) < metric.minDiff
      ) {
        continue
      }
      if (finding.beats < GAP_SCORE && isConsistent(metric, user, finding, false)) {
        gaps.push({ ...finding, metric })
      } else if (finding.beats > STRENGTH_SCORE && isConsistent(metric, user, finding, true)) {
        strengths.push({ ...finding, metric })
      }
    }

    // A high bank with fewer production buildings than others is a production problem, not a
    // speed one, most of all for Zerg, whose larvae limit what they can spend.
    const production8 = METRICS.find(m => m.key === 'production8')!
    const productionFinding = compare(production8, user, pool, samePool)
    for (const gap of gaps) {
      if (gap.key.startsWith('bank') && productionFinding) {
        const fewer = productionFinding.poolValue - productionFinding.userValue
        if (fewer >= 1) {
          gap.fewerProduction = fewer
        }
      }
    }

    const strip = ({ metric: _, ...finding }: CoachFinding & { metric: CoachMetric }) => finding
    const topGaps = gaps.sort((a, b) => a.beats - b.beats).slice(0, MAX_GAPS)
    const inLosses = getResultFindings(
      userGames.filter(g => g.result === 'win').map(g => g.player),
      userGames.filter(g => g.result === 'loss').map(g => g.player),
      metrics,
    )
    const recentForm = getRecentForm(userGames, shownMetrics)
    const withoutNotes = {
      shape,
      race,
      opponentRace,
      mapFamily: bucket.mapFamily,
      userGames: user.length,
      skippedGames: bucket.skipped,
      mapNames: Array.from(bucket.maps)
        .sort(([, a], [, b]) => b - a)
        .map(([name]) => name),
      ...countResults(userGames),
      poolGames: pool.length,
      opening: opening ? opening.split(',') : [],
      gaps: topGaps.map(strip),
      strengths: strengths
        .sort((a, b) => b.beats - a.beats)
        .slice(0, MAX_STRENGTHS)
        .map(strip),
      inLosses,
      timings: getTimings(user, pool, samePool),
      compared,
      recentForm,
      goals:
        user.length >= COACH_MIN_USER_GAMES
          ? getGoals(topGaps, inLosses, recentForm.changes, userGames)
          : [],
    }
    return { ...withoutNotes, notes: getNotes(withoutNotes) }
  })

  return {
    status: 'ready',
    scopes,
    eapmFloor,
    scope: { shape, race, opponentRace, mapFamily },
    buckets: results.sort((a, b) => b.userGames - a.userGames),
  }
}
