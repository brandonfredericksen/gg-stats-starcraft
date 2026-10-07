import { AssignedRaceChar } from '../races'
import type { PlayerCommandStats, ReplayCommandStats } from './command-stats'
import { BuildStep, GamePlayerStats, GameStats, GameStatsResult } from './game-stats'
import { getMapFamily, MapFamily } from './map-family'

/**
 * The version of {@link GameMetrics} computed now. Metrics computed by an older version are worked
 * out again from the saved stats, which are never touched.
 */
export const GAME_METRICS_VERSION = 8

/** The minutes into a game that players' progress is compared at. */
export const CHECKPOINT_MINUTES: ReadonlyArray<number> = [4, 5, 6, 7, 8, 10, 12, 15]

/** The minutes into a game a player's army is counted at, to see how it came together early. */
export const ARMY_MIX_MINUTES: ReadonlyArray<number> = [5, 7, 10]

/** Supply in use that marks how quickly a player grows, in whole units. */
export const SUPPLY_MILESTONES: ReadonlyArray<number> = [100, 150, 200]

/**
 * The parts of a game that play differently, in minutes: the early game up to 6, the mid game up
 * to 12, then the late game.
 */
export const PHASE_MINUTES: ReadonlyArray<readonly [start: number, end: number]> = [
  [0, 6],
  [6, 12],
  [12, Infinity],
]

/** How a game's players were split up. */
export type GameShape = '1v1' | '2v2' | '3v3' | '4v4' | 'ffa' | 'other'

/**
 * Supply blocks this early are usually part of a build, like a 9 pool, rather than a mistake, so
 * they're left out of the share of time blocked.
 */
const SUPPLY_BLOCK_GRACE_MS = 3 * 60_000
/** Players who stopped before this haven't played enough for a share of time blocked to mean anything. */
const MIN_SUPPLY_BLOCK_PLAYED_MS = 5 * 60_000
/** How many samples, about 10 seconds apart, a phase needs for an average bank. */
const MIN_PHASE_SAMPLES = 3
/** How long a player has to have played in a phase for rates in it to mean anything. */
const MIN_PHASE_MINUTES = 1
/** How many buildings make up an opening. */
const OPENING_LENGTH = 4
/**
 * Supply in use from which money on hand is left out of the bank. A player who's maxed out, or
 * nearly, has nothing left to spend it on but more production, and often rightly saves it.
 */
const MAXED_SUPPLY = 190
/**
 * A player who left with at least this share of their most workers was still standing, so they
 * quit rather than being defeated. Defeat in a melee game means every building destroyed, which
 * takes the workers with it.
 */
const STANDING_WORKER_SHARE = 0.3
/** Fewer workers than this is nothing to keep playing on, whatever the share. */
const MIN_STANDING_WORKERS = 4

const WORKER_IDS: ReadonlySet<number> = new Set([7, 41, 64])
/** How long an SCV or a Probe takes to make, at the speed games are timed at. */
const WORKER_BUILD_MS = 300 * 42
/** How long a Command Center or Nexus takes to build before it can make workers. */
const TOWN_HALL_BUILD_MS = 1800 * 42
/** Command Centers and Nexuses, whose time making workers says how steadily a player made them. */
const WORKER_TOWN_HALL_IDS: ReadonlySet<number> = new Set([106, 154])
/** The part of the game worker production is measured over. */
const WORKER_PRODUCTION_MS = 8 * 60_000
/** Worker losses are looked for within this long, so a run of them counts as one. */
const WORKER_LOSS_WINDOW_MS = 30_000
/** Fewer workers lost at once than this is ordinary attrition, not a moment to watch. */
const MIN_WORKER_LOSS = 3
/** How long before a player went out their losses are left out of the moments to watch. */
const FINAL_MINUTE_MS = 60_000
/** How far into a game a build order is kept: the part a build decides. */
const BUILD_MS = 10 * 60_000
/** The most build steps kept for a game. */
const MAX_BUILD_STEPS = 20
/** Workers a player starts with. */
const STARTING_WORKERS = 4
/** A pause in making workers this long, after the first few minutes, is when a player stopped. */
const WORKER_STOP_GAP_MS = 60_000
/** Before this, a pause in making workers is part of a build, like a 9 pool. */
const WORKER_STOP_FROM_MS = 3 * 60_000
/** A player still making workers this far in never stopped early. */
const WORKER_STOP_UNTIL_MS = 12 * 60_000
/** How far into a game Zerg larvae are judged: the part where every larva counts most. */
const LARVA_MS = 10 * 60_000
/**
 * What can see cloaked and burrowed units, by race: Photon Cannons and Observers for Protoss,
 * Missile Turrets, Comsat Stations and Science Vessels for Terran. Zerg have Overlords from the
 * start.
 */
