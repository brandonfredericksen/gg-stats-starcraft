import { MapFamily } from '../games/map-family'
import { CHECKPOINT_MINUTES, GameShape, PlayerMetrics } from '../games/player-metrics'
import { AssignedRaceChar } from '../races'
import type { DatedGameMetrics, MyStatsQuery, MyStatsShape } from './my-stats'
import { findMe, getMyResult, getSidesOf, isTeamGame, splitsByMap } from './player-games'

/** How many of the user's games a number needs before it's compared. */
export const COACH_MIN_USER_GAMES = 10
/** How many games of other players a number needs before it's a fair benchmark. */
export const COACH_MIN_POOL_GAMES = 30
/** The EAPM floors the user can pick for other players, lowest first. */
export const EAPM_FLOORS = [100, 150, 200, 250] as const
/** The EAPM other players need to count, unless the user picks another. */
export const DEFAULT_EAPM_FLOOR = EAPM_FLOORS[0]
/** How many kinds of game the coach offers as quick picks. */
const MAX_SCOPES = 6
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
  shape: GameShape
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
}

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

export type CoachResult = {
  /** The kinds of game the user has played most in the picked time range, most first. */
  scopes: CoachScope[]
  eapmFloor: number
} & ({ status: 'pickFilters' } | { status: 'ready'; buckets: CoachBucket[] })

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

interface BucketGames {
  mapFamily?: MapFamily
  user: Array<{ player: PlayerMetrics; won: boolean | undefined }>
  /** The user's games of this kind that someone left too early to compare. */
  skipped: number
  /** How many of the user's games were on each map. */
  maps: Map<string, number>
}

/**
 * Compares the user's games of one kind with other players of the same race in the same kind of
 * game, from every analyzed replay, to find what they do worse and better than most. Only games
 * matching the page's filters count for the user, and other players need at least `eapmFloor`
 * EAPM. Needs a game type and race picked, and in 1v1 the opponent's race.
 */
/** Whether a player stayed long enough, in a game even enough, for the coach to use it. */
function isComparable(game: DatedGameMetrics, player: PlayerMetrics) {
  if (player.leftAtMs !== undefined && player.leftAtMs < MIN_PLAYED_MS) {
    return false
  }
  return !(isTeamGame(game.shape) && isUneven(game))
}

/**
 * The kinds of game the user played most in range, as the coach would count them. With a game type
 * picked, only that type's, so the choices never leave the page's filters.
 */
function getScopes(
  allGames: ReadonlyArray<DatedGameMetrics>,
  names: ReadonlyArray<string>,
  shape: MyStatsShape | undefined,
  isInRange: (game: DatedGameMetrics) => boolean,
): CoachScope[] {
  const scopes = new Map<string, CoachScope>()
  for (const game of allGames) {
    const me = findMe(game, names)
    if (
      !me?.race ||
      game.shape === 'other' ||
      (shape && game.shape !== shape) ||
      !isInRange(game) ||
      !isComparable(game, me)
    ) {
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
    .slice(0, MAX_SCOPES)
}

export function computeCoach(
  allGames: ReadonlyArray<DatedGameMetrics>,
  query: MyStatsQuery,
  isInRange: (game: DatedGameMetrics) => boolean,
): CoachResult {
  const { shape, race, opponentRace } = query
  const eapmFloor = query.eapmFloor ?? DEFAULT_EAPM_FLOOR
  const scopes = getScopes(allGames, query.names, query.shape, isInRange)
  if (!shape || !race || (shape === '1v1' && !opponentRace)) {
    return { status: 'pickFilters', scopes, eapmFloor }
  }
  const teamGame = isTeamGame(shape)
  const splitByMap = splitsByMap(shape)
  // Every number that means something for this race is shown; only some can be pointed out.
  const shownMetrics = METRICS.filter(m => !m.race || m.race === race)
  const metrics = shownMetrics.filter(m => !(teamGame && m.notInTeamGames))

  const isOfKind = (game: DatedGameMetrics, player: PlayerMetrics) =>
    game.shape === shape &&
    (!query.mapFamily || !splitByMap || game.mapFamily === query.mapFamily) &&
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
    if (me && isOfKind(game, me) && isInRange(game)) {
      const bucket = buckets.get(family) ?? {
        mapFamily: splitByMap ? game.mapFamily : undefined,
        user: [],
        skipped: 0,
        maps: new Map<string, number>(),
      }
      bucket.maps.set(game.mapName, (bucket.maps.get(game.mapName) ?? 0) + 1)
      if (isComparable(game, me)) {
        const result = getMyResult(game, me, query.names)
        bucket.user.push({ player: me, won: result === 'unknown' ? undefined : result === 'win' })
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
    const user = bucket.user.map(u => u.player)
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
    return {
      shape,
      race,
      opponentRace: shape === '1v1' ? opponentRace : undefined,
      mapFamily: bucket.mapFamily,
      userGames: user.length,
      skippedGames: bucket.skipped,
      mapNames: Array.from(bucket.maps)
        .sort(([, a], [, b]) => b - a)
        .map(([name]) => name),
      wins: bucket.user.filter(u => u.won === true).length,
      losses: bucket.user.filter(u => u.won === false).length,
      poolGames: pool.length,
      opening: opening ? opening.split(',') : [],
      gaps: gaps
        .sort((a, b) => a.beats - b.beats)
        .slice(0, MAX_GAPS)
        .map(strip),
      strengths: strengths
        .sort((a, b) => b.beats - a.beats)
        .slice(0, MAX_STRENGTHS)
        .map(strip),
      inLosses: getResultFindings(
        bucket.user.filter(u => u.won === true).map(u => u.player),
        bucket.user.filter(u => u.won === false).map(u => u.player),
        metrics,
      ),
      timings: getTimings(user, pool, samePool),
      compared,
    }
  })

  return {
    status: 'ready',
    scopes,
    eapmFloor,
    buckets: results.sort((a, b) => b.userGames - a.userGames),
  }
}
