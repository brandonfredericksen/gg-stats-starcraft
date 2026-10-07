import { AssignedRaceChar } from '../races'
import type { ReplayCommandStats } from './command-stats'

/** BW's game speed on Fastest, which online games are played at. */
export const FASTEST_MS_PER_FRAME = 42

type UnitCounts = Array<[unitId: number, count: number]>

/** One player's stats, as the game reports them when it ends. */
export interface GamePlayerStatsPayload {
  id: number
  /** More than one in games with shared control, where everyone sharing a slot is reported together. */
  names: string[]
  /** BW's race id: 0 is Zerg, 1 is Terran and 2 is Protoss. */
  race: number
  team: number
  /** BW's victory state: 2 is a defeat and 3 is a victory. */
  victoryState: number
  /** The frame this player left or was defeated on, if that was before the game ended. */
  leftAtFrame: number | null
  /** Missing for computers, which play without issuing commands. */
  actions: number | null
  /** Actions that weren't wasted, like a stop repeated before the first could matter. */
  effectiveActions: number | null
  mineralsMined: number
  gasMined: number
  unitScore: number
  killScore: number
  buildingScore: number
  razingScore: number
  /**
   * Unit id and count for each type of unit this player produced. This and the other unit lists are
   * missing on maps with their own rules, whose triggers can create and count units however they
   * like.
   */
  produced: UnitCounts | null
  /** Unit id and count for each type of enemy this player destroyed. */
  kills: UnitCounts | null
  /** Unit id and count for each type of this player's own units that died. */
  deaths: UnitCounts | null
  /**
   * What the army units this player produced, killed and lost were worth. Workers, buildings and
   * Overlords aren't part of an army. Units produced count what making them added, on top of the
   * units they were made from, while ones killed and lost count everything they were worth.
   */
  armyProduced: ArmyWorth | null
  armyKilled: ArmyWorth | null
  armyLost: ArmyWorth | null
  /** What everything this player destroyed was worth in minerals and gas together. */
  resourcesDestroyed: number | null
  /** What everything this player lost was worth in minerals and gas together. */
  resourcesLost: number | null
  /** How many frames the player couldn't make more units because they were out of supply. */
  supplyBlockedFrames: number | null
  /** The frame the player first had a unit near an enemy's starting base. */
  firstScoutFrame?: number | null
  /**
   * The player's progress over the game, with one value per frame in
   * {@link GameStatsPayload.snapshotFrames} for as long as they were playing.
   */
  timeline: TimelinePayload | null
  /** What the player started making, researching and upgrading, in order. */
  buildOrder: BuildStepPayload[] | null
}

export type BuildStepKind = 'unit' | 'upgrade' | 'tech'

const BUILD_STEP_KINDS: ReadonlySet<unknown> = new Set<BuildStepKind>(['unit', 'upgrade', 'tech'])

/** One thing a player started making, researching or upgrading. */
export interface BuildStepPayload {
  /** When it was started. */
  frame: number
  kind: BuildStepKind
  /** The unit type, upgrade or tech. */
  id: number
  /** The level an upgrade went up to. */
  level?: number
  /**
   * The player's supply in use just before, in whole units. Missing for research, which is only
   * noticed once it's done.
   */
  supply: number | null
  /** How many were started at once, like the two Zerglings from one egg. */
  count: number
  cancelled: boolean
}

/**
 * What a group of units is worth: the game's own score for them, which weighs gas and tech more
 * than minerals, and the minerals and gas they took.
 */
export interface ArmyWorth {
  score: number
  minerals: number
  gas: number
}

export interface TimelinePayload {
  /** Finished workers. */
  workers: number[]
  /**
   * Workers finished or being made, missing in stats from before it was recorded. Each uses one
   * supply, so supply used less these is what the rest of the player's units use.
   */
  workersStarted?: number[]
  /** The game's score for the player's army, see {@link ArmyWorth}. */
  armyScore: number[]
  /** Minerals and gas mined so far. */
  resourcesMined: number[]
  /** Minerals and gas on hand, not yet spent. */
  unspent: number[]
  supplyUsed: number[]
  /** What the player's supply buildings provided, up to the limit of 200. */
  supplyAvailable: number[]
  /** Actions so far, missing for computers. */
  actions: number[] | null
  /** Effective actions so far, missing for computers and in stats from before it was recorded. */
  effectiveActions?: number[] | null
  /** What everything the player lost so far was worth in minerals and gas together. */
  resourcesLost: number[]
  /** Town halls with minerals left near them, counting ones close together as one base. */
  bases: number[]
  /** How many frames the player had been out of supply so far. */
  supplyBlockedFrames: number[]
  /**
   * For Zerg, frames their Hatcheries, Lairs and Hives had worked so far, added up over all of
   * them, and of those, frames they held all the larvae they could.
   */
  hatcheryFrames?: number[]
  larvaCappedFrames?: number[]
}