const DETECTOR_IDS: Partial<Record<AssignedRaceChar, ReadonlySet<number>>> = {
  p: new Set([84, 162]),
  t: new Set([72, 107, 124]),
}
const OVERLORD_ID = 42
const HATCHERY_ID = 131
const TOWN_HALL_IDS: ReadonlySet<number> = new Set([106, HATCHERY_ID, 154])
/** Supply Depots and Pylons, which say little about a build. Overlords aren't buildings. */
const SUPPLY_BUILDING_IDS: ReadonlySet<number> = new Set([109, 156])
/** Barracks, Factory, Starport, Hatchery, Robotics Facility, Gateway and Stargate. */
const PRODUCTION_BUILDING_IDS: ReadonlySet<number> = new Set([
  111,
  113,
  114,
  HATCHERY_ID,
  155,
  160,
  167,
])
/**
 * Units that aren't an army: Spider Mines, Nuclear Missiles, Scanner Sweeps, Larvae, Eggs,
 * Broodlings, Cocoons, Interceptors, Scarabs and Lurker Eggs.
 */
const NOT_ARMY_IDS: ReadonlySet<number> = new Set([13, 14, 33, 35, 36, 40, 59, 73, 85, 97])
const FIRST_BUILDING_ID = 106

/** One player's numbers from one game. A number is null when the player wasn't playing at that point. */
export interface PlayerMetrics {
  names: string[]
  race?: AssignedRaceChar
  team: number
  /** The result the game reported, before a game the user left is counted as a loss. */
  result: GameStatsResult
  /** When the player left or was defeated, if that was before the game ended. */
  leftAtMs?: number
  /**
   * Whether the player left while they were still standing, rather than being defeated. Only set
   * for players who went out before the game ended.
   */
  quit?: boolean
  /** False for computers, which play without issuing commands. */
  human: boolean
  apm?: number
  eapm?: number
  /** Finished workers at each of {@link CHECKPOINT_MINUTES}. */
  workers: Array<number | null>
  /** Minerals and gas mined so far, at each checkpoint. */
  mined: Array<number | null>
  /** Minerals and gas mined in the minute before each checkpoint. */
  income: Array<number | null>
  armyScore: Array<number | null>
  /** Bases the player had at each checkpoint. */
  bases: Array<number | null>
  /**
   * Production buildings started so far, at each checkpoint. For Zerg this counts Hatcheries,
   * including the first.
   */
  production: Array<number | null>
  /** When the player first had each of {@link SUPPLY_MILESTONES} in use. */
  supplyTimesMs: Array<number | null>
  /**
   * The minerals and gas on hand, on average, in each of {@link PHASE_MINUTES}, while the player
   * was under {@link MAXED_SUPPLY} supply.
   */
  bank: Array<number | null>
  /** The share of the game the player was out of supply, after the first few minutes. */
  supplyBlockedShare: number | null
  /** How long the player was out of supply over the whole game. */
  supplyBlockedMs?: number
  /** When the player started their second and third town halls. */
  townHallTimesMs: Array<number | null>
  /**
   * When the player first started each building, tech and upgrade level, keyed by
   * {@link buildKey}.
   */
  firstStartsMs: Record<string, number>
  /** The first few buildings the player started, leaving out supply, as {@link buildKey}s. */
  opening: string[]
  /** When the player started their first army unit. */
  firstArmyMs: number | null
  armyKilled?: number
  armyLost?: number
  workersLost?: number
  overlordsLost?: number
  /** The share of the player's actions that weren't effective, like repeated orders. */
  spamShare?: number
  /**
   * From the replay's commands, once they've been read: hotkey recalls, and commands that start
   * making something, per minute in each of {@link PHASE_MINUTES}.
   */
  hotkeyRecallsPerMin?: Array<number | null>
  productionPerMin?: Array<number | null>
  /** Actions per minute in each phase, from the replay's commands. */
  apmByPhase?: Array<number | null>
  /** Effective actions per minute in each of {@link PHASE_MINUTES}, from the game's timeline. */
  eapmByPhase?: Array<number | null>
  /** How many different hotkey groups the player recalled. */
  groupsUsed?: number
  /** Commands to cast each spell, keyed by the spell's name. */
  casts?: Record<string, number>
  /** In team games, the player's part of what their team did, from 0 to 1. */
  teamShare?: { income: number; armyProduced: number; armyKilled: number }
  /** In team games, 1 if the player was the first of their team to leave or be defeated, and so on. */
  outOrder?: number
  /**
   * For Terran and Protoss, the share of their town halls' time spent making workers in the first
   * 8 minutes, from when each could. Zerg make workers from larvae, which this can't tell.
   */
  workerProduction8?: number | null
  /** Moments in the game worth watching again, for a coach to point to. */
  moments?: PlayerMoments
  /** When the player first had a unit near an enemy's starting base. */
  firstScoutMs?: number
  /**
   * For Zerg, the share of their Hatcheries' time in the first 10 minutes spent holding all the
   * larvae they could, which wastes the larvae they'd make next.
   */
  larvaeFull10?: number | null
  /** For Terran and Protoss, when they first started something that detects. */
  detectionMs?: number | null
  /**
   * The buildings, tech and upgrades the player started in the first 10 minutes, in order, up to
   * {@link MAX_BUILD_STEPS}: each one's build key, when, and the supply in use just before.
   */
  buildSteps?: BuildStepMetric[]
  /**
   * When the player first stopped making workers for a minute or more after the first few
   * minutes, and how many they had made by then. Null if they kept going through 12 minutes.
   */
  workerStop?: { workers: number; atMs: number } | null
  /**
   * The army units the player had started by each of {@link ARMY_MIX_MINUTES}, by unit id: how
   * their early army came together.
   */
  armyMix?: Record<number, number[]>
}

