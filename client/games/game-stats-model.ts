import { TFunction } from 'i18next'
import { getSideResult } from '../../common/games/assumed-results'
import {
  BuildStep,
  BuildStepKind,
  GamePlayerStats,
  GameStatsResult,
  PlayerTimeline,
} from '../../common/games/game-stats'
import { getTechName, getUpgradeName } from '../../common/games/research-types'
import { getUnitTypeInfo } from '../../common/games/unit-types'
import { RaceChar } from '../../common/races'

/** A team, or a single player when the game had no teams. */
export interface Side {
  key: number
  /** Numbered from 1, in the order sides are shown. Only meaningful for real teams. */
  number: number
  isTeam: boolean
  players: GamePlayerStats[]
  result: GameStatsResult
}

const RESULT_ORDER: Record<GameStatsResult, number> = { win: 0, loss: 1, unknown: 2 }

/**
 * Groups players into the sides that played against each other, winners first. Games without teams
 * (like plain melee) give every player the same team, so in those each player is their own side.
 */
export function groupSides(players: ReadonlyArray<GamePlayerStats>): Side[] {
  const hasTeams = new Set(players.map(p => p.team)).size > 1
  const bySide = new Map<number, GamePlayerStats[]>()
  for (const player of players) {
    const key = hasTeams ? player.team : player.id
    bySide.set(key, [...(bySide.get(key) ?? []), player])
  }
  return Array.from(bySide, ([key, sidePlayers]) => ({
    key,
    isTeam: hasTeams,
    players: sidePlayers,
    result: getSideResult(sidePlayers),
  }))
    .sort((a, b) => RESULT_ORDER[a.result] - RESULT_ORDER[b.result] || a.key - b.key)
    .map((side, i): Side => ({ ...side, number: i + 1 }))
}

/**
 * Free for all players in the order they finished: the winner, then whoever stayed in longest. A
 * player still in when the game ended outlasted everyone who left. A player who lost with no time
 * of leaving is the one whose replay stopped when they left: everyone still in outlasted them, and
 * they outlasted everyone who left before them.
 */
export function toFinishingOrder(sides: ReadonlyArray<Side>): Side[] {
  const lastedMs = (side: Side) => {
    if (side.result === 'win') {
      return Infinity
    }
    const leftAtMs = side.players[0]?.leftAtMs
    if (leftAtMs !== undefined) {
      return leftAtMs
    }
    return side.result === 'loss' ? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER
  }
  return sides.toSorted((a, b) => lastedMs(b) - lastedMs(a))
}

/** Each player's team, for players who were on one. */
export function getTeamsByPlayer(sides: ReadonlyArray<Side>): ReadonlyMap<number, Side> {
  return new Map(
    sides.filter(side => side.isTeam).flatMap(side => side.players.map(p => [p.id, side])),
  )
}

function raceLetter(player: GamePlayerStats) {
  return player.race?.toUpperCase() ?? '?'
}

/**
 * The races facing off, in the order the sides are shown: "ZvP" for a 1v1, or "PPZ vs TZP" for
 * team games.
 */
export function getMatchup(sides: ReadonlyArray<Side>, t: TFunction) {
  return sides.every(side => side.players.length === 1)
    ? sides.map(side => raceLetter(side.players[0])).join(t('gameStats.matchupSeparator', 'v'))
    : sides
        .map(side => side.players.map(raceLetter).join(''))
        .join(t('gameStats.teamMatchupSeparator', ' vs '))
}

export interface UnitEntry {
  name: string
  count: number
  race?: RaceChar
  isBuilding: boolean
}

/**
 * Turns unit id counts into named entries, units before buildings and most first. Unit ids that
 * share a name (like the two Siege Tank modes) are combined.
 */
export function toUnitEntries(
  counts: ReadonlyArray<[unitId: number, count: number]>,
  t: TFunction,
): UnitEntry[] {
  const byName = new Map<string, UnitEntry>()
  for (const [unitId, count] of counts) {
    const info = getUnitTypeInfo(unitId, t)
    const existing = byName.get(info.name)
    if (existing) {
      existing.count += count
    } else {
      byName.set(info.name, { ...info, count })
    }
  }
  return Array.from(byName.values()).sort(
    (a, b) => Number(a.isBuilding) - Number(b.isBuilding) || b.count - a.count,
  )
}

/**
 * How fast a running total was going up at each recorded time, per minute, measured over the
 * `windowMs` before it. Totals that grow in bursts, like minerals returned by workers, need a
 * longer window to not jump around. The first time has nothing before it to measure from.
 */
export function getRatePerMinute(
  timesMs: ReadonlyArray<number>,
  totals: ReadonlyArray<number>,
  windowMs: number,
): Array<number | undefined> {
  return totals.map((total, i) => {
    if (i === 0) {
      return undefined
    }
    let from = i - 1
    while (from > 0 && timesMs[i] - timesMs[from - 1] <= windowMs) {
      from -= 1
    }
    const elapsedMs = timesMs[i] - timesMs[from]
    return elapsedMs > 0 ? Math.round(((total - totals[from]) / elapsedMs) * 60_000) : undefined
  })
}

/** The chart data key for a player's values. */
export function playerDataKey(player: GamePlayerStats) {
  return `player${player.id}`
}

