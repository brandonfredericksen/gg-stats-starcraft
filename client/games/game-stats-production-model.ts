import { TFunction } from 'i18next'
import { FASTEST_MS_PER_FRAME, GamePlayerStats } from '../../common/games/game-stats'
import { getTechName, getUpgradeName } from '../../common/games/research-types'
import { getUnitBuildFrames, getUnitTypeInfo } from '../../common/games/unit-types'
import { LEVELED_UPGRADES_END } from './game-stats-model'

/**
 * What isn't worth a place among what a player has made: supply, gas, Overlords, Creep Colonies
 * (which are only a step toward the colony they become) and what units make themselves.
 */
const HIDDEN_UNIT_IDS: ReadonlySet<number> = new Set([
  13, // Spider Mine
  14, // Nuclear Missile
  33, // Scanner Sweep
  42, // Overlord
  73, // Interceptor
  85, // Scarab
  109, // Supply Depot
  110, // Refinery
  143, // Creep Colony
  149, // Extractor
  156, // Pylon
  157, // Assimilator
])

/**
 * Buildings that morph into the next one in the list, shown as the one building they are: counted
 * once, as the first, and drawn as the furthest along any of them got.
 */
const BUILDING_LINES: ReadonlyArray<ReadonlyArray<number>> = [
  [131, 132, 133], // Hatchery, Lair, Hive
  [141, 137], // Spire, Greater Spire
]

export interface ProductionItem {
  /** What it's stacked under, its name. */
  key: string
  name: string
  kind: 'unit' | 'upgrade' | 'tech'
  /** The unit, upgrade or tech whose icon it has. */
  id: number
  /** How many there are, or an upgrade's level. */
  count?: number
  /** For a unit in production, how far along its oldest is, from 0 to 1. */
  progress?: number
  /** How far along its line of morphing buildings it got, from 0 for the first. */
  rank: number
}

type ItemGroup = 'units' | 'structures' | 'upgrades'

/** A step of a build order, named and sorted out once so playback only has to add them up. */
export interface ProductionStep extends Omit<ProductionItem, 'count' | 'progress'> {
  timeMs: number
  group: ItemGroup
  /** How many were started, or the level of an upgrade. */
  count?: number
  /** For a unit, how many game frames it takes to make. */
  frames?: number
  /** Whether it adds to the count, rather than only moving its building along a line. */
  counts: boolean
}

/**
 * The steps of a player's build order that are worth showing, with canceled and hidden ones left
 * out. Undefined if the game didn't record a build order.
 */
export function toProductionSteps(
  player: GamePlayerStats,
  t: TFunction,
): ProductionStep[] | undefined {
  if (!player.buildOrder) {
    return undefined
  }
  const steps: ProductionStep[] = []
  for (const step of player.buildOrder) {
    if (step.cancelled) {
      continue
    }
    if (step.kind === 'unit') {
      if (HIDDEN_UNIT_IDS.has(step.id)) {
        continue
      }
      const line = BUILDING_LINES.find(ids => ids.includes(step.id))
      const rank = line ? line.indexOf(step.id) : 0
      const info = getUnitTypeInfo(line ? line[0] : step.id, t)
      steps.push({
        key: info.name,
        name: info.name,
        kind: 'unit',
        id: step.id,
        rank,
        timeMs: step.timeMs,
        group: info.isBuilding ? 'structures' : 'units',
        count: step.count,
        frames: info.isBuilding ? undefined : getUnitBuildFrames(step.id),
        counts: rank === 0,
      })
      continue
    }

    let name = step.kind === 'upgrade' ? getUpgradeName(step.id, t) : getTechName(step.id, t)
    const level = step.kind === 'upgrade' && step.id < LEVELED_UPGRADES_END ? step.level : undefined
    if (level) {
      name = t('gameStats.upgradeLevel', '{{name}} {{level}}', { name, level })
    }
    steps.push({
      key: name,
      name,
      kind: step.kind,
      id: step.id,
      rank: 0,
      timeMs: step.timeMs,
      group: 'upgrades',
      count: level,
      counts: false,
    })
  }
  return steps
}

export interface PlayerProduction {
  /** The units in production, stacked by type, in the order of the unit ids. */
  producing: ProductionItem[]
  units: ProductionItem[]
  structures: ProductionItem[]
  upgrades: ProductionItem[]
}