/** One step of a build order. */
export interface BuildStepMetric {
  key: string
  timeMs: number
  supply?: number
}

/** Moments in one player's game worth watching again. */
export interface PlayerMoments {
  /** The longest stretch out of supply, after the first few minutes. */
  supplyBlock?: { startMs: number; endMs: number }
  /** The most money on hand at once, while not maxed out. */
  bankPeak?: { atMs: number; amount: number }
  /** The most workers lost within half a minute. */
  workerLoss?: { startMs: number; endMs: number; count: number }
}

/** The numbers My stats works from for one game, small enough to keep for thousands of games. */
export interface GameMetrics {
  version: typeof GAME_METRICS_VERSION
  gameId: string
  durationMs: number
  complete: boolean
  mapName: string
  mapFamily: MapFamily
  shape: GameShape
  players: PlayerMetrics[]
}

/** Identifies a building (`u111`), tech (`t5`) or upgrade level (`g33.1`). */
export function buildKey(step: Pick<BuildStep, 'kind' | 'id' | 'level'>): string {
  if (step.kind === 'upgrade') {
    return `g${step.id}.${step.level ?? 1}`
  }
  return `${step.kind === 'tech' ? 't' : 'u'}${step.id}`
}

/** The players' sides: teams when there are any, otherwise every player on their own. */
function getSides(players: ReadonlyArray<GamePlayerStats>): GamePlayerStats[][] {
  const hasTeams = new Set(players.map(p => p.team)).size > 1
  if (!hasTeams) {
    return players.map(p => [p])
  }
  const byTeam = new Map<number, GamePlayerStats[]>()
  for (const p of players) {
    byTeam.set(p.team, [...(byTeam.get(p.team) ?? []), p])
  }
  return Array.from(byTeam.values())
}