export interface GameStatsPayload {
  mapName: string
  frames: number
  /** The frames each player's progress was recorded on, about every 10 seconds. */
  snapshotFrames: number[]
  /**
   * False when the stats don't cover the whole game: a replay being analyzed stopped before its
   * end, or the game went on after it ended for this client.
   */
  complete: boolean
  players: GamePlayerStatsPayload[]
}

/** Stats from a replay analyzed in the background. */
export interface ReplayStatsSource {
  kind: 'replay'
  name: string
  path: string
  /**
   * The game these stats belong with: the game id the replay records, if the client that saved it
   * records one, or the game whose page asked for the analysis.
   */
  linkedGameId?: string
}

/** Stats from a game someone played, along with its replay once that has been saved. */
export interface PlayedGameStatsSource {
  kind: 'game'
  replayPath?: string
}

export type GameStatsSource = ReplayStatsSource | PlayedGameStatsSource

/** The size and last modified time of a replay file, which tell different versions of it apart. */
export interface ReplayFileInfo {
  size: number
  modifiedMs: number
}

/**
 * The version of {@link SavedGameStats} written now. Stats saved by an older version are treated as
 * missing, since what they hold may mean something different.
 */
export const SAVED_GAME_STATS_VERSION = 1

/** A game's stats as they're saved on disk. */
export interface SavedGameStats {
  version: typeof SAVED_GAME_STATS_VERSION
  gameId: string
  /** When the stats were saved, in milliseconds since the epoch. */
  savedAt: number
  source: GameStatsSource
  /** The replay file the stats belong to, as it was when they were saved. */
  replayFile?: ReplayFileInfo
  stats: GameStatsPayload
  /** What the replay's commands say, once they've been read. */
  commands?: ReplayCommandStats
}

export type GameStatsResult = 'win' | 'loss' | 'unknown'

export interface GamePlayerStats {
  id: number
  /** Everyone playing as this player, joined together for showing. */
  name: string
  /** More than one in games with shared control. */
  names: string[]
  race?: AssignedRaceChar
  team: number
  result: GameStatsResult
  /** How far into the game this player left or was defeated, if that was before it ended. */
  leftAtMs?: number
  /** Stats the game couldn't track are left undefined. */
  apm?: number
  eapm?: number
  mineralsMined: number
  gasMined: number
  /**
   * The player's unit, building, kill and razing scores plus every resource they mined, the parts
   * StarCraft's own score screen totals up.
   */
  totalScore: number
  /** Unit lists the game couldn't count are left undefined. */
  produced?: UnitCounts
  kills?: UnitCounts
  deaths?: UnitCounts
  /** What the player's army units were worth, see {@link GamePlayerStatsPayload.armyProduced}. */
  armyProduced?: ArmyWorth
  armyKilled?: ArmyWorth
  armyLost?: ArmyWorth
  resourcesDestroyed?: number
  resourcesLost?: number
  supplyBlockedMs?: number
  /** When the player first had a unit near an enemy's starting base. */
  firstScoutMs?: number
  /** The minerals and gas the player had on hand, on average over the game. */
  averageUnspent?: number
  /**
   * The player's progress, with one value per time in {@link GameStats.snapshotTimesMs} for as long
   * as they were playing.
   */
  timeline?: PlayerTimeline
  /** What the player started making, researching and upgrading, in order. */
  buildOrder?: BuildStep[]
}

export interface BuildStep {
  /** When it was started. */
  timeMs: number
  kind: BuildStepKind
  id: number
  level?: number
  supply?: number
  count: number
  cancelled: boolean
}

/** Each list has a value per recorded time, for as long as the player was playing. */
export interface PlayerTimeline {
  /** Finished workers. */
  workers: number[]
  armyScore: number[]
  resourcesMined: number[]
  /** Lists the game didn't report, like actions for computers, are left undefined. */
  unspent?: number[]
  /** Workers finished or being made, see {@link TimelinePayload.workersStarted}. */
  workersStarted?: number[]
  supplyUsed?: number[]
  supplyAvailable?: number[]
  actions?: number[]
  effectiveActions?: number[]
  resourcesLost?: number[]
  bases?: number[]
  /** How long the player had been out of supply so far. */
  supplyBlockedMs?: number[]
  /**
   * For Zerg, how long their Hatcheries, Lairs and Hives had worked so far, added up over all of
   * them, and of that, how long they held all the larvae they could.
   */
  hatcheryMs?: number[]
  larvaCappedMs?: number[]
}