/**
 * What a player had started making, building and researching by `atMs`, in the order they first
 * did so items don't change places as counts change, and which of the units are still in
 * production, each stack with how far along its oldest is. With no moment, everything is done.
 */
export function getProduction(
  steps: ReadonlyArray<ProductionStep>,
  atMs: number | undefined,
): PlayerProduction {
  const groups: Record<ItemGroup, Map<string, ProductionItem>> = {
    units: new Map(),
    structures: new Map(),
    upgrades: new Map(),
  }
  const producing = new Map<string, ProductionItem>()
  for (const step of steps) {
    if (atMs !== undefined && step.timeMs > atMs) {
      break
    }

    const group = groups[step.group]
    if (step.group === 'upgrades') {
      // An upgrade started again is a later level, so it replaces the one before.
      group.set(step.key, {
        key: step.key,
        name: step.name,
        kind: step.kind,
        id: step.id,
        rank: 0,
        count: step.count,
      })
      continue
    }
    const existing = group.get(step.key)
    const added = step.counts ? (step.count ?? 0) : 0
    if (!existing) {
      // A building seen only after it morphed, because the stats start partway, is still one.
      group.set(step.key, {
        key: step.key,
        name: step.name,
        kind: step.kind,
        id: step.id,
        rank: step.rank,
        count: step.counts ? added : 1,
      })
    } else {
      existing.count = (existing.count ?? 0) + added
      if (step.rank > existing.rank) {
        existing.rank = step.rank
        existing.id = step.id
      }
    }

    if (atMs === undefined || step.frames === undefined) {
      continue
    }
    const progress = (atMs - step.timeMs) / (step.frames * FASTEST_MS_PER_FRAME)
    if (progress >= 1) {
      continue
    }
    const stack = producing.get(step.key)
    if (stack) {
      stack.count = (stack.count ?? 0) + (step.count ?? 0)
    } else {
      producing.set(step.key, {
        key: step.key,
        name: step.name,
        kind: step.kind,
        id: step.id,
        rank: 0,
        count: step.count,
        progress,
      })
    }
  }
  return {
    producing: Array.from(producing.values()).sort((a, b) => a.id - b.id),
    units: Array.from(groups.units.values()),
    structures: Array.from(groups.structures.values()),
    upgrades: Array.from(groups.upgrades.values()),
  }
}

/** How far back to measure how fast a player is mining. */
const INCOME_WINDOW_MS = 60_000

export interface PlayerResources {
  supplyUsed?: number
  supplyAvailable?: number
  workers: number
  bases?: number
  army: number
  unspent?: number
  mined: number
  /** How much was mined per minute over the last {@link INCOME_WINDOW_MS}, once there's been that long. */
  minedPerMinute?: number
}

/** The index of the last recorded time at or before `atMs`, or of the last one with no moment. */
export function findSnapshotIndex(timesMs: ReadonlyArray<number>, atMs: number | undefined) {
  return atMs === undefined ? timesMs.length - 1 : timesMs.findLastIndex(time => time <= atMs)
}

/** A player's numbers at the `recorded` time, like the game's resource bar shows them. */
export function getResources(
  player: GamePlayerStats,
  timesMs: ReadonlyArray<number>,
  recorded: number,
): PlayerResources | undefined {
  const timeline = player.timeline
  if (!timeline || recorded < 0) {
    return undefined
  }
  // A player who left has numbers only up to when they did, which stay what they were.
  const index = Math.min(recorded, timeline.workers.length - 1)
  const earlier = timesMs.findLastIndex(time => time <= timesMs[index] - INCOME_WINDOW_MS)
  const minutes = earlier >= 0 ? (timesMs[index] - timesMs[earlier]) / 60_000 : 0
  return {
    supplyUsed: timeline.supplyUsed?.[index],
    supplyAvailable: timeline.supplyAvailable?.[index],
    workers: timeline.workers[index],
    bases: timeline.bases?.[index],
    army: timeline.armyScore[index],
    unspent: timeline.unspent?.[index],
    mined: timeline.resourcesMined[index],
    minedPerMinute:
      minutes > 0
        ? (timeline.resourcesMined[index] - timeline.resourcesMined[earlier]) / minutes
        : undefined,
  }
}