export function getGameShape(players: ReadonlyArray<GamePlayerStats>): GameShape {
  const sides = getSides(players)
  if (sides.every(side => side.length === 1)) {
    if (sides.length === 2) {
      return '1v1'
    }
    return sides.length > 2 ? 'ffa' : 'other'
  }
  const size = sides[0].length
  if (sides.length === 2 && sides[1].length === size && size >= 2 && size <= 4) {
    return `${size}v${size}` as GameShape
  }
  return 'other'
}

function sum(values: ReadonlyArray<number>) {
  return values.reduce((total, value) => total + value, 0)
}

function share(part: number | undefined, whole: number) {
  return whole > 0 ? (part ?? 0) / whole : 0
}

function deathsOf(player: GamePlayerStats, ids: ReadonlySet<number>) {
  return player.deaths
    ? sum(player.deaths.filter(([id]) => ids.has(id)).map(([, count]) => count))
    : undefined
}

class PlayerTimes {
  /** How long the player was playing for. */
  readonly playedMs: number

  constructor(
    private readonly game: GameStats,
    private readonly player: GamePlayerStats,
  ) {
    this.playedMs = Math.min(player.leftAtMs ?? game.durationMs, game.durationMs)
  }

  /** The index of the last sample at or before `ms`, if the player was still playing then. */
  private indexAt(ms: number): number | undefined {
    const times = this.game.snapshotTimesMs
    if (ms > this.playedMs) {
      return undefined
    }
    let index = -1
    while (index + 1 < times.length && times[index + 1] <= ms) {
      index += 1
    }
    return index >= 0 ? index : undefined
  }

  valueAt(list: ReadonlyArray<number> | undefined, ms: number): number | null {
    const index = this.indexAt(ms)
    return list && index !== undefined && index < list.length ? list[index] : null
  }

  /** The time of the first sample whose value reaches `target`. */
  timeToReach(list: ReadonlyArray<number> | undefined, target: number): number | null {
    const index = list?.findIndex(value => value >= target) ?? -1
    return index >= 0 ? this.game.snapshotTimesMs[index] : null
  }

  /** The samples in `list` taken from `startMs` up to `endMs`. */
  between(list: ReadonlyArray<number> | undefined, startMs: number, endMs: number): number[] {
    const times = this.game.snapshotTimesMs
    return (list ?? []).filter((_, i) => times[i] >= startMs && times[i] < endMs)
  }

  sampleTime(index: number) {
    return this.game.snapshotTimesMs[index]
  }

  lastSampleIndex(list: ReadonlyArray<number> | undefined) {
    return list ? Math.min(list.length, this.game.snapshotTimesMs.length) - 1 : -1
  }
}

function getSupplyBlockedShare(times: PlayerTimes, player: GamePlayerStats) {
  const blocked = player.timeline?.supplyBlockedMs
  const last = times.lastSampleIndex(blocked)
  const lastMs = last >= 0 ? times.sampleTime(last) : 0
  if (!blocked || lastMs < MIN_SUPPLY_BLOCK_PLAYED_MS) {
    return null
  }
  const before = times.valueAt(blocked, SUPPLY_BLOCK_GRACE_MS) ?? 0
  return Math.max(0, blocked[last] - before) / (lastMs - SUPPLY_BLOCK_GRACE_MS)
}