export interface GameStats {
  mapName: string
  durationMs: number
  /** False when these stats only cover part of the game. */
  complete: boolean
  /** When each player's progress was recorded. */
  snapshotTimesMs: number[]
  players: GamePlayerStats[]
}

const BW_RACES: ReadonlyArray<AssignedRaceChar> = ['z', 't', 'p']

/**
 * Reads a count from the game's report, treating anything that isn't a usable number as 0 so one
 * bad value can't take the rest of the stats down with it.
 */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function unitCounts(value: unknown): UnitCounts | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.filter(
    (entry): entry is [number, number] =>
      Array.isArray(entry) &&
      Number.isInteger(entry[0]) &&
      typeof entry[1] === 'number' &&
      entry[1] > 0,
  )
}

/** A list of counts, cut short at the first value that isn't one, and at `maxLength`. */
function countList(value: unknown, maxLength: number): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const end = value.findIndex(n => optionalCount(n) === undefined)
  return value.slice(0, Math.min(end === -1 ? value.length : end, maxLength))
}

function toTimeline(value: unknown, snapshotCount: number): PlayerTimeline | undefined {
  const timeline = value as Partial<TimelinePayload> | null | undefined
  const workers = countList(timeline?.workers, snapshotCount)
  const armyScore = countList(timeline?.armyScore, snapshotCount)
  const resourcesMined = countList(timeline?.resourcesMined, snapshotCount)
  if (!workers || !armyScore || !resourcesMined) {
    return undefined
  }
  // Each list has to line up with the others, so they're all as long as the shortest.
  const length = Math.min(workers.length, armyScore.length, resourcesMined.length)
  const optional = (list: unknown) => countList(list, length)
  return {
    workers: workers.slice(0, length),
    armyScore: armyScore.slice(0, length),
    resourcesMined: resourcesMined.slice(0, length),
    unspent: optional(timeline?.unspent),
    workersStarted: optional(timeline?.workersStarted),
    supplyUsed: optional(timeline?.supplyUsed),
    supplyAvailable: optional(timeline?.supplyAvailable),
    actions: optional(timeline?.actions),
    effectiveActions: optional(timeline?.effectiveActions),
    resourcesLost: optional(timeline?.resourcesLost),
    bases: optional(timeline?.bases),
    supplyBlockedMs: optional(timeline?.supplyBlockedFrames)?.map(
      frames => frames * FASTEST_MS_PER_FRAME,
    ),
    hatcheryMs: optional(timeline?.hatcheryFrames)?.map(frames => frames * FASTEST_MS_PER_FRAME),
    larvaCappedMs: optional(timeline?.larvaCappedFrames)?.map(
      frames => frames * FASTEST_MS_PER_FRAME,
    ),
  }
}

function toArmyWorth(value: unknown): ArmyWorth | undefined {
  const worth = value as Partial<ArmyWorth> | null | undefined
  const score = optionalCount(worth?.score)
  const minerals = optionalCount(worth?.minerals)
  const gas = optionalCount(worth?.gas)
  return score !== undefined && minerals !== undefined && gas !== undefined
    ? { score, minerals, gas }
    : undefined
}

function toBuildOrder(value: unknown): BuildStep[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.flatMap((step: Partial<BuildStepPayload> | null): BuildStep[] => {
    const frame = optionalCount(step?.frame)
    const id = optionalCount(step?.id)
    if (
      frame === undefined ||
      id === undefined ||
      !Number.isInteger(id) ||
      !BUILD_STEP_KINDS.has(step?.kind)
    ) {
      return []
    }
    return [
      {
        timeMs: frame * FASTEST_MS_PER_FRAME,
        kind: step!.kind!,
        id,
        level: optionalCount(step?.level),
        supply: optionalCount(step?.supply),
        count: optionalCount(step?.count) || 1,
        cancelled: step?.cancelled === true,
      },
    ]
  })
}

function average(values: ReadonlyArray<number> | undefined) {
  return values?.length
    ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
    : undefined
}

