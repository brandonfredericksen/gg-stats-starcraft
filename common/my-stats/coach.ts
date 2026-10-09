import { GameStatsResult } from '../games/game-stats'
import { LADDER_RANKS, LadderRank } from '../games/ladder'
import { getMapDisplayName, getMapKey, MapFamily } from '../games/map-family'
import { CHECKPOINT_MINUTES, PlayerMetrics } from '../games/player-metrics'
import { AssignedRaceChar } from '../races'
import { getBuildFamily } from './build-family'
import {
  BuildSample,
  CoachBuild,
  CoachTeamBuild,
  summarizeBuilds,
  summarizeTeamBuilds,
  TeamBuildSample,
} from './builds'
import type { DatedGameMetrics, MyStatsShape } from './my-stats'
import { findMe, getMyResult, getSidesOf, isTeamGame, splitsByMap } from './player-games'

/** How many of the user's games a number needs before it's compared. */
export const COACH_MIN_USER_GAMES = 10
/** How many games of other players a number needs before it's a fair benchmark. */
export const COACH_MIN_POOL_GAMES = 30
/** The EAPM floors the user can pick for other players, lowest first. */
export const EAPM_FLOORS = [100, 150, 200, 250] as const
/** The lowest EAPM other players need to count, and the floor My stats starts on. */
export const DEFAULT_EAPM_FLOOR = EAPM_FLOORS[0]
/**
 * Unless the user picks a floor, other players need about this share of the user's own EAPM, so
 * they're compared with players about as fast as they are: the ones they play against.
 */
const AUTO_FLOOR_SHARE = 0.9
/** How many of the user's latest games the user can pick to look at, besides `auto` and `all`. */
export const COACH_WINDOW_GAMES = [25, 50, 100] as const
/**
 * Which of the user's games the coach looks at: their latest few, every one, or `auto`, which
 * looks at the last {@link AUTO_WINDOW_MS} of their games but no fewer than
 * {@link AUTO_WINDOW_MIN_GAMES}, so someone who plays a lot gets their latest weeks and someone
 * who plays a little still gets enough games.
 */
export type CoachWindow = 'auto' | 'all' | (typeof COACH_WINDOW_GAMES)[number]
const AUTO_WINDOW_MS = 90 * 24 * 60 * 60_000
const AUTO_WINDOW_MIN_GAMES = 30
/** The fewest of the user's games a kind of game needs to be offered, so a stray game isn't. */
const MIN_SCOPE_GAMES = 3
/** How many wins and how many losses comparing them needs. */
export const COACH_MIN_RESULT_GAMES = 5
/** How many games one opponent can add, so someone met often doesn't become the benchmark. */
const MAX_GAMES_PER_PLAYER = 5
/**
 * Players who quit before this didn't play a game worth comparing, and in a team game left the
 * rest playing an uneven one. Being defeated this early is a rush that worked, which counts.
 */
const MIN_PLAYED_MS = 5 * 60_000
/** Numbers over a whole game, like workers lost, need this much of it played to mean anything. */
const MIN_WHOLE_GAME_PLAYED_MS = 8 * 60_000
/**
 * In team games, numbers over a whole game need everyone still in for this long, or until the
 * last minute of a shorter game, so they don't come from a game played a player down.
 */
const WHOLE_GAME_EVEN_MS = 10 * 60_000
/** Players with the same opening, needed to compare against them rather than everyone. */
const MIN_SAME_OPENING_GAMES = 15
/** A second town hall started before this is expanding first, rather than after a one base build. */
const FAST_EXPAND_MS = 4 * 60_000
/** Tech started after this isn't part of how a player opened anymore. */
const OPENING_TECH_MS = 6 * 60_000
/** Teammates who go out within this of each other fell together. */
const TOGETHER_MS = 30_000
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
/** Numbers up to this minute say how a game went before it was usually won or lost. */
const EARLY_MINUTE = 8
/** Big Game Hunters is decided later, so losses there are compared on numbers up to this minute. */
const BGH_EARLY_MINUTE = 15
/** How many of the user's latest games their recent form looks at. */
export const RECENT_FORM_GAMES = 10
/** How many of the user's latest games each goal is checked against. */
export const GOAL_CHECK_GAMES = 5
/** How far back a goal's check looks for games that have its number, like ones nobody left early. */
const GOAL_CHECK_LOOKBACK = 15
/**
 * How far apart the user's wins and losses have to be for a difference to count, in steps of how
 * much the number usually varies. With a dozen of each, smaller differences are mostly chance.
 */
const MIN_RESULT_SIZE = 0.75
/** How many games before those recent form needs to compare them with. */
export const MIN_EARLIER_GAMES = 5
/** The most things the coach asks the user to work on in their next game. */
const MAX_GOALS = 3
/**
 * How much more often than other players the user has to be the first of their team out, in
 * losses, for the coach to say so.
 */
const FIRST_OUT_MARGIN = 0.15
/**
 * Games together that make a teammate a regular partner, rather than someone a lobby put the user
 * with once.
 */
const REGULAR_PARTNER_GAMES = 3

/** Town halls, supply, gas, Barracks, Gateways, Spawning Pools and static defense. */
const BASIC_BUILDING_IDS: ReadonlySet<number> = new Set([
  106, 109, 110, 111, 124, 125, 131, 142, 143, 144, 146, 149, 154, 156, 157, 160, 162, 172,
])
/**
 * Buildings that only unlock upgrades or static defense: the Forge, Engineering Bay and Evolution
 * Chamber. When they come follows the plan; the upgrade they start is what to time.
 */
const UPGRADE_BUILDING_IDS: ReadonlySet<number> = new Set([122, 139, 166])
/** Photon Cannons, Bunkers, Missile Turrets and Creep, Sunken and Spore Colonies. */
const STATIC_DEFENSE_IDS: ReadonlySet<number> = new Set([124, 125, 143, 144, 146, 162])
const GATEWAY_KEY = 'u160'
const CYBERNETICS_CORE_KEY = 'u164'
const FORGE_KEY = 'u166'
const BARRACKS_KEY = 'u111'
const HATCHERY_KEY = 'u131'
const SPAWNING_POOL_KEY = 'u142'
/** A Spawning Pool started before this is an early pool, like a 9 pool, rather than a 12 pool. */
const EARLY_POOL_MS = 90_000
/**
 * About what one production building spends a minute making units nonstop: Zealots and Dragoons
 * from a Gateway, Marines from a Barracks.
 */
const SPEND_PER_PRODUCTION: Partial<Record<AssignedRaceChar, number>> = { p: 250, t: 200 }

/** Buildings that show which way a player is going: tech, and production beyond the first kind. */
const TECH_BUILDING_IDS: ReadonlySet<number> = new Set([
  112, 113, 114, 115, 116, 117, 122, 123, 132, 133, 135, 136, 137, 138, 139, 140, 141, 155, 159,
  163, 164, 165, 166, 167, 169, 170, 171,
])

export type CoachUnit =
  | 'count'
  | 'perMinute'
  | 'perTenMinutes'
  | 'time'
  | 'share'
  | 'ratio'
  | 'percent'

export type CoachMetricKey =
  | 'workers4'
  | 'workers6'
  | 'workers8'
  | 'workers10'
  | 'workers12'
  | 'workers15'
  | 'workerLead8'
  | 'workerProduction8'
  | 'larvaeFull10'
  | 'scoutTime'
  | 'detection'
  | 'baseLead10'
  | 'income6'
  | 'income10'
  | 'income12'
  | 'income15'
  | 'production6'
  | 'production8'
  | 'production10'
  | 'production12'
  | 'production15'
  | 'productionForIncome10'
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
  | 'army12'
  | 'army15'
  | 'armyKilled'
  | 'armyLost'
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

/** The kind of game being coached, which decides what's compared and what can be pointed out. */
interface CoachContext {
  shape: MyStatsShape
  race: AssignedRaceChar
  /** In 1v1, the opponent's race. */
  opponentRace?: AssignedRaceChar
  teamGame: boolean
  mapFamily?: MapFamily
  /** Fastest and Big Game Hunters, where income is so high that spending decides games. */
  moneyMap: boolean
}

/** One player in one game, with what's needed to read their numbers fairly. */
interface Sample {
  player: PlayerMetrics
  game: DatedGameMetrics
  playedMs: number
  /** In team games, when the first player went out; every number after that is a player down. */
  evenUntilMs: number
  teammates: PlayerMetrics[]
  /** In 1v1, the other player. */
  opponent?: PlayerMetrics
}

interface CoachMetric {
  key: CoachMetricKey
  value: (s: Sample) => number | null | undefined
  higherIsBetter: boolean
  /** The smallest difference from other players worth pointing out. */
  minDiff: number
  /**
   * The smallest difference as a share of the number it's compared with, for numbers that grow
   * with the kind of game, like mining on a money map. The larger of this and `minDiff` counts.
   */
  relativeDiff?: number
  unit: CoachUnit
  /** The minute the number is read at. Numbers over a whole game, or a phase of it, have none. */
  minute?: number
  /** Over the late game, from 12 minutes to the end, which needs everyone in until near the end. */
  lateGame?: boolean
  /**
   * Depends on how the player opened, so it's compared with players who opened the same way when
   * there are enough of them.
   */
  openingDependent?: boolean
  /**
   * How fast the player plays. Compared with every player, not only those over the EAPM floor,
   * which would make anyone near the floor slower than everyone by definition. Never put ahead of
   * the basics as a goal.
   */
  speed?: boolean
  /** Played time the number needs, for numbers over a whole game. */
  minPlayedMs?: number
  /** Whether it's compared at all in this kind of game. */
  shownIn?: (context: CoachContext) => boolean
  /** Whether it can be pointed out as a gap, strength or goal here, rather than only listed. */
  pointsOut?: (context: CoachContext) => boolean
  /** Only ever listed: never pointed out as a gap, strength, note or goal. */
  listedOnly?: boolean
  /**
   * Whether the user's typical number is a problem however many other players share it, like
   * being supply blocked for a long time. Other players' typical number is passed too.
   */
  gapWhen?: (user: number, pool: number) => boolean
}