/**
 * Whether a player who went out before the game ended was still standing: they had a good part of
 * their workers left, which a defeated player doesn't.
 */
function hasQuit(times: PlayerTimes, player: GamePlayerStats, game: GameStats) {
  if (player.leftAtMs === undefined || player.leftAtMs >= game.durationMs) {
    return undefined
  }
  const workers = player.timeline?.workers
  const last = times.lastSampleIndex(workers)
  if (!workers || last < 0) {
    return undefined
  }
  const most = Math.max(...workers.slice(0, last + 1))
  return workers[last] >= Math.max(MIN_STANDING_WORKERS, most * STANDING_WORKER_SHARE)
}

/** Effective actions per minute in each phase, for as long as the player played in it. */
function getEapmByPhase(
  times: PlayerTimes,
  effectiveActions: ReadonlyArray<number> | undefined,
): Array<number | null> | undefined {
  const last = times.lastSampleIndex(effectiveActions)
  if (!effectiveActions || last < 0) {
    return undefined
  }
  const lastMs = times.sampleTime(last)
  return PHASE_MINUTES.map(([start, end]) => {
    const startMs = start * 60_000
    const endMs = Math.min(end * 60_000, lastMs)
    if (endMs - startMs < MIN_PHASE_MINUTES * 60_000) {
      return null
    }
    const before = times.valueAt(effectiveActions, startMs) ?? 0
    const after = times.valueAt(effectiveActions, endMs)
    return after === null ? null : (after - before) / ((endMs - startMs) / 60_000)
  })
}

/**
 * The share of a Terran's or Protoss's town hall time spent making workers in the first 8 minutes.
 * Each town hall counts from when it could make them, until the 8 minutes are up or the player
 * left.
 */
function getWorkerProduction(
  player: GamePlayerStats,
  playedMs: number,
  unitSteps: ReadonlyArray<{ id: number; timeMs: number }>,
) {
  if (player.race !== 't' && player.race !== 'p') {
    return undefined
  }
  const endMs = Math.min(WORKER_PRODUCTION_MS, playedMs)
  if (endMs < WORKER_PRODUCTION_MS / 2) {
    return null
  }
  const readyTimes = [
    0,
    ...unitSteps
      .filter(step => WORKER_TOWN_HALL_IDS.has(step.id))
      .map(step => step.timeMs + TOWN_HALL_BUILD_MS),
  ].filter(ms => ms < endMs)
  const capacity = sum(readyTimes.map(ms => endMs - ms))
  const used = unitSteps.filter(step => WORKER_IDS.has(step.id) && step.timeMs < endMs).length
  return capacity > 0 ? Math.min(1, (used * WORKER_BUILD_MS) / capacity) : null
}

