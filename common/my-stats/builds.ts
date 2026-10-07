import { GameStatsResult } from '../games/game-stats'
import { ARMY_MIX_MINUTES, PlayerMetrics } from '../games/player-metrics'

/** The fewest games a build needs to be listed, so one odd game doesn't make a build of its own. */
const MIN_BUILD_GAMES = 3
/** The most builds listed, the most played first. */
const MAX_BUILDS = 8
/** A step most games of a build take, rather than one some players add. */
const USUAL_STEP_SHARE = 0.5
/** An army unit made this many times a game on average, by 10 minutes, is part of the mix. */
const MIN_ARMY_AVERAGE = 0.5

/** One player's game, as much as a build needs. */
export interface BuildSample {
  player: PlayerMetrics
  /** Who played it, so players can be counted. */
  name: string
  result: GameStatsResult
}

/** A step most games of a build take: the building, tech or upgrade, and when. */
export interface BuildStepSummary {
  /** The build key, see `buildKey`. */
  key: string
  /** Which of these it is, like the second Gateway. */
  nth: number
  timeMs: number
  /** Supply in use just before it, in whole units. */
  supply?: number
  /** The share of the games that take this step. */
  share: number
}

/** When players of a build stop making workers, among the games where they do. */
export interface WorkerStopSummary {
  workers: number
  atMs: number
  /** Games where the player stopped before 12 minutes, of {@link games}. */
  stopped: number
  games: number
}

/** How much of one army unit a build makes, on average, by each of `ARMY_MIX_MINUTES`. */
export interface ArmyMixEntry {
  unitId: number
  counts: number[]
}

/** One side of a build, like everyone who plays it, or only the games they won. */
export interface BuildSide {
  games: number
  wins: number
  losses: number
  steps: BuildStepSummary[]
  workerStop?: WorkerStopSummary
  armyMix: ArmyMixEntry[]
}

/** A build players use in these games, with how they play it. */
export interface CoachBuild {
  /** The opening family it's named by, see `openingFamily`. */
  family: string
  /** Other players who use it. */
  players: number
  others: BuildSide
  /** The games other players won with it. */
  winners?: BuildSide
  /** The user's games with it. */
  user?: BuildSide
}

function median(values: ReadonlyArray<number>): number {
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The steps most of these games take, each at its typical time and supply, in that order. */
function usualSteps(samples: ReadonlyArray<BuildSample>): BuildStepSummary[] {
  const games = samples.filter(s => s.player.buildSteps)
  const byStep = new Map<
    string,
    { key: string; nth: number; times: number[]; supplies: number[] }
  >()
  for (const { player } of games) {
    const seen = new Map<string, number>()
    for (const step of player.buildSteps ?? []) {
      const nth = (seen.get(step.key) ?? 0) + 1
      seen.set(step.key, nth)
      const id = `${step.key}#${nth}`
      const entry = byStep.get(id) ?? { key: step.key, nth, times: [], supplies: [] }
      entry.times.push(step.timeMs)
      if (step.supply !== undefined) {
        entry.supplies.push(step.supply)
      }
      byStep.set(id, entry)
    }
  }
  return Array.from(byStep.values())
    .filter(entry => entry.times.length >= games.length * USUAL_STEP_SHARE)
    .map(entry => ({
      key: entry.key,
      nth: entry.nth,
      timeMs: median(entry.times),
      supply: entry.supplies.length ? Math.round(median(entry.supplies)) : undefined,
      share: entry.times.length / games.length,
    }))
    .sort((a, b) => a.timeMs - b.timeMs)
}

function workerStopOf(samples: ReadonlyArray<BuildSample>): WorkerStopSummary | undefined {
  const known = samples.filter(s => s.player.workerStop !== undefined)
  const stops = known.flatMap(s => (s.player.workerStop ? [s.player.workerStop] : []))
  if (!known.length) {
    return undefined
  }
  return {
    // With no game stopping early, there's no stop to describe, only that they kept going.
    workers: stops.length ? Math.round(median(stops.map(stop => stop.workers))) : 0,
    atMs: stops.length ? median(stops.map(stop => stop.atMs)) : 0,
    stopped: stops.length,
    games: known.length,
  }
}

/** Each army unit's average count a game, at each minute, the most made by 10 minutes first. */
function armyMixOf(samples: ReadonlyArray<BuildSample>): ArmyMixEntry[] {
  const games = samples.filter(s => s.player.armyMix)
  if (!games.length) {
    return []
  }
  const totals = new Map<number, number[]>()
  for (const { player } of games) {
    for (const [unitId, counts] of Object.entries(player.armyMix ?? {})) {
      const total = totals.get(Number(unitId)) ?? ARMY_MIX_MINUTES.map(() => 0)
      counts.forEach((count, i) => {
        total[i] += count
      })
      totals.set(Number(unitId), total)
    }
  }
  return Array.from(totals, ([unitId, total]) => ({
    unitId,
    counts: total.map(count => count / games.length),
  }))
    .filter(entry => (entry.counts.at(-1) ?? 0) >= MIN_ARMY_AVERAGE)
    .sort((a, b) => (b.counts.at(-1) ?? 0) - (a.counts.at(-1) ?? 0))
}

function sideOf(samples: ReadonlyArray<BuildSample>): BuildSide {
  return {
    games: samples.length,
    wins: samples.filter(s => s.result === 'win').length,
    losses: samples.filter(s => s.result === 'loss').length,
    steps: usualSteps(samples),
    workerStop: workerStopOf(samples),
    armyMix: armyMixOf(samples),
  }
}

/**
 * The builds in these games, the most played first: how other players play each, how the ones who
 * won did, and how the user does. The user's own build is listed whatever its count.
 */
export function summarizeBuilds(
  user: ReadonlyArray<BuildSample>,
  pool: ReadonlyArray<BuildSample>,
  familyOf: (player: PlayerMetrics) => string | undefined,
): CoachBuild[] {
  const byFamily = new Map<string, { user: BuildSample[]; pool: BuildSample[] }>()
  const add = (sample: BuildSample, side: 'user' | 'pool') => {
    const family = familyOf(sample.player)
    if (!family) {
      return
    }
    const entry = byFamily.get(family) ?? { user: [], pool: [] }
    entry[side].push(sample)
    byFamily.set(family, entry)
  }
  user.forEach(s => add(s, 'user'))
  pool.forEach(s => add(s, 'pool'))

  const userFamily = Array.from(byFamily).sort(([, a], [, b]) => b.user.length - a.user.length)[0]
  return Array.from(byFamily)
    .filter(
      ([family, games]) =>
        games.pool.length >= MIN_BUILD_GAMES ||
        (family === userFamily?.[0] && games.user.length >= MIN_BUILD_GAMES),
    )
    .sort(([, a], [, b]) => b.pool.length - a.pool.length)
    .slice(0, MAX_BUILDS)
    .map(([family, games]) => {
      const winners = games.pool.filter(s => s.result === 'win')
      return {
        family,
        players: new Set(games.pool.map(s => s.name)).size,
        others: sideOf(games.pool),
        winners: winners.length >= MIN_BUILD_GAMES ? sideOf(winners) : undefined,
        user: games.user.length ? sideOf(games.user) : undefined,
      }
    })
}