const at = (minute: number) => CHECKPOINT_MINUTES.indexOf(minute)
const onBgh = (context: CoachContext) => context.mapFamily === 'bgh'
const in1v1 = (context: CoachContext) => context.shape === '1v1'

/** Per 10 minutes the player played, so a player who left early doesn't look careful. */
function perTenMinutes(count: number | undefined, s: Sample) {
  return count === undefined || !s.playedMs ? undefined : (count / s.playedMs) * 10 * 60_000
}

const METRICS: ReadonlyArray<CoachMetric> = [
  ...[4, 6, 8, 10, 12, 15].map((minute): CoachMetric => ({
    key: `workers${minute}` as CoachMetricKey,
    value: s => s.player.workers[at(minute)],
    higherIsBetter: true,
    minDiff: minute <= 10 ? 2 : 3,
    unit: 'count',
    minute,
    openingDependent: minute <= 10,
    shownIn: minute > 10 ? onBgh : undefined,
    // Once bases are full in a team game, more isn't better.
    pointsOut: minute === 10 ? context => !context.teamGame : undefined,
  })),
  {
    key: 'workerProduction8',
    value: s => s.player.workerProduction8,
    higherIsBetter: true,
    minDiff: 0.05,
    unit: 'percent',
    minute: 8,
    openingDependent: true,
    // Zerg make workers from larvae, which the number can't tell.
    shownIn: context => context.race !== 'z',
    // A player can be fully saturated on a money map's main and rightly stop.
    gapWhen: (user, pool) => user < 0.75 && user < pool,
  },
  {
    key: 'larvaeFull10',
    value: s => s.player.larvaeFull10,
    higherIsBetter: false,
    minDiff: 0.05,
    unit: 'percent',
    minute: 10,
    openingDependent: true,
    shownIn: context => context.race === 'z',
    // A Hatchery sitting on three larvae a quarter of the time wastes too much to ignore.
    gapWhen: (user, pool) => user >= 0.25 && user > pool,
  },
  {
    key: 'scoutTime',
    value: s => s.player.firstScoutMs,
    higherIsBetter: false,
    minDiff: 20_000,
    unit: 'time',
    openingDependent: true,
    // On a money map the whole team's bases are far apart, and nobody scouts to read a build.
    shownIn: context => !context.moneyMap,
    pointsOut: in1v1,
  },
  {
    key: 'detection',
    value: s => s.player.detectionMs,
    higherIsBetter: false,
    minDiff: 30_000,
    unit: 'time',
    openingDependent: true,
    // Zerg have Overlords from the start, and a 1v1 against Terran has nothing cloaked early.
    shownIn: context => context.race !== 'z' && (context.teamGame || context.opponentRace !== 't'),
  },
  {
    key: 'workerLead8',
    value: s => {
      const mine = s.player.workers[at(8)]
      const theirs = s.opponent?.workers[at(8)]
      return mine !== null && theirs !== null && theirs !== undefined ? mine - theirs : undefined
    },
    higherIsBetter: true,
    minDiff: 2,
    unit: 'count',
    minute: 8,
    openingDependent: true,
    shownIn: in1v1,
  },
  {
    key: 'baseLead10',
    value: s => {
      const mine = s.player.bases?.[at(10)]
      const theirs = s.opponent?.bases?.[at(10)]
      return mine !== null && mine !== undefined && theirs !== null && theirs !== undefined
        ? mine - theirs
        : undefined
    },
    higherIsBetter: true,
    minDiff: 1,
    unit: 'count',
    minute: 10,
    openingDependent: true,
    shownIn: in1v1,
  },
  ...[6, 10, 12, 15].map((minute): CoachMetric => ({
    key: `income${minute}` as CoachMetricKey,
    value: s => s.player.income[at(minute)],
    higherIsBetter: true,
    minDiff: 60,
    relativeDiff: 0.06,
    unit: 'perMinute',
    minute,
    openingDependent: minute <= 10,
    shownIn: minute > 10 ? onBgh : undefined,
  })),
  ...[6, 8, 10, 12, 15].map((minute): CoachMetric => ({
    key: `production${minute}` as CoachMetricKey,
    value: s => s.player.production[at(minute)],
    higherIsBetter: true,
    minDiff: 1,
    relativeDiff: 0.15,
    unit: 'count',
    minute,
    openingDependent: minute <= 10,
    shownIn: minute > 10 ? onBgh : undefined,
    // On a money map, how many buildings is right depends on the income, which the number
    // for income covers.
    pointsOut: context => !context.moneyMap || SPEND_PER_PRODUCTION[context.race] === undefined,
  })),
  {
    key: 'productionForIncome10',
    value: s => {
      const buildings = s.player.production[at(10)]
      const income = s.player.income[at(10)]
      const spend = s.player.race ? SPEND_PER_PRODUCTION[s.player.race] : undefined
      return buildings !== null && income && spend ? buildings / (income / spend) : undefined
    },
    higherIsBetter: true,
    minDiff: 0.15,
    unit: 'percent',
    minute: 10,
    shownIn: context => context.moneyMap && SPEND_PER_PRODUCTION[context.race] !== undefined,
    gapWhen: user => user < 0.8,
  },
  ...(['secondBase', 'thirdBase'] as const).map((key, i): CoachMetric => ({
    key,
    value: s => s.player.townHallTimesMs[i],
    higherIsBetter: false,
    minDiff: i === 0 ? 20_000 : 30_000,
    unit: 'time',
    openingDependent: true,
    // The main lasts a long time on a money map, and an early base there only invites a
    // whole team onto it.
    pointsOut: context => !context.moneyMap,
  })),
  ...[100, 150, 200].map((supply, i): CoachMetric => ({
    key: `supply${supply}` as CoachMetricKey,
    value: s => s.player.supplyTimesMs[i],
    higherIsBetter: false,
    minDiff: 20_000,
    unit: 'time',
    openingDependent: supply === 100,
  })),
  ...(['bankEarly', 'bankMid', 'bankLate'] as const).map((key, i): CoachMetric => ({
    key,
    value: s => s.player.bank[i],
    higherIsBetter: false,
    // Money saved for tech or a base is normal, and more of it is later on.
    minDiff: [100, 250, 500][i],
    relativeDiff: 0.15,
    unit: 'count',
    minute: [6, 12, undefined][i],
    lateGame: i === 2,
    openingDependent: i === 0,
    pointsOut: i === 2 ? context => !context.moneyMap : undefined,
  })),
  {
    key: 'supplyBlocked',
    value: s => s.player.supplyBlockedShare,
    higherIsBetter: false,
    minDiff: 0.02,
    unit: 'share',
    // 30 seconds every 10 minutes is a habit to fix, even when most players have it too.
    gapWhen: user => user >= 0.05,
  },
  ...[7, 10, 12, 15].map((minute): CoachMetric => ({
    key: `army${minute}` as CoachMetricKey,
    value: s => s.player.armyScore[at(minute)],
    higherIsBetter: true,
    minDiff: 200,
    relativeDiff: 0.1,
    unit: 'count',
    minute,
    openingDependent: minute <= 10,
    shownIn: minute > 10 ? onBgh : undefined,
    // In 1v1, the fewest units that keep a player safe early is the skill, not the most.
    pointsOut: minute === 7 ? context => !in1v1(context) : undefined,
  })),
  // Totals over the whole game grow with its length, so they're listed but never pointed out.
  ...(['armyKilled', 'armyLost'] as const).map(key => ({
    key,
    value: (s: Sample) => s.player[key],
    higherIsBetter: key === 'armyKilled',
    minDiff: 300,
    unit: 'count' as const,
    minPlayedMs: MIN_WHOLE_GAME_PLAYED_MS,
    listedOnly: true,
  })),
  {
    key: 'armyTrade',
    value: s =>
      s.player.armyKilled !== undefined && s.player.armyLost
        ? s.player.armyKilled / s.player.armyLost
        : undefined,
    higherIsBetter: true,
    minDiff: 0.2,
    unit: 'ratio',
    minPlayedMs: MIN_WHOLE_GAME_PLAYED_MS,
  },
  {
    key: 'workersLost',
    value: s => perTenMinutes(s.player.workersLost, s),
    higherIsBetter: false,
    minDiff: 1.5,
    unit: 'perTenMinutes',
    minPlayedMs: MIN_WHOLE_GAME_PLAYED_MS,
    // Most players lose almost none, so how many fewer than the user they lose says more than
    // how many players lose fewer.
    gapWhen: (user, pool) => user >= 2 && user >= pool * 2,
  },
  {
    key: 'overlordsLost',
    value: s => perTenMinutes(s.player.overlordsLost, s),
    higherIsBetter: false,
    minDiff: 0.5,
    unit: 'perTenMinutes',
    minPlayedMs: MIN_WHOLE_GAME_PLAYED_MS,
    shownIn: context => context.race === 'z',
  },
  {
    key: 'eapm',
    value: s => s.player.eapm,
    higherIsBetter: true,
    minDiff: 15,
    unit: 'count',
    speed: true,
  },
  ...(['eapmEarly', 'eapmMid', 'eapmLate'] as const).map((key, i): CoachMetric => ({
    key,
    value: s => s.player.eapmByPhase?.[i],
    higherIsBetter: true,
    minDiff: 15,
    // Already a rate, like plain EAPM, so it's shown as a bare number.
    unit: 'count',
    minute: [6, 12, undefined][i],
    lateGame: i === 2,
    speed: true,
  })),
  ...(['apmEarly', 'apmMid', 'apmLate'] as const).map((key, i): CoachMetric => ({
    key,
    value: s => s.player.apmByPhase?.[i],
    higherIsBetter: true,
    minDiff: 15,
    unit: 'count',
    minute: [6, 12, undefined][i],
    lateGame: i === 2,
    speed: true,
  })),
  ...(['hotkeysEarly', 'hotkeysMid', 'hotkeysLate'] as const).map((key, i): CoachMetric => ({
    key,
    value: s => s.player.hotkeyRecallsPerMin?.[i],
    higherIsBetter: true,
    minDiff: 1.5,
    relativeDiff: 0.15,
    unit: 'perMinute',
    minute: [6, 12, undefined][i],
    lateGame: i === 2,
    speed: true,
  })),
  // Orders for each production building, which shows how often it sits idle, whatever the count.
  ...(['productionCommandsMid', 'productionCommandsLate'] as const).map((key, i): CoachMetric => ({
    key,
    value: s => {
      const orders = s.player.productionPerMin?.[i + 1]
      const buildings = s.player.production[at(i === 0 ? 10 : 15)]
      return orders !== null && orders !== undefined && buildings ? orders / buildings : undefined
    },
    higherIsBetter: true,
    minDiff: 0.2,
    unit: 'perMinute',
    minute: [12, undefined][i],
    lateGame: i === 1,
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
  /**
   * Why a timing both sides have isn't notable: only one side usually makes it, the times are
   * close, or it's an upgrade or defense building, whose timing follows the plan.
   */
  quietBecause?: 'oneSide' | 'close' | 'followsPlan'
}

/**
 * A moment in one of the user's latest games that shows a goal going wrong, to watch again: the
 * game that missed it by the most, and when.
 */
export interface CoachReview {
  game: CoachGame
  /** When it went wrong, or started to. */
  atMs: number
  /** When it stopped going wrong, for something that lasted, like a supply block. */
  endMs?: number
  /** What happened then, for numbers with a moment of their own. */
  kind: 'supplyBlock' | 'bankPeak' | 'workerLoss' | 'minute' | 'timing'
  /**
   * The amount at that moment, like the money on hand or the workers lost: the number itself, for
   * one read at a minute, or when the build started, for a timing.
   */
  amount?: number
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
  /**
   * In team games where the user mostly played with regular partners before, how many of the
   * latest games had none of them. Zero for a user who plays with whoever a lobby gives them.
   */
  newPartnerGames: number
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
  /** A number, or `buildTiming` for when to start a building, tech or upgrade. */
  key: CoachMetricKey | 'buildTiming'
  /** For a build timing, what to start, see `buildKey`. */
  buildKey?: string
  unit: CoachUnit
  higherIsBetter: boolean
  basis: CoachGoalBasis
  /** What to reach, rounded so that reaching the rounded number reaches the real one. */
  target: number
  /** The user's typical game, or for a goal based on their wins, their typical loss. */
  userValue: number
  /** The user's typical game, in their latest games. Missing when too few of them have it. */
  recentValue?: number
  /** The share of other players the user does better than, for goals based on them. */
  beats?: number
  /** It's also worse in the user's losses than in their wins, so it's likely costing games. */
  inLosses: boolean
  /**
   * Whether each of the user's latest {@link GOAL_CHECK_GAMES} games with this number reached the
   * target, oldest first. A team game where someone left before the number's minute doesn't have
   * it.
   */
  checks: boolean[]
  /** The moment in those games that missed the target by the most, to watch again. */
  review?: CoachReview
}

/** How often the user is the first of their team out in losses, against other players. */
export interface CoachFirstOut {
  losses: number
  firstOut: number
  /** The share of other players' losses where they were the first of their team out. */
  poolShare: number
}

/** Something a coach would say, about one finding. */
export type CoachNote =
  | { kind: 'form'; form: CoachRecentForm }
  | { kind: 'inLosses'; finding: CoachResultFinding }
  | { kind: 'firstOut'; firstOut: CoachFirstOut }
  | { kind: 'slipping'; change: CoachChange }
  | { kind: 'improving'; change: CoachChange }
  | { kind: 'strength'; finding: CoachFinding }
  | { kind: 'timing'; timing: CoachTiming }

/** The builds played against one pair of races. */
export interface CoachBuildsAgainst {
  /** The opponents' races, in alphabetical order, like `pz`. */
  opponents: string
  games: number
  builds: CoachBuild[]
  userBuild?: string
}

/** The coach's look at one kind of game: a game type, the user's race, and what else matters. */
export interface CoachBucket {
  shape: MyStatsShape
  race: AssignedRaceChar
  opponentRace?: AssignedRaceChar
  /** In 2v2, the teammate's race. */
  allyRace?: AssignedRaceChar
  /**
   * In 2v2, whether other players are compared whatever their teammate's race, since too few had
   * one of the same race as the user's.
   */
  anyAlly: boolean
  /** In 1v1, the ladder rank other players needed to count. */
  rank?: LadderRank
  mapFamily?: MapFamily
  /** The one map these games are on, when one was picked, named without versions or tags. */
  onMap?: string
  userGames: number
  /** The user's games of this kind left out because someone quit in the first few minutes. */
  skippedGames: number
  /** The maps the user played these games on, most played first. */
  mapNames: string[]
  /** The user's games here with a known result, which comparing wins with losses needs. */
  wins: number
  losses: number
  /**
   * The losses compared with wins: in team games, losses where a teammate went out first say
   * little about how the user played, so they're left out.
   */
  lossesCompared: number
  poolGames: number
  /** How many different players {@link poolGames} come from. */
  poolPlayers: number
  /** Of {@link poolGames}, how many are from games the user played in, like their opponents'. */
  poolFromUserGames: number
  /** Of {@link poolGames}, how many are from the ladder baseline the app ships. */
  poolFromBaseline: number
  /** The opening the user plays most here, as build keys. */
  opening: string[]
  gaps: CoachFinding[]
  /**
   * With no gaps, the number the user is furthest behind other players on, if they're behind
   * most of them, so an empty list can still say what's closest.
   */
  closestGap?: CoachFinding
  strengths: CoachFinding[]
  inLosses: CoachResultFinding[]
  timings: CoachTiming[]
  /** The builds played here, the most played first, with how the user plays theirs. */
  builds: CoachBuild[]
  /** The build the user plays most here, see `getBuildFamily`. */
  userBuild?: string
  /** In 2v2, the builds played here against each pair of races, for pairs with enough games. */
  buildsAgainst?: CoachBuildsAgainst[]
  /** In 2v2, the pairs of builds teams played here, the most played first. */
  teamBuilds?: CoachTeamBuild[]
  /** Every number with enough games on both sides to compare, flagged or not, in a fixed order. */
  compared: CoachFinding[]
  recentForm: CoachRecentForm
  /** In team games, how often the user went out first in their losses. */
  firstOut?: CoachFirstOut
  /** What to work on in the next game, most important first. */
  goals: CoachGoal[]
  /** What a coach would say about these games, most important first. */
  notes: CoachNote[]
}

/** A kind of game the coach can look at: the filters that pick it, and the user's games of it. */
export interface CoachScope {
  shape: MyStatsShape
  race: AssignedRaceChar
  /** Only in 1v1, which the coach always splits by matchup. */
  opponentRace?: AssignedRaceChar
  /** Only in 2v2, which the coach splits by the teammate's race. */
  allyRace?: AssignedRaceChar
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
  /** Only used in 2v2. */
  allyRace?: AssignedRaceChar
  /** Only used in game types that split by map, see `splitsByMap`. */
  mapFamily?: MapFamily
  /** One map to look at, in game types that don't split by map, see `getMapKey`. */
  mapKey?: string
  /** The EAPM other players need to count. */
  eapmFloor?: number
  /**
   * Only used in 1v1: the ladder rank other players need to have had going into a game for it to
   * count, or `any`. Unless picked, the rank of the user's latest ranked game, if they have one.
   */
  rank?: LadderRank | 'any'
  /** Which of the user's games to look at. `auto` unless picked. */
  window?: CoachWindow
  /** Leaves out every game played before this time, the user's and other players' alike. */
  fromMs?: number
}

export type CoachResult = {
  /** Every kind of game the user has played enough of, most played first. */
  scopes: CoachScope[]
  eapmFloor: number
  /** The ladder rank other players were picked by, in 1v1. */
  rank?: LadderRank
  /** In 1v1, the rank of the user's latest ranked game here, which `auto` picks. */
  autoRank?: LadderRank
  /** In 1v1, the MMRs each rank covers. */
  rankMmr?: RankMmr
} & (
  | { status: 'noGames' }
  | {
      status: 'ready'
      /** The kind of game coached: the one asked for, or the most played. */
      scope: Omit<CoachScope, 'games'>
      window: CoachWindow
      /** How many of the user's latest games `auto` looks at here. */
      autoGames: number
      /**
       * Whether those are the user's last 3 months of games, rather than the fewest `auto` looks
       * at, for a player with fewer games than that in 3 months.
       */
      autoMonths: boolean
      /**
       * The time of the first game looked at, when the window leaves some out. Other players'
       * games before it are left out too, so both come from the same patch and meta.
       */
      sinceMs?: number
      /** The one map looked at, when one was picked, see `getMapKey`. */
      mapKey?: string
      /**
       * In game types that don't split by map, the maps the user played this kind of game on,
       * named without their versions and tags, with their games, most played first.
       */
      maps: Array<{ key: string; name: string; games: number }>
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

/** A sample's number, if it was played fairly and long enough to have one. */
function valueOf(s: Sample, metric: CoachMetric): number | undefined {
  if (metric.minPlayedMs !== undefined && s.playedMs < metric.minPlayedMs) {
    return undefined
  }
  const value = metric.value(s)
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return undefined
  }
  // Each number only counts from the part of the game played with everyone still in.
  if (metric.unit === 'time') {
    return value <= s.evenUntilMs ? value : undefined
  }
  if (metric.minute !== undefined) {
    return metric.minute * 60_000 <= s.evenUntilMs ? value : undefined
  }
  const evenEnoughMs = metric.lateGame
    ? s.game.durationMs - 60_000
    : Math.min(s.game.durationMs, WHOLE_GAME_EVEN_MS) - 60_000
  return s.evenUntilMs >= evenEnoughMs ? value : undefined
}

function numbersOf(samples: ReadonlyArray<Sample>, metric: CoachMetric): number[] {
  return samples.flatMap(s => {
    const value = valueOf(s, metric)
    return value === undefined ? [] : [value]
  })
}

/** The smallest difference worth pointing out, next to a number this size. */
function minDiffFor(metric: CoachMetric, reference: number) {
  return Math.max(metric.minDiff, (metric.relativeDiff ?? 0) * Math.abs(reference))
}

function isTechKey(buildKey: string) {
  const [, kind, id] = /^([utg])(\d+)/.exec(buildKey) ?? []
  return kind === 't' || kind === 'g' || (kind === 'u' && TECH_BUILDING_IDS.has(Number(id)))
}

/** Buildings whose timing follows the plan rather than showing it: upgrade buildings, defense. */
function isPlanFollower(buildKey: string) {
  const [, id] = /^u(\d+)$/.exec(buildKey) ?? []
  return (
    id !== undefined && (UPGRADE_BUILDING_IDS.has(Number(id)) || STATIC_DEFENSE_IDS.has(Number(id)))
  )
}

function isBasicBuilding(buildKey: string) {
  const [, id] = /^u(\d+)$/.exec(buildKey) ?? []
  return id !== undefined && BASIC_BUILDING_IDS.has(Number(id))
}

/**
 * How a player opened, broadly: whether they expanded first, and what their opening was built
 * around. Protoss by how many Gateways came before the Cybernetics Core, or a Forge first; Zerg by
 * Hatchery first or how early the Spawning Pool came; Terran by what followed the first Barracks.
 * Other races, or an opening none of those fit, by the first tech they went for.
 */
function openingFamily(p: PlayerMetrics) {
  if (!p.opening.length) {
    // No build order to tell how they opened.
    return undefined
  }
  const secondBase = p.townHallTimesMs[0]
  const expanded = secondBase !== null && secondBase <= FAST_EXPAND_MS
  return `${expanded ? 'expand' : 'oneBase'}:${openingCore(p)}`
}

function openingCore(p: PlayerMetrics) {
  const { opening } = p
  if (p.race === 'p') {
    if (
      opening.indexOf(FORGE_KEY) !== -1 &&
      opening.indexOf(FORGE_KEY) < opening.indexOf(GATEWAY_KEY)
    ) {
      return 'forge'
    }
    const core = opening.indexOf(CYBERNETICS_CORE_KEY)
    const gates = (core === -1 ? opening : opening.slice(0, core)).filter(k => k === GATEWAY_KEY)
    if (gates.length) {
      return `gates${Math.min(gates.length, 3)}`
    }
  }
  if (p.race === 'z') {
    const pool = opening.indexOf(SPAWNING_POOL_KEY)
    const hatch = opening.indexOf(HATCHERY_KEY)
    if (hatch !== -1 && (pool === -1 || hatch < pool)) {
      return 'hatch'
    }
    const poolMs = p.firstStartsMs[SPAWNING_POOL_KEY]
    if (poolMs !== undefined) {
      return poolMs < EARLY_POOL_MS ? 'earlyPool' : 'pool'
    }
  }
  if (p.race === 't') {
    const rax = opening.indexOf(BARRACKS_KEY)
    const next = rax === -1 ? undefined : opening.slice(rax + 1).find(k => !isRefinery(k))
    if (next) {
      return `rax:${next}`
    }
  }
  const tech = Object.entries(p.firstStartsMs)
    .filter(([key, ms]) => ms <= OPENING_TECH_MS && key.startsWith('u') && isTechKey(key))
    .sort(([, a], [, b]) => a - b)[0]?.[0]
  return `tech:${tech ?? ''}`
}

/** Refineries, Assimilators and Extractors, which come wherever the gas is wanted. */
function isRefinery(buildKey: string) {
  return buildKey === 'u110' || buildKey === 'u149' || buildKey === 'u157'
}

function mostCommon<T>(values: ReadonlyArray<T>): T | undefined {
  const counts = new Map<T, number>()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return Array.from(counts).sort(([, a], [, b]) => b - a)[0]?.[0]
}

function nameOf(p: PlayerMetrics) {
  return p.names.join(' + ').toLowerCase()
}

/** Whether a player quit, rather than being defeated, before the game was worth comparing. */
function quitEarly(p: PlayerMetrics) {
  return !!p.quit && p.leftAtMs !== undefined && p.leftAtMs < MIN_PLAYED_MS
}

/**
 * Whether a game can be compared for this player: they didn't quit early, and in a team game,
 * nobody did, which would leave everyone else playing an uneven game.
 */
function isComparable(game: DatedGameMetrics, player: PlayerMetrics) {
  if (quitEarly(player)) {
    return false
  }
  return !(isTeamGame(game.shape) && game.players.some(p => p.human && quitEarly(p)))
}

function toSample(game: DatedGameMetrics, player: PlayerMetrics): Sample {
  const { teammates, opponents } = getSidesOf(game, player)
  const outTimes = game.players.flatMap(p =>
    p.human && p.leftAtMs !== undefined && p.leftAtMs < game.durationMs ? [p.leftAtMs] : [],
  )
  return {
    player,
    game,
    playedMs: Math.min(player.leftAtMs ?? game.durationMs, game.durationMs),
    evenUntilMs: isTeamGame(game.shape) && outTimes.length ? Math.min(...outTimes) : Infinity,
    teammates,
    opponent: game.shape === '1v1' ? opponents[0] : undefined,
  }
}

/** When a player went out, or the game's end for one who played it through. */
function outAt(s: Sample, p: PlayerMetrics) {
  return Math.min(p.leftAtMs ?? s.game.durationMs, s.game.durationMs)
}

/** In a team game, whether the player went out clearly before a teammate. */
function wentOutFirst(s: Sample) {
  return s.teammates.some(t => outAt(s, t) - outAt(s, s.player) > TOGETHER_MS)
}

/** In a team game, whether a teammate went out clearly before the player. */
function wasLeftAlone(s: Sample) {
  return s.teammates.some(t => outAt(s, s.player) - outAt(s, t) > TOGETHER_MS)
}

/** At most a few games of each player, so one met often doesn't become the benchmark. */
function capPerPlayer(samples: ReadonlyArray<Sample>): Sample[] {
  const counts = new Map<string, number>()
  return samples.filter(s => {
    const name = nameOf(s.player)
    const played = counts.get(name) ?? 0
    counts.set(name, played + 1)
    return played < MAX_GAMES_PER_PLAYER
  })
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
  user: ReadonlyArray<Sample>,
  pool: ReadonlyArray<Sample>,
  samePool: ReadonlyArray<Sample> | undefined,
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

function isBetter(metric: Pick<CoachMetric, 'higherIsBetter'>, value: number, than: number) {
  return metric.higherIsBetter ? value > than : value < than
}

/** Whether most of the user's games land on the same side of other players' typical game. */
function isConsistent(
  metric: CoachMetric,
  user: ReadonlyArray<Sample>,
  finding: CoachFinding,
  better: boolean,
) {
  const values = numbersOf(user, metric)
  const onSide = values.filter(v => isBetter(metric, v, finding.poolValue) === better).length
  return onSide / values.length >= CONSISTENT_SHARE
}

function getResultFindings(
  wins: ReadonlyArray<Sample>,
  losses: ReadonlyArray<Sample>,
  metrics: ReadonlyArray<CoachMetric>,
): CoachResultFinding[] {
  const findings: Array<CoachResultFinding & { size: number }> = []
  for (const metric of metrics) {
    const winValues = numbersOf(wins, metric)
    const lossValues = numbersOf(losses, metric)
    if (winValues.length < COACH_MIN_RESULT_GAMES || lossValues.length < COACH_MIN_RESULT_GAMES) {
      continue
    }
    const winValue = median(winValues)
    const lossValue = median(lossValues)
    const diff = Math.abs(winValue - lossValue)
    const minDiff = minDiffFor(metric, winValue)
    const all = [...winValues, ...lossValues]
    const middle = median(all)
    const spread = median(all.map(v => Math.abs(v - middle))) || minDiff
    const notable =
      isBetter(metric, winValue, lossValue) && diff >= minDiff && diff / spread >= MIN_RESULT_SIZE
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

/** When a player started something, if it was in the part of the game timings look at. */
function timeOf(p: PlayerMetrics, buildKey: string) {
  const ms = p.firstStartsMs[buildKey]
  return ms !== undefined && ms <= TIMING_WINDOW_MS ? ms : undefined
}

function timesOf(samples: ReadonlyArray<Sample>, buildKey: string) {
  return samples.flatMap(s => {
    const ms = timeOf(s.player, buildKey)
    return ms === undefined ? [] : [ms]
  })
}

function getTimings(
  user: ReadonlyArray<Sample>,
  pool: ReadonlyArray<Sample>,
  samePool: ReadonlyArray<Sample> | undefined,
): CoachTiming[] {
  const sameOpening = !!samePool && samePool.length >= MIN_SAME_OPENING_GAMES
  const comparePool = sameOpening ? samePool! : pool
  if (user.length < COACH_MIN_USER_GAMES || comparePool.length < minPoolGames(sameOpening)) {
    return []
  }
  const typical = (times: number[], games: number) =>
    times.length >= Math.max(3, games * MIN_TIMING_SHARE) ? median(times) : undefined
  const keys = new Set([...user, ...comparePool].flatMap(s => Object.keys(s.player.firstStartsMs)))
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
    let quietBecause: CoachTiming['quietBecause']
    if (userMs !== undefined && poolMs !== undefined) {
      if (!bothUsual) {
        quietBecause = 'oneSide'
      } else if (isPlanFollower(key)) {
        quietBecause = 'followsPlan'
      } else if (Math.abs(userMs - poolMs) < MIN_TIMING_DIFF_MS) {
        quietBecause = 'close'
      }
    }
    timings.push({
      buildKey: key,
      userMs,
      poolMs,
      userGames: userTimes.length,
      poolGames: poolTimes.length,
      sameOpening,
      notable: userMs !== undefined && poolMs !== undefined && !quietBecause,
      quietBecause,
    })
  }
  // In build order, by when it usually starts.
  return timings.sort(
    (a, b) => (a.poolMs ?? a.userMs ?? Infinity) - (b.poolMs ?? b.userMs ?? Infinity),
  )
}

/**
 * How much a timing difference matters: tech and upgrades over basic buildings, and things past
 * the opening over the buildings that only follow from it. The core in a Zealot opening comes when
 * the plan says, so it being late says less than a late +1.
 */
function timingWeight(timing: CoachTiming, opening: ReadonlyArray<string>) {
  if (
    !timing.notable ||
    opening.includes(timing.buildKey) ||
    isBasicBuilding(timing.buildKey) ||
    !isTechKey(timing.buildKey)
  ) {
    return 0
  }
  const diff = Math.abs(timing.userMs! - timing.poolMs!)
  const late = timing.buildKey.startsWith('u') && timing.poolMs! < OPENING_TECH_MS ? 0.5 : 1
  return diff * late
}

/** The timing most worth pointing out, if any. */
function getNotableTiming(timings: ReadonlyArray<CoachTiming>, opening: ReadonlyArray<string>) {
  return timings
    .map(timing => ({ timing, weight: timingWeight(timing, opening) }))
    .filter(({ weight }) => weight > 0)
    .sort((a, b) => b.weight - a.weight)[0]?.timing
}

interface UserGame extends CoachGame {
  sample: Sample
  /** Teammates' names, in team games. */
  teammates: string[]
}

interface PoolEntry {
  sample: Sample
  /** In 2v2, whether their teammate was of the same race as the user's. */
  sameAlly: boolean
  /** Whether it's from a game the user played in. */
  withUser: boolean
  /** Whether it's from the ladder baseline the app ships, rather than the user's replays. */
  baseline: boolean
}

interface BucketGames {
  mapFamily?: MapFamily
  /** The user's games of this kind that can be compared. */
  user: UserGame[]
  /** The user's games of this kind that someone quit too early to compare. */
  skipped: number
  /** How many of the user's games were on each map. */
  maps: Map<string, number>
  pool: PoolEntry[]
}

/** Every kind of game the user played enough of, as the coach would count them, most first. */
/** The fewest games against a pair of races for their builds to be shown apart. */
const MIN_BUILDS_AGAINST_GAMES = 10

/**
 * In 2v2, the builds played against each pair of opponents' races, and the pairs of builds teams
 * played. Each team is counted once, from whichever of its players comes first.
 */
function getPairBuilds(
  user: ReadonlyArray<BuildSample>,
  pool: ReadonlyArray<BuildSample>,
  games: ReadonlyMap<string, DatedGameMetrics>,
): Pick<CoachBucket, 'buildsAgainst' | 'teamBuilds'> {
  const sidesOf = (s: BuildSample) => {
    const game = games.get(s.gameId)
    return game ? getSidesOf(game, s.player) : undefined
  }
  const opponentsOf = (s: BuildSample) =>
    (sidesOf(s)?.opponents ?? [])
      .map(p => p.race ?? '')
      .sort()
      .join('')
  const groups = new Map<string, { user: BuildSample[]; pool: BuildSample[] }>()
  for (const [side, samples] of [
    ['user', user],
    ['pool', pool],
  ] as const) {
    for (const s of samples) {
      const opponents = opponentsOf(s)
      if (opponents.length !== 2) {
        continue
      }
      const group = groups.get(opponents) ?? { user: [], pool: [] }
      group[side].push(s)
      groups.set(opponents, group)
    }
  }
  const buildsAgainst = Array.from(groups)
    .filter(([, group]) => group.pool.length >= MIN_BUILDS_AGAINST_GAMES)
    .sort(([, a], [, b]) => b.pool.length + b.user.length - a.pool.length - a.user.length)
    .map(([opponents, group]) => ({
      opponents,
      games: group.pool.length,
      builds: summarizeBuilds(group.user, group.pool, getBuildFamily),
      userBuild: mostCommon(group.user.flatMap(s => getBuildFamily(s.player) ?? [])),
    }))

  const teams = new Map<string, TeamBuildSample>()
  for (const [isUser, samples] of [
    [true, user],
    [false, pool],
  ] as const) {
    for (const s of samples) {
      const id = `${s.gameId}:${s.player.team}`
      const teammate = sidesOf(s)?.teammates[0]
      const mine = getBuildFamily(s.player)
      const theirs = teammate && getBuildFamily(teammate)
      if (!teams.has(id) && mine && theirs) {
        teams.set(id, { families: [mine, theirs], result: s.result, user: isUser })
      }
    }
  }
  return { buildsAgainst, teamBuilds: summarizeTeamBuilds(Array.from(teams.values())) }
}

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
    const { teammates, opponents } = getSidesOf(game, me)
    const opponentRace = game.shape === '1v1' ? opponents[0]?.race : undefined
    if (game.shape === '1v1' && !opponentRace) {
      continue
    }
    const allyRace = game.shape === '2v2' ? teammates[0]?.race : undefined
    const mapFamily = splitsByMap(game.shape) ? game.mapFamily : undefined
    const key = `${game.shape}:${me.race}:${opponentRace ?? ''}:${allyRace ?? ''}:${mapFamily ?? ''}`
    const scope = scopes.get(key) ?? {
      shape: game.shape,
      race: me.race,
      opponentRace,
      allyRace,
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

/** The teammates the user played at least a few games with. */
function getRegularPartners(games: ReadonlyArray<Pick<UserGame, 'teammates'>>) {
  const counts = new Map<string, number>()
  for (const name of games.flatMap(g => g.teammates)) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return new Set(
    Array.from(counts).flatMap(([name, count]) => (count >= REGULAR_PARTNER_GAMES ? [name] : [])),
  )
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
        recent.map(g => g.sample),
        metric,
      )
      const earlierValues = numbersOf(
        earlier.map(g => g.sample),
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
      const minDiff = minDiffFor(metric, earlierValue)
      let direction: CoachChange['direction'] = 'same'
      if (diff >= minDiff) {
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
        size: diff / minDiff,
      })
    }
  }
  const regulars = getRegularPartners(earlier)
  const withRegular = (g: UserGame) => g.teammates.some(name => regulars.has(name))
  const hadRegulars = earlier.filter(withRegular).length * 2 >= earlier.length
  const earlierResults = countResults(earlier)
  return {
    games: recent.map(({ sample: _, teammates: __, ...game }) => game),
    ...countResults(recent),
    earlierGames: earlier.length,
    earlierWins: earlierResults.wins,
    earlierLosses: earlierResults.losses,
    newPartnerGames: earlier.length && hadRegulars ? recent.filter(g => !withRegular(g)).length : 0,
    changes,
  }
}

/**
 * Numbers that come from the same thing, like workers at 6 and at 8 minutes, or EAPM and hotkey
 * use. Fixing one usually fixes the rest, so only one of each is made a goal.
 */
export function getMetricFamily(key: CoachMetricKey | 'buildTiming') {
  if (key.endsWith('Base')) {
    return 'base'
  }
  if (key === 'workerLead8') {
    return 'workers'
  }
  if (key === 'baseLead10') {
    return 'base'
  }
  if (/^(eapm|apm|hotkeys)/.test(key)) {
    return 'speed'
  }
  return key.replace(/(\d+|Early|Mid|Late)$/, '')
}

/**
 * A target to reach, rounded the way that still reaches it: up for numbers where more is better,
 * down where less is. Whole numbers for counts, tenths for small rates, and as precise as the page
 * shows the rest. Never -0, which would show as "-0".
 */
export function roundTarget(value: number, unit: CoachUnit, higherIsBetter: boolean) {
  const round = (n: number) => (higherIsBetter ? Math.ceil(n) : Math.floor(n)) + 0
  switch (unit) {
    case 'count':
      return round(value)
    case 'perMinute':
      return Math.abs(value) < 10 ? round(value * 10) / 10 : round(value)
    case 'perTenMinutes':
      return round(value * 10) / 10
    case 'time':
      return round(value / 1000) * 1000
    case 'percent':
      return round(value * 100) / 100
    case 'share':
      // Shown as whole seconds per 10 minutes.
      return round(value * 600) / 600
    case 'ratio':
      return round(value * 100) / 100
    default:
      return value
  }
}

/**
 * A number as precise as the page shows it, so a last game shown as reaching the target did:
 * whole numbers from 10 up, tenths below, and whole seconds for times.
 */
function roundShown(value: number, unit: CoachUnit) {
  switch (unit) {
    case 'count':
    case 'perMinute':
      return Math.abs(value) < 10 ? Math.round(value * 10) / 10 : Math.round(value)
    case 'perTenMinutes':
      return Math.round(value * 10) / 10
    case 'time':
      return Math.round(value / 1000) * 1000
    case 'percent':
      return Math.round(value * 100) / 100
    case 'share':
      return Math.round(value * 600) / 600
    case 'ratio':
      return Math.round(value * 100) / 100
    default:
      return value
  }
}

interface GoalCandidate {
  key: CoachMetricKey | 'buildTiming'
  buildKey?: string
  unit: CoachUnit
  higherIsBetter: boolean
  basis: CoachGoalBasis
  target: number
  beats?: number
  /** The basics first, then timings, then speed, which is the least a player can act on in one game. */
  tier: number
  userValues: number[]
  /** Where the user is now, when it isn't their typical game, like their typical loss. */
  userValue?: number
  recentValues: number[]
  /** The values in the user's latest {@link GOAL_CHECK_GAMES} games that have it, oldest first. */
  checkValues: number[]
  /** The games {@link checkValues} come from, in the same order. */
  checkGames: UserGame[]
  /** The minute the number is read at, if it has one. */
  minute?: number
}

const BASIS_ORDER: Record<CoachGoalBasis, number> = { others: 0, wins: 1, earlier: 2 }

/**
 * What to aim for in the next game, one of each family. The basics come before build timings, and
 * speed comes last. Within those, gaps against other players come first, the ones that also show
 * up in the user's losses before the rest; then what changes in their losses (aiming for their
 * typical win); then what slipped in their latest games (aiming for where they were before).
 */
function getGoals({
  context,
  gaps,
  inLosses,
  changes,
  timings,
  opening,
  user,
  strengths,
}: {
  context: CoachContext
  gaps: ReadonlyArray<CoachFinding & { metric: CoachMetric }>
  /** Where the user is ahead of other players, which no goal should contradict. */
  strengths: ReadonlyArray<CoachFinding>
  inLosses: ReadonlyArray<CoachResultFinding>
  changes: ReadonlyArray<CoachChange>
  timings: ReadonlyArray<CoachTiming>
  opening: ReadonlyArray<string>
  user: ReadonlyArray<UserGame>
}): CoachGoal[] {
  const samples = user.map(g => g.sample)
  const recent = samples.slice(-RECENT_FORM_GAMES)
  const lookback = user.slice(-GOAL_CHECK_LOOKBACK)
  /** The latest few values a number has, and their games, skipping games that don't have it. */
  const latest = (valueAt: (s: Sample) => number | undefined) => {
    const found = lookback
      .flatMap(game => {
        const value = valueAt(game.sample)
        return value === undefined ? [] : [{ game, value }]
      })
      .slice(-GOAL_CHECK_GAMES)
    return { checkValues: found.map(f => f.value), checkGames: found.map(f => f.game) }
  }
  const costly = new Set(inLosses.filter(f => f.notable).map(f => f.key))
  const metricOf = (key: CoachMetricKey) => METRICS.find(m => m.key === key)!

  const fromMetric = (
    metric: CoachMetric,
    basis: CoachGoalBasis,
    target: number,
    beats?: number,
  ): GoalCandidate => {
    return {
      key: metric.key,
      unit: metric.unit,
      higherIsBetter: metric.higherIsBetter,
      basis,
      target,
      beats,
      tier: metric.speed ? 2 : 0,
      userValues: numbersOf(samples, metric),
      recentValues: numbersOf(recent, metric),
      ...latest(s => valueOf(s, metric)),
      minute: metric.minute,
    }
  }

  const candidates: GoalCandidate[] = [
    ...gaps
      .toSorted(
        (a, b) => Number(costly.has(b.key)) - Number(costly.has(a.key)) || a.beats - b.beats,
      )
      .map(gap => fromMetric(gap.metric, 'others', gap.poolValue, gap.beats)),
    ...timings
      .filter(t => t.userMs! > t.poolMs! && timingWeight(t, opening) > 0)
      .sort((a, b) => timingWeight(b, opening) - timingWeight(a, opening))
      .map((t): GoalCandidate => ({
        key: 'buildTiming',
        buildKey: t.buildKey,
        unit: 'time',
        higherIsBetter: false,
        basis: 'others',
        target: t.poolMs!,
        tier: 1,
        userValues: timesOf(samples, t.buildKey),
        recentValues: timesOf(recent, t.buildKey),
        ...latest(s => timeOf(s.player, t.buildKey)),
      })),
    ...inLosses
      .filter(f => f.notable)
      // In a team game, less of these in losses mostly comes from losing a fight or being the
      // one attacked, which a goal to make more wouldn't fix.
      .filter(f => !context.teamGame || !isFightDriven(f.key))
      // How fast someone plays changes slowly, so it's no target for one game.
      .filter(f => !metricOf(f.key).speed)
      .map(f => ({ ...fromMetric(metricOf(f.key), 'wins', f.winValue), userValue: f.lossValue })),
    ...changes
      .filter(c => c.direction === 'worse')
      .toSorted((a, b) => b.size - a.size)
      // Where the user is now is their latest games, which are what slipped.
      .map(c => ({
        ...fromMetric(metricOf(c.key), 'earlier', c.earlierValue),
        userValue: c.recentValue,
      })),
  ]

  // Nothing the user is already good at becomes a goal, so a goal never argues with a strength.
  const families = new Set<string>(strengths.map(f => getMetricFamily(f.key)))
  const goals: CoachGoal[] = []
  const ranked = candidates
    .map((candidate, order) => ({ candidate, order }))
    .sort(
      (a, b) =>
        a.candidate.tier - b.candidate.tier ||
        BASIS_ORDER[a.candidate.basis] - BASIS_ORDER[b.candidate.basis] ||
        a.order - b.order,
    )
  for (const { candidate } of ranked) {
    const family = candidate.key === 'buildTiming' ? 'buildTiming' : getMetricFamily(candidate.key)
    const target = roundTarget(candidate.target, candidate.unit, candidate.higherIsBetter)
    // Nothing at all, like no workers ever lost, isn't a target anyone can plan a game around.
    const nothing = !candidate.higherIsBetter && candidate.unit !== 'time' && target <= 0
    const current =
      candidate.userValue ??
      (candidate.userValues.length ? median(candidate.userValues) : undefined)
    // Already there, which can happen once the target is rounded, isn't a goal.
    const reached =
      current === undefined || current === target || isBetter(candidate, current, target)
    if (goals.length >= MAX_GOALS || families.has(family) || nothing || reached) {
      continue
    }
    families.add(family)
    goals.push({
      key: candidate.key,
      buildKey: candidate.buildKey,
      unit: candidate.unit,
      higherIsBetter: candidate.higherIsBetter,
      basis: candidate.basis,
      target,
      userValue: current,
      recentValue:
        candidate.recentValues.length >= COACH_MIN_RESULT_GAMES
          ? median(candidate.recentValues)
          : undefined,
      beats: candidate.beats,
      inLosses: candidate.key !== 'buildTiming' && costly.has(candidate.key),
      checks: candidate.checkValues.map(
        value => roundShown(value, candidate.unit) === target || isBetter(candidate, value, target),
      ),
      review: getReview(candidate, target),
    })
  }
  return goals
}

/**
 * The moment to watch for a goal: in the latest games that missed it, the one that missed by the
 * most, and when in it. Numbers with moments of their own, like a supply block, point to that;
 * numbers read at a minute point to that minute, and a build to when it should have started.
 */
function getReview(candidate: GoalCandidate, target: number): CoachReview | undefined {
  const missed = candidate.checkValues
    .map((value, i) => ({ value, game: candidate.checkGames[i] }))
    .filter(
      ({ value }) =>
        !(roundShown(value, candidate.unit) === target || isBetter(candidate, value, target)),
    )
  const worst = missed.sort((a, b) =>
    candidate.higherIsBetter ? a.value - b.value : b.value - a.value,
  )[0]
  if (!worst) {
    return undefined
  }
  const { sample, teammates: _, ...game } = worst.game
  const moments = sample.player.moments
  const family = candidate.key === 'buildTiming' ? 'buildTiming' : getMetricFamily(candidate.key)
  if (candidate.unit === 'time') {
    return { game, atMs: target, amount: worst.value, kind: 'timing' }
  }
  switch (family) {
    case 'supplyBlocked':
      return moments?.supplyBlock
        ? {
            game,
            atMs: moments.supplyBlock.startMs,
            endMs: moments.supplyBlock.endMs,
            kind: 'supplyBlock',
          }
        : undefined
    case 'bank':
      return moments?.bankPeak
        ? { game, atMs: moments.bankPeak.atMs, amount: moments.bankPeak.amount, kind: 'bankPeak' }
        : undefined
    case 'workersLost':
      return moments?.workerLoss
        ? {
            game,
            atMs: moments.workerLoss.startMs,
            endMs: moments.workerLoss.endMs,
            amount: moments.workerLoss.count,
            kind: 'workerLoss',
          }
        : undefined
    default:
      return candidate.minute !== undefined
        ? { game, atMs: candidate.minute * 60_000, amount: worst.value, kind: 'minute' }
        : undefined
  }
}

/**
 * Numbers a team game's fights decide as much as the player does: workers, mining, army and early
 * production. In a loss they're lower mostly because the player was attacked or lost a fight.
 */
function isFightDriven(key: CoachMetricKey) {
  const family = getMetricFamily(key)
  if (family === 'workers' || family === 'income' || family === 'army') {
    return true
  }
  const minute = /^production(\d+)$/.exec(key)?.[1]
  return minute !== undefined && Number(minute) < 10
}

/** How often the user went out first in their team's losses, against other players. */
function getFirstOut(
  user: ReadonlyArray<UserGame>,
  pool: ReadonlyArray<Sample>,
): CoachFirstOut | undefined {
  const userLosses = user.filter(g => g.result === 'loss').map(g => g.sample)
  const poolLosses = pool.filter(s => s.player.result === 'loss')
  if (userLosses.length < COACH_MIN_RESULT_GAMES || poolLosses.length < COACH_MIN_POOL_GAMES) {
    return undefined
  }
  return {
    losses: userLosses.length,
    firstOut: userLosses.filter(wentOutFirst).length,
    poolShare: poolLosses.filter(wentOutFirst).length / poolLosses.length,
  }
}

/** The few things a coach would say first about these games, most important first. */
function getNotes(
  bucket: Pick<CoachBucket, 'recentForm' | 'inLosses' | 'strengths' | 'timings' | 'firstOut'>,
  opening: ReadonlyArray<string>,
): CoachNote[] {
  const notes: CoachNote[] = []
  const form = bucket.recentForm
  if (form.earlierGames >= MIN_EARLIER_GAMES && form.wins + form.losses > 0) {
    notes.push({ kind: 'form', form })
  }
  const isSpeed = (key: CoachMetricKey) => getMetricFamily(key) === 'speed'
  const inLosses = bucket.inLosses.find(f => f.notable && !isSpeed(f.key))
  if (inLosses) {
    notes.push({ kind: 'inLosses', finding: inLosses })
  }
  const { firstOut } = bucket
  if (firstOut && firstOut.firstOut / firstOut.losses >= firstOut.poolShare + FIRST_OUT_MARGIN) {
    notes.push({ kind: 'firstOut', firstOut })
  }
  const biggest = (direction: CoachChange['direction']) =>
    form.changes
      .filter(c => c.direction === direction && !isSpeed(c.key))
      .sort((a, b) => b.size - a.size)[0]
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
  const timing = getNotableTiming(bucket.timings, opening)
  if (timing) {
    notes.push({ kind: 'timing', timing })
  }
  return notes
}

/** The MMRs most players of each 1v1 ladder rank had, see {@link getRankMmr}. */
export type RankMmr = Partial<Record<LadderRank, { low: number; high: number }>>

/** How many players of a rank it takes to say what MMRs it covers. */
const MIN_RANK_MMR_PLAYERS = 10
/** The share of a rank's players left out at each end, so a few outliers don't stretch it. */
const RANK_MMR_TAIL = 0.1

/**
 * The MMRs each 1v1 ladder rank covers, from the players who had it going into a game: the middle
 * of them, rounded to tens, since where ranks start moves with each season.
 */
export function getRankMmr(games: ReadonlyArray<DatedGameMetrics>): RankMmr {
  const byRank = new Map<LadderRank, number[]>()
  for (const game of games) {
    if (game.shape !== '1v1') {
      continue
    }
    for (const p of game.players) {
      if (p.rank && p.mmr !== undefined) {
        byRank.set(p.rank, [...(byRank.get(p.rank) ?? []), p.mmr])
      }
    }
  }
  const result: RankMmr = {}
  for (const rank of LADDER_RANKS) {
    const mmrs = byRank.get(rank)?.sort((a, b) => a - b)
    if (!mmrs || mmrs.length < MIN_RANK_MMR_PLAYERS) {
      continue
    }
    const at = (share: number) => Math.round(mmrs[Math.floor(share * (mmrs.length - 1))] / 10) * 10
    result[rank] = { low: at(RANK_MMR_TAIL), high: at(1 - RANK_MMR_TAIL) }
  }
  return result
}

/**
 * The ladder ranks of a 1v1 comparison: `auto`, the rank of the user's latest ranked game of the
 * kind looked at, and `rank`, the one other players are compared at. That's the one picked, or
 * `auto` unless `any` was.
 */
export function pickRank(
  games: ReadonlyArray<DatedGameMetrics>,
  names: ReadonlyArray<string>,
  picked: LadderRank | 'any' | undefined,
  isOfKind: (game: DatedGameMetrics, me: PlayerMetrics) => boolean,
): { auto: LadderRank | undefined; rank: LadderRank | undefined } {
  let latest: { rank: LadderRank; timeMs: number } | undefined
  for (const game of games) {
    const me = findMe(game, names)
    if (me?.rank && isOfKind(game, me) && (!latest || game.gameTimeMs > latest.timeMs)) {
      latest = { rank: me.rank, timeMs: game.gameTimeMs }
    }
  }
  const auto = latest?.rank
  return { auto, rank: picked === 'any' ? undefined : (picked ?? auto) }
}

/**
 * Compares the user's games of one kind with other players of the same race in the same kind of
 * game, from every analyzed replay, to find what they do worse and better than most, how they've
 * played lately, and what to work on next. Other players need at least `eapmFloor` EAPM. Without a
 * kind of game picked, it looks at the one the user played most.
 */
export function computeCoach(
  everyGame: ReadonlyArray<DatedGameMetrics>,
  query: CoachQuery,
): CoachResult {
  const { fromMs } = query
  const allGames =
    fromMs === undefined ? everyGame : everyGame.filter(game => game.gameTimeMs >= fromMs)
  const scopes = getScopes(allGames, query.names)
  const picked =
    query.shape && query.race && (query.shape !== '1v1' || query.opponentRace) ? query : scopes[0]
  if (!picked?.shape || !picked.race) {
    return { status: 'noGames', scopes, eapmFloor: query.eapmFloor ?? DEFAULT_EAPM_FLOOR }
  }
  const shape = picked.shape
  const race = picked.race
  const opponentRace = shape === '1v1' ? picked.opponentRace : undefined
  const allyRace = shape === '2v2' ? picked.allyRace : undefined
  const teamGame = isTeamGame(shape)
  const splitByMap = splitsByMap(shape)
  const mapFamily = splitByMap ? picked.mapFamily : undefined

  const mapKey = splitByMap ? undefined : query.mapKey

  const isOfKindOnAnyMap = (game: DatedGameMetrics, player: PlayerMetrics) =>
    game.shape === shape &&
    (!mapFamily || game.mapFamily === mapFamily) &&
    player.race === race &&
    player.human &&
    (shape !== '1v1' || getSidesOf(game, player).opponents[0]?.race === opponentRace)
  const isOfKind = (game: DatedGameMetrics, player: PlayerMetrics) =>
    isOfKindOnAnyMap(game, player) && (!mapKey || getMapKey(game.mapName) === mapKey)
  const hasAlly = (game: DatedGameMetrics, player: PlayerMetrics) =>
    !allyRace || getSidesOf(game, player).teammates[0]?.race === allyRace

  // Every version of a map counts toward it, and the one played most names it.
  const mapGames = new Map<string, Map<string, number>>()
  if (!splitByMap) {
    for (const game of allGames) {
      const me = findMe(game, query.names)
      if (me && isOfKindOnAnyMap(game, me) && hasAlly(game, me) && isComparable(game, me)) {
        const key = getMapKey(game.mapName)
        const names = mapGames.get(key) ?? new Map<string, number>()
        names.set(game.mapName, (names.get(game.mapName) ?? 0) + 1)
        mapGames.set(key, names)
      }
    }
  }
  const maps = Array.from(mapGames, ([key, names]) => {
    const versions = Array.from(names).sort(([, a], [, b]) => b - a)
    return {
      key,
      name: getMapDisplayName(versions[0][0]),
      games: versions.reduce((sum, [, n]) => sum + n, 0),
    }
  }).sort((a, b) => b.games - a.games)

  const myTimes = allGames
    .flatMap(game => {
      const me = findMe(game, query.names)
      return me && isOfKind(game, me) && hasAlly(game, me) && isComparable(game, me)
        ? [game.gameTimeMs]
        : []
    })
    .sort((a, b) => a - b)
  const window = query.window ?? 'auto'
  // Counted back from the latest game rather than today, so a break from playing doesn't empty it.
  const monthsGames = myTimes.filter(time => time >= (myTimes.at(-1) ?? 0) - AUTO_WINDOW_MS).length
  const autoGames = Math.max(AUTO_WINDOW_MIN_GAMES, monthsGames)
  let windowGames: number | undefined
  if (window === 'auto') {
    windowGames = autoGames
  } else if (window !== 'all') {
    windowGames = window
  }
  const sinceMs =
    windowGames !== undefined && myTimes.length > windowGames
      ? myTimes[myTimes.length - windowGames]
      : undefined
  const games =
    sinceMs === undefined ? allGames : allGames.filter(game => game.gameTimeMs >= sinceMs)

  const myEapms = games.flatMap(game => {
    const me = findMe(game, query.names)
    return me?.eapm !== undefined && isOfKind(game, me) && hasAlly(game, me) ? [me.eapm] : []
  })
  const autoFloor = myEapms.length
    ? EAPM_FLOORS.filter(floor => floor <= median(myEapms) * AUTO_FLOOR_SHARE).at(-1)
    : undefined
  const eapmFloor = query.eapmFloor ?? autoFloor ?? DEFAULT_EAPM_FLOOR
  const { auto: autoRank, rank } =
    shape === '1v1'
      ? pickRank(games, query.names, query.rank, isOfKind)
      : { auto: undefined, rank: undefined }

  // The user's regular partners make poor benchmarks: their games go with the user's, win or
  // lose. Someone a lobby put them with once is as good a benchmark as anyone.
  const partners = getRegularPartners(
    allGames.flatMap(game => {
      const me = game.shape === shape ? findMe(game, query.names) : undefined
      return me ? [{ teammates: getSidesOf(game, me).teammates.map(nameOf) }] : []
    }),
  )

  const buckets = new Map<string, BucketGames>()
  const bucketFor = (game: DatedGameMetrics) => {
    const family = splitByMap ? game.mapFamily : 'any'
    const bucket = buckets.get(family) ?? {
      mapFamily: splitByMap ? game.mapFamily : undefined,
      user: [],
      skipped: 0,
      maps: new Map<string, number>(),
      pool: [],
    }
    buckets.set(family, bucket)
    return bucket
  }
  for (const game of games) {
    const me = findMe(game, query.names)
    if (me && isOfKind(game, me) && hasAlly(game, me)) {
      const bucket = bucketFor(game)
      bucket.maps.set(game.mapName, (bucket.maps.get(game.mapName) ?? 0) + 1)
      if (isComparable(game, me)) {
        const sample = toSample(game, me)
        bucket.user.push({
          sample,
          gameId: game.gameId,
          gameTimeMs: game.gameTimeMs,
          mapName: game.mapName,
          result: getMyResult(game, me, query.names),
          teammates: sample.teammates.map(nameOf),
        })
      } else {
        bucket.skipped += 1
      }
    }
    for (const p of game.players) {
      if (
        p === me ||
        !isOfKind(game, p) ||
        !isComparable(game, p) ||
        (teamGame && partners.has(nameOf(p)))
      ) {
        continue
      }
      bucketFor(game).pool.push({
        sample: toSample(game, p),
        sameAlly: hasAlly(game, p),
        withUser: !!me,
        baseline: game.ladderBaseline === true,
      })
    }
  }

  const context: CoachContext = {
    shape,
    race,
    opponentRace,
    teamGame,
    mapFamily,
    moneyMap: false,
  }

  const results: CoachBucket[] = []
  for (const bucket of buckets.values()) {
    if (!bucket.user.length && !bucket.skipped) {
      // Other players' games on a kind of map the user never played here.
      continue
    }
    const bucketContext: CoachContext = {
      ...context,
      mapFamily: bucket.mapFamily,
      moneyMap: bucket.mapFamily === 'bgh' || bucket.mapFamily === 'fastest',
    }
    // Every number that means something here is shown; only some can be pointed out.
    const shownMetrics = METRICS.filter(m => !m.shownIn || m.shownIn(bucketContext))
    const metrics = shownMetrics.filter(
      m => !m.listedOnly && (!m.pointsOut || m.pointsOut(bucketContext)),
    )
    const earlyMinute = bucketContext.mapFamily === 'bgh' ? BGH_EARLY_MINUTE : EARLY_MINUTE

    const userGames = bucket.user.toSorted((a, b) => a.gameTimeMs - b.gameTimeMs)
    const user = userGames.map(g => g.sample)
    const sameAlly = bucket.pool.filter(e => e.sameAlly)
    const anyAlly = !!allyRace && sameAlly.length < COACH_MIN_POOL_GAMES
    const entries = (allyRace && !anyAlly ? sameAlly : bucket.pool).filter(
      e => !rank || e.sample.player.rank === rank,
    )
    const allPool = capPerPlayer(entries.map(e => e.sample))
    const floored = entries.filter(e => (e.sample.player.eapm ?? 0) >= eapmFloor)
    const pool = capPerPlayer(floored.map(e => e.sample))
    const poolFromUser = new Set(pool)
    const poolFromUserGames = floored.filter(e => e.withUser && poolFromUser.has(e.sample)).length
    const poolFromBaseline = floored.filter(e => e.baseline && poolFromUser.has(e.sample)).length

    const opening = mostCommon(user.map(s => s.player.opening.join(',')).filter(Boolean))
    const family = mostCommon(user.flatMap(s => openingFamily(s.player) ?? []))
    const sameOpening = (samples: ReadonlyArray<Sample>) =>
      family ? samples.filter(s => openingFamily(s.player) === family) : undefined
    const samePool = sameOpening(pool)
    const sameAllPool = sameOpening(allPool)
    const openingKeys = opening ? opening.split(',') : []

    const gaps: Array<CoachFinding & { metric: CoachMetric }> = []
    const strengths: Array<CoachFinding & { metric: CoachMetric }> = []
    const compared: CoachFinding[] = []
    for (const metric of shownMetrics) {
      const finding = metric.speed
        ? compare(metric, user, allPool, sameAllPool)
        : compare(metric, user, pool, samePool)
      if (finding) {
        compared.push(finding)
      }
      if (
        !finding ||
        !metrics.includes(metric) ||
        Math.abs(finding.userValue - finding.poolValue) < minDiffFor(metric, finding.poolValue)
      ) {
        continue
      }
      if (
        (finding.beats < GAP_SCORE && isConsistent(metric, user, finding, false)) ||
        (metric.gapWhen?.(finding.userValue, finding.poolValue) &&
          isBetter(metric, finding.poolValue, finding.userValue))
      ) {
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
    // Problems whatever other players do come first, then the furthest behind them.
    const urgent = (gap: CoachFinding & { metric: CoachMetric }) =>
      gap.metric.gapWhen?.(gap.userValue, gap.poolValue) ? 0 : 1
    const topGaps = gaps
      .sort((a, b) => urgent(a) - urgent(b) || a.beats - b.beats)
      .slice(0, MAX_GAPS)
    const closestGap = gaps.length
      ? undefined
      : compared
          .filter(f => f.beats < 0.5 && metrics.some(m => m.key === f.key && !m.speed))
          .sort((a, b) => a.beats - b.beats)[0]
    const topStrengths = strengths
      .sort((a, b) => b.beats - a.beats)
      .slice(0, MAX_STRENGTHS)
      .map(strip)
    // In team games, a loss where a teammate fell first says little about how the user played.
    const lossesToCompare = userGames.filter(
      g => g.result === 'loss' && !(teamGame && wasLeftAlone(g.sample)),
    )
    const inLosses = getResultFindings(
      userGames.filter(g => g.result === 'win').map(g => g.sample),
      lossesToCompare.map(g => g.sample),
      metrics.filter(m => m.minute !== undefined && m.minute <= earlyMinute),
    )
    const timings = getTimings(user, pool, samePool)
    const fromUserGames = new Set(floored.flatMap(e => (e.withUser ? [e.sample] : [])))
    const toBuildSample = (sample: Sample, result: GameStatsResult, withUser: boolean) => ({
      player: sample.player,
      name: nameOf(sample.player),
      side: teamGame ? String(sample.player.team) : nameOf(sample.player),
      result,
      gameId: sample.game.gameId,
      withUser,
      carried: teamGame && wentOutFirst(sample),
      playedMs: sample.playedMs,
    })
    const userBuildSamples = userGames.map(g => toBuildSample(g.sample, g.result, true))
    const poolBuildSamples = pool.map(sample =>
      toBuildSample(sample, sample.player.result, fromUserGames.has(sample)),
    )
    const builds = summarizeBuilds(userBuildSamples, poolBuildSamples, getBuildFamily)
    const userBuild = mostCommon(user.flatMap(s => getBuildFamily(s.player) ?? []))
    const pairBuilds =
      shape === '2v2'
        ? getPairBuilds(
            userBuildSamples,
            poolBuildSamples,
            new Map([...user, ...pool].map(sample => [sample.game.gameId, sample.game])),
          )
        : {}
    // What changed lately is pointed out as a note or a goal, so only numbers that can be count.
    const recentForm = getRecentForm(userGames, metrics)
    const firstOut = teamGame ? getFirstOut(userGames, pool) : undefined
    const withoutNotes = {
      shape,
      race,
      opponentRace,
      allyRace,
      anyAlly,
      rank,
      mapFamily: bucket.mapFamily,
      onMap: mapKey ? maps.find(m => m.key === mapKey)?.name : undefined,
      userGames: user.length,
      skippedGames: bucket.skipped,
      mapNames: Array.from(bucket.maps)
        .sort(([, a], [, b]) => b - a)
        .map(([name]) => name),
      ...countResults(userGames),
      lossesCompared: lossesToCompare.length,
      poolGames: pool.length,
      poolPlayers: new Set(pool.map(sample => nameOf(sample.player))).size,
      poolFromUserGames,
      poolFromBaseline,
      opening: openingKeys,
      gaps: topGaps.map(strip),
      closestGap,
      strengths: topStrengths,
      inLosses,
      timings,
      builds,
      userBuild,
      ...pairBuilds,
      compared,
      recentForm,
      firstOut,
      goals:
        user.length >= COACH_MIN_USER_GAMES
          ? getGoals({
              context: bucketContext,
              gaps: topGaps,
              inLosses,
              changes: recentForm.changes,
              timings,
              opening: openingKeys,
              user: userGames,
              strengths: topStrengths,
            })
          : [],
    }
    results.push({ ...withoutNotes, notes: getNotes(withoutNotes, openingKeys) })
  }

  return {
    status: 'ready',
    scopes,
    eapmFloor,
    rank,
    autoRank,
    rankMmr: shape === '1v1' ? getRankMmr(allGames) : undefined,
    scope: { shape, race, opponentRace, allyRace, mapFamily },
    window,
    autoGames,
    autoMonths: monthsGames >= AUTO_WINDOW_MIN_GAMES,
    sinceMs,
    mapKey,
    maps,
    buckets: results.sort((a, b) => b.userGames - a.userGames),
  }
}