/** A player's early build order, when they stopped making workers, and what army they made. */
function getBuild(
  player: GamePlayerStats,
  unitSteps: ReadonlyArray<{ id: number; timeMs: number; count: number }>,
): Pick<PlayerMetrics, 'buildSteps' | 'workerStop' | 'armyMix'> {
  if (!player.buildOrder) {
    return {}
  }
  const buildSteps = player.buildOrder
    .filter(
      step =>
        !step.cancelled &&
        step.timeMs <= BUILD_MS &&
        (step.kind !== 'unit' || step.id >= FIRST_BUILDING_ID),
    )
    .slice(0, MAX_BUILD_STEPS)
    .map(step => ({ key: buildKey(step), timeMs: step.timeMs, supply: step.supply }))

  const workerTimes = unitSteps.filter(step => WORKER_IDS.has(step.id)).map(step => step.timeMs)
  let workerStop: PlayerMetrics['workerStop'] = null
  for (let i = 0; i < workerTimes.length; i++) {
    const next = workerTimes[i + 1] ?? Infinity
    if (workerTimes[i] >= WORKER_STOP_UNTIL_MS) {
      break
    }
    if (workerTimes[i] >= WORKER_STOP_FROM_MS && next - workerTimes[i] >= WORKER_STOP_GAP_MS) {
      workerStop = { workers: STARTING_WORKERS + i + 1, atMs: workerTimes[i] }
      break
    }
  }

  const armyMix: Record<number, number[]> = {}
  for (const step of unitSteps) {
    const isArmy =
      step.id < FIRST_BUILDING_ID &&
      !WORKER_IDS.has(step.id) &&
      step.id !== OVERLORD_ID &&
      !NOT_ARMY_IDS.has(step.id)
    if (!isArmy) {
      continue
    }
    const counts = armyMix[step.id] ?? ARMY_MIX_MINUTES.map(() => 0)
    ARMY_MIX_MINUTES.forEach((minute, i) => {
      if (step.timeMs <= minute * 60_000) {
        counts[i] += step.count
      }
    })
    if (counts.some(Boolean)) {
      armyMix[step.id] = counts
    }
  }
  return { buildSteps, workerStop, armyMix }
}

/** For Zerg, the share of their Hatcheries' time in the first 10 minutes spent full of larvae. */
function getLarvaeFull(times: PlayerTimes, player: GamePlayerStats) {
  const hatchery = player.timeline?.hatcheryMs
  const capped = player.timeline?.larvaCappedMs
  if (player.race !== 'z' || !hatchery || !capped) {
    return undefined
  }
  const total = times.valueAt(hatchery, LARVA_MS)
  const full = times.valueAt(capped, LARVA_MS)
  return total && full !== null ? full / total : null
}

/** For Terran and Protoss, when they first started a detector, or null if they never did. */
function getDetection(
  player: GamePlayerStats,
  unitSteps: ReadonlyArray<{ id: number; timeMs: number }>,
) {
  const detectors = player.race ? DETECTOR_IDS[player.race] : undefined
  if (!detectors || !player.buildOrder) {
    return undefined
  }
  return unitSteps.find(step => detectors.has(step.id))?.timeMs ?? null
}

/** The moments in a player's game a coach would point to, from its timeline. */
function getMoments(times: PlayerTimes, player: GamePlayerStats): PlayerMoments | undefined {
  const timeline = player.timeline
  if (!timeline) {
    return undefined
  }
  const moments: PlayerMoments = {}

  const blocked = timeline.supplyBlockedMs ?? []
  const last = times.lastSampleIndex(blocked)
  let run: { startMs: number; endMs: number } | undefined
  for (let i = 1; i <= last; i++) {
    const growing = blocked[i] > blocked[i - 1] && times.sampleTime(i) > SUPPLY_BLOCK_GRACE_MS
    if (growing) {
      run = run
        ? { ...run, endMs: times.sampleTime(i) }
        : {
            startMs: times.sampleTime(i - 1),
            endMs: times.sampleTime(i),
          }
      const longest = moments.supplyBlock
      if (!longest || run.endMs - run.startMs > longest.endMs - longest.startMs) {
        moments.supplyBlock = run
      }
    } else {
      run = undefined
    }
  }

  const unspent = timeline.unspent ?? []
  for (let i = 0; i <= times.lastSampleIndex(unspent); i++) {
    const maxed = (timeline.supplyUsed?.[i] ?? 0) >= MAXED_SUPPLY
    if (!maxed && unspent[i] > (moments.bankPeak?.amount ?? 0)) {
      moments.bankPeak = { atMs: times.sampleTime(i), amount: unspent[i] }
    }
  }

  const workers = timeline.workers ?? []
  // A player's last minute is their defeat, when everything dies, which isn't a moment to learn
  // from like a raid is.
  const lastMs = times.playedMs - FINAL_MINUTE_MS
  for (let i = 0; i <= times.lastSampleIndex(workers); i++) {
    const endMs = times.sampleTime(i)
    if (endMs > lastMs) {
      break
    }
    let start = i
    while (start > 0 && endMs - times.sampleTime(start - 1) <= WORKER_LOSS_WINDOW_MS) {
      start -= 1
    }
    const count = Math.max(...workers.slice(start, i + 1)) - workers[i]
    if (count >= MIN_WORKER_LOSS && count > (moments.workerLoss?.count ?? 0)) {
      moments.workerLoss = { startMs: times.sampleTime(start), endMs, count }
    }
  }
  return moments
}