function toResult(victoryState: unknown): GameStatsResult {
  switch (victoryState) {
    case 2:
      return 'loss'
    case 3:
      return 'win'
    default:
      return 'unknown'
  }
}

function framesToMs(frames: number | undefined) {
  return frames === undefined ? undefined : frames * FASTEST_MS_PER_FRAME
}

function perMinute(n: number | undefined, ms: number) {
  if (n === undefined) {
    return undefined
  }
  return ms > 0 ? Math.round(n / (ms / 60_000)) : 0
}

function toPlayerStats(
  player: GamePlayerStatsPayload,
  frames: number,
  snapshotCount: number,
): GamePlayerStats {
  const leftAtFrame = optionalCount(player.leftAtFrame)
  const playedMs = (leftAtFrame ?? frames) * FASTEST_MS_PER_FRAME
  const produced = unitCounts(player.produced)
  const timeline = toTimeline(player.timeline, snapshotCount)
  const names = Array.isArray(player.names)
    ? player.names.filter(name => typeof name === 'string' && name)
    : []
  const mineralsMined = count(player.mineralsMined)
  const gasMined = count(player.gasMined)

  return {
    id: count(player.id),
    name: names.length ? names.join(' + ') : '?',
    names,
    race: typeof player.race === 'number' ? BW_RACES[player.race] : undefined,
    team: count(player.team),
    result: toResult(player.victoryState),
    leftAtMs: leftAtFrame !== undefined ? leftAtFrame * FASTEST_MS_PER_FRAME : undefined,
    apm: perMinute(optionalCount(player.actions), playedMs),
    eapm: perMinute(optionalCount(player.effectiveActions), playedMs),
    mineralsMined,
    gasMined,
    totalScore:
      count(player.unitScore) +
      count(player.buildingScore) +
      count(player.killScore) +
      count(player.razingScore) +
      mineralsMined +
      gasMined,
    produced,
    kills: unitCounts(player.kills),
    deaths: unitCounts(player.deaths),
    armyProduced: toArmyWorth(player.armyProduced),
    armyKilled: toArmyWorth(player.armyKilled),
    armyLost: toArmyWorth(player.armyLost),
    resourcesDestroyed: optionalCount(player.resourcesDestroyed),
    resourcesLost: optionalCount(player.resourcesLost),
    supplyBlockedMs: framesToMs(optionalCount(player.supplyBlockedFrames)),
    firstScoutMs: framesToMs(optionalCount(player.firstScoutFrame)),
    averageUnspent: average(timeline?.unspent),
    timeline,
    buildOrder: toBuildOrder(player.buildOrder),
  }
}

/**
 * Converts the stats a game reported. The report crosses a process boundary, so it's checked as it
 * goes: a player or value that can't be read is dropped or shown as missing rather than failing the
 * whole report.
 */
export function fromGameStatsPayload(payload: GameStatsPayload): GameStats {
  const frames = count(payload?.frames)
  const players = Array.isArray(payload?.players) ? payload.players : []
  const snapshotFrames = countList(payload?.snapshotFrames, Infinity) ?? []
  return {
    mapName: typeof payload?.mapName === 'string' ? payload.mapName : '',
    durationMs: frames * FASTEST_MS_PER_FRAME,
    complete: payload?.complete !== false,
    snapshotTimesMs: snapshotFrames.map(frame => frame * FASTEST_MS_PER_FRAME),
    players: players
      .filter(player => player && typeof player === 'object')
      .map(player => toPlayerStats(player, frames, snapshotFrames.length)),
  }
}

/** The few numbers about a game the replay library shows next to it. */
export interface GameStatsSummary {
  gameId: string
  complete: boolean
  durationMs: number
  players: Array<{
    name: string
    race?: AssignedRaceChar
    team: number
    result: GameStatsResult
    /** When the player left or was defeated, if before the game ended. */
    leftAtMs?: number
    apm?: number
    totalScore: number
    armyKilled?: number
    resourcesMined: number
  }>
}

export function summarizeGameStats(gameId: string, stats: GameStats): GameStatsSummary {
  return {
    gameId,
    complete: stats.complete,
    durationMs: stats.durationMs,
    players: stats.players.map(p => ({
      name: p.name,
      race: p.race,
      team: p.team,
      result: p.result,
      leftAtMs: p.leftAtMs,
      apm: p.apm,
      totalScore: p.totalScore,
      armyKilled: p.armyKilled?.score,
      resourcesMined: p.mineralsMined + p.gasMined,
    })),
  }
}