/**
 * Turns each player's progress into one row per recorded time, keyed by {@link playerDataKey}. A
 * player who had stopped playing by then has no value in that row.
 */
export function toTimelineRows(
  timesMs: ReadonlyArray<number>,
  players: ReadonlyArray<GamePlayerStats>,
  getValues: (timeline: PlayerTimeline) => ReadonlyArray<number | undefined> | undefined,
): Array<Record<string, number | undefined>> {
  const valuesByPlayer = players.map(
    player =>
      [playerDataKey(player), (player.timeline && getValues(player.timeline)) ?? []] as const,
  )
  return timesMs.map((timeMs, i) => {
    const row: Record<string, number | undefined> = { timeMs }
    for (const [key, values] of valuesByPlayer) {
      row[key] = values[i]
    }
    return row
  })
}

/** How far apart a timeline's marks can be, for games of different lengths. */
const TICK_STEPS_MS = [30, 60, 120, 300, 600, 900, 1200, 1800, 3600].map(s => s * 1000)

/**
 * The times to mark on a timeline that ends at `endMs`: the start, the end, and evenly spaced
 * round times between them, at most `maxTicks` in all. A round time too close to the end to have
 * room for its label gives way to the end.
 */
export function getTimelineTicks(endMs: number, maxTicks = 5): number[] {
  if (endMs <= 0) {
    return [0]
  }
  const step = TICK_STEPS_MS.find(s => endMs / s <= maxTicks - 1) ?? TICK_STEPS_MS.at(-1)!
  const ticks: number[] = []
  for (let ms = 0; ms < endMs - step / 2; ms += step) {
    ticks.push(ms)
  }
  ticks.push(endMs)
  return ticks
}

/** Upgrades below this id have levels, like armor and weapons, so their level is shown. */
const LEVELED_UPGRADES_END = 16

export interface BuildOrderRow {
  timeMs: number
  kind: BuildStepKind
  id: number
  name: string
  supply?: number
  count: number
  cancelled: boolean
  isBuilding: boolean
}

/**
 * Names each step of a build order, at the time it actually started. Workers are left out, since
 * the supply each step was started at already counts them. Units started together, like two
 * Zerglings from one egg, share a step.
 */
export function toBuildOrderRows(steps: ReadonlyArray<BuildStep>, t: TFunction): BuildOrderRow[] {
  const rows: BuildOrderRow[] = []
  for (const step of steps) {
    let name: string
    let isBuilding = false
    if (step.kind === 'unit') {
      const info = getUnitTypeInfo(step.id, t)
      if (info.isWorker) {
        continue
      }
      name = info.name
      isBuilding = info.isBuilding
    } else if (step.kind === 'upgrade') {
      name = getUpgradeName(step.id, t)
      if (step.id < LEVELED_UPGRADES_END && step.level) {
        name = t('gameStats.upgradeLevel', '{{name}} {{level}}', { name, level: step.level })
      }
    } else {
      name = getTechName(step.id, t)
    }

    rows.push({
      timeMs: step.timeMs,
      kind: step.kind,
      id: step.id,
      name,
      supply: step.supply,
      count: step.count,
      cancelled: step.cancelled,
      isBuilding,
    })
  }
  return rows
}

/** A side's combined numbers, for the top of its card. */
export interface SideTotals {
  minerals: number
  gas: number
  /** The most army supply the side had at once, or undefined if the game didn't track it. */
  peakArmySupply?: number
  /** How long the side's players were out of supply, added together. */
  supplyBlockedMs?: number
  /** The average of its players' EAPM. */
  eapm?: number
  /** The average of its players' average unspent resources. */
  averageUnspent?: number
}

function average(values: ReadonlyArray<number | undefined>) {
  const known = values.filter(value => value !== undefined)
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : undefined
}

function sumKnown(values: ReadonlyArray<number | undefined>) {
  const known = values.filter(value => value !== undefined)
  return known.length ? known.reduce((sum, value) => sum + value, 0) : undefined
}

/**
 * Adds up a side's players: minerals, gas and time supply blocked in total, EAPM and unspent
 * resources on average, and the most army supply (supply in use less workers) the side had at
 * any one time.
 */
export function getSideTotals(players: ReadonlyArray<GamePlayerStats>): SideTotals {
  const armyByTime: number[] = []
  let tracksArmy = false
  for (const player of players) {
    const used = player.timeline?.supplyUsed
    // Workers being made take supply too. Stats saved before those were counted only have the
    // finished ones, which counts a few workers in training as army.
    const workers = player.timeline?.workersStarted ?? player.timeline?.workers
    if (!used || !workers) {
      continue
    }
    tracksArmy = true
    used.forEach((supply, i) => {
      armyByTime[i] = (armyByTime[i] ?? 0) + Math.max(0, supply - (workers[i] ?? 0))
    })
  }
  return {
    minerals: players.reduce((sum, p) => sum + p.mineralsMined, 0),
    gas: players.reduce((sum, p) => sum + p.gasMined, 0),
    peakArmySupply: tracksArmy ? Math.max(0, ...armyByTime) : undefined,
    supplyBlockedMs: sumKnown(players.map(p => p.supplyBlockedMs)),
    eapm: average(players.map(p => p.eapm)),
    averageUnspent: average(players.map(p => p.averageUnspent)),
  }
}