function computePlayerMetrics(game: GameStats, player: GamePlayerStats): PlayerMetrics {
  const times = new PlayerTimes(game, player)
  const timeline = player.timeline
  const checkpointsMs = CHECKPOINT_MINUTES.map(minute => minute * 60_000)
  const buildOrder = (player.buildOrder ?? []).filter(step => !step.cancelled)
  const unitSteps = buildOrder.filter(step => step.kind === 'unit')
  const buildings = unitSteps.filter(step => step.id >= FIRST_BUILDING_ID)

  const firstStartsMs: Record<string, number> = {}
  for (const step of buildOrder) {
    if (step.kind !== 'unit' || step.id >= FIRST_BUILDING_ID) {
      const key = buildKey(step)
      firstStartsMs[key] = Math.min(firstStartsMs[key] ?? Infinity, step.timeMs)
    }
  }

  const productionAt = (ms: number) => {
    if (ms > times.playedMs) {
      return null
    }
    const started = buildings.filter(
      step => PRODUCTION_BUILDING_IDS.has(step.id) && step.timeMs <= ms,
    ).length
    return started + (player.race === 'z' ? 1 : 0)
  }

  const townHalls = buildings.filter(step => TOWN_HALL_IDS.has(step.id))
  const firstArmy = unitSteps.find(
    step =>
      step.id < FIRST_BUILDING_ID &&
      !WORKER_IDS.has(step.id) &&
      step.id !== OVERLORD_ID &&
      !NOT_ARMY_IDS.has(step.id),
  )

  return {
    names: player.names,
    race: player.race,
    team: player.team,
    result: player.result,
    leftAtMs: player.leftAtMs,
    quit: hasQuit(times, player, game),
    human: player.apm !== undefined,
    apm: player.apm,
    eapm: player.eapm,
    workers: checkpointsMs.map(ms => times.valueAt(timeline?.workers, ms)),
    mined: checkpointsMs.map(ms => times.valueAt(timeline?.resourcesMined, ms)),
    income: checkpointsMs.map(ms => {
      const now = times.valueAt(timeline?.resourcesMined, ms)
      const before = times.valueAt(timeline?.resourcesMined, ms - 60_000)
      return now !== null && before !== null ? now - before : null
    }),
    armyScore: checkpointsMs.map(ms => times.valueAt(timeline?.armyScore, ms)),
    bases: checkpointsMs.map(ms => times.valueAt(timeline?.bases, ms)),
    production: checkpointsMs.map(productionAt),
    supplyTimesMs: SUPPLY_MILESTONES.map(supply => times.timeToReach(timeline?.supplyUsed, supply)),
    bank: PHASE_MINUTES.map(([start, end]) => {
      const supply = times.between(timeline?.supplyUsed, start * 60_000, end * 60_000)
      const samples = times
        .between(timeline?.unspent, start * 60_000, end * 60_000)
        .filter((_, i) => supply[i] === undefined || supply[i] < MAXED_SUPPLY)
      return samples.length >= MIN_PHASE_SAMPLES ? Math.round(sum(samples) / samples.length) : null
    }),
    supplyBlockedShare: getSupplyBlockedShare(times, player),
    eapmByPhase: getEapmByPhase(times, timeline?.effectiveActions),
    supplyBlockedMs: player.supplyBlockedMs,
    townHallTimesMs: [townHalls[0]?.timeMs ?? null, townHalls[1]?.timeMs ?? null],
    firstStartsMs,
    opening: buildings
      .filter(step => !SUPPLY_BUILDING_IDS.has(step.id))
      .slice(0, OPENING_LENGTH)
      .map(buildKey),
    firstArmyMs: firstArmy?.timeMs ?? null,
    spamShare:
      player.apm && player.eapm !== undefined
        ? Math.max(0, (player.apm - player.eapm) / player.apm)
        : undefined,
    armyKilled: player.armyKilled?.score,
    armyLost: player.armyLost?.score,
    workersLost: deathsOf(player, WORKER_IDS),
    overlordsLost: player.race === 'z' ? deathsOf(player, new Set([OVERLORD_ID])) : undefined,
    workerProduction8: getWorkerProduction(player, times.playedMs, unitSteps),
    moments: getMoments(times, player),
    firstScoutMs: player.firstScoutMs,
    larvaeFull10: getLarvaeFull(times, player),
    detectionMs: getDetection(player, unitSteps),
    ...getBuild(player, unitSteps),
  }
}

/** Adds what the replay's commands say about the player. */
function addCommandMetrics(metrics: PlayerMetrics, commands: PlayerCommandStats) {
  const perMinute = (pick: (phase: PlayerCommandStats['phases'][number]) => number) =>
    commands.phases.map(phase =>
      phase.minutes >= MIN_PHASE_MINUTES ? pick(phase) / phase.minutes : null,
    )
  metrics.hotkeyRecallsPerMin = perMinute(phase => phase.hotkeyRecalls)
  metrics.productionPerMin = perMinute(phase => phase.production)
  metrics.apmByPhase = perMinute(phase => phase.actions)
  metrics.groupsUsed = commands.groupsUsed
  metrics.casts = commands.casts
}

/** Adds what only makes sense next to teammates: each player's share of the team, and who went first. */
function addTeamMetrics(game: GameStats, metrics: PlayerMetrics[]) {
  for (const side of getSides(game.players)) {
    if (side.length < 2) {
      continue
    }
    const indexes = side.map(p => game.players.indexOf(p))
    const income = sum(side.map(p => p.mineralsMined + p.gasMined))
    const armyProduced = sum(side.map(p => p.armyProduced?.score ?? 0))
    const armyKilled = sum(side.map(p => p.armyKilled?.score ?? 0))
    const outTimes = side
      .map(p => p.leftAtMs)
      .filter(ms => ms !== undefined)
      .sort((a, b) => a - b)
    side.forEach((p, i) => {
      const m = metrics[indexes[i]]
      m.teamShare = {
        income: share(p.mineralsMined + p.gasMined, income),
        armyProduced: share(p.armyProduced?.score, armyProduced),
        armyKilled: share(p.armyKilled?.score, armyKilled),
      }
      if (p.leftAtMs !== undefined) {
        m.outOrder = outTimes.indexOf(p.leftAtMs) + 1
      }
    })
  }
}

/** Works out the numbers My stats compares from a game's stats. */
export function computeGameMetrics(
  gameId: string,
  game: GameStats,
  commands?: ReplayCommandStats,
): GameMetrics {
  const players = game.players.map(p => computePlayerMetrics(game, p))
  addTeamMetrics(game, players)
  if (commands) {
    players.forEach((metrics, i) => {
      const names = game.players[i].names.map(n => n.toLowerCase())
      const matching = commands.players.find(c => names.includes(c.name.toLowerCase()))
      if (matching) {
        addCommandMetrics(metrics, matching)
      }
    })
  }
  return {
    version: GAME_METRICS_VERSION,
    gameId,
    durationMs: game.durationMs,
    complete: game.complete,
    mapName: game.mapName,
    mapFamily: getMapFamily(game.mapName),
    shape: getGameShape(game.players),
    players,
  }
}
