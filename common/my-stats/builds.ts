import { GameStatsResult } from '../games/game-stats'
import {
  ARMY_MIX_MINUTES,
  CHECKPOINT_MINUTES,
  PlayerMetrics,
  STARTING_WORKERS,
  WORKER_IDS,
} from '../games/player-metrics'

/** The fewest games a build needs to be listed, so one odd game doesn't make a build of its own. */
const MIN_BUILD_GAMES = 3
/** The fewest won games the winners' way of playing a build is shown from. */
const MIN_WINNER_GAMES = 5
/** The most builds listed, the most played first. The user's own is listed as well. */
const MAX_BUILDS = 8
/** A step most games of a build take, rather than one some players add. */
const USUAL_STEP_SHARE = 0.5
/** An army unit made this many times a game on average, at some minute, is part of the mix. */
const MIN_ARMY_AVERAGE = 0.5
/** The minutes workers are counted at, each one of `CHECKPOINT_MINUTES`. */
export const WORKER_MINUTES: ReadonlyArray<number> = [4, 6, 8, 10]
/** The fewest team games a pair of builds needs to be listed. */
const MIN_TEAM_BUILD_GAMES = 3
/** The most pairs of builds listed. */
const MAX_TEAM_BUILDS = 8

/** One player's game, as much as a build needs. */
export interface BuildSample {
  player: PlayerMetrics
  /** Who played it, so players can be counted. */
  name: string
  result: GameStatsResult
  /** The game it was played in. */
  gameId: string
  /**
   * The side the player was on in the game, like their team in a team game or the player in a
   * melee game, so teammates on one build count their result once. Without it, each player counts
   * once, unless these samples show different teams in the same game.
   */
  side?: string
  /** Whether the user played in the game, with or against this player. */
  withUser: boolean
  /** Whether the player went out well before a teammate, and so didn't win or lose it alone. */
  carried: boolean
  /** How long the player played. */
  playedMs: number
}

/** A step most games of a build take: the building, unit, tech or upgrade, and when. */
export interface BuildStepSummary {
  /** The build key, see `buildKey`. */
  key: string
  /** Which of these it is, like the second Gateway. */
  nth: number
  timeMs: number
  /** The middle half of the games take it between these times. */
  earlyMs: number
  lateMs: number
  /** Supply in use just before it, in whole units. */
  supply?: number
  /** The share of the games that take this step. */
  share: number
}

/** When players of a build stop making workers, among the games where they do. */
export interface WorkerStopSummary {
  workers: number
  atMs: number
  /** Games where the player stopped before 10 minutes, of {@link games}. */
  stopped: number
  games: number
}

/** How much of one army unit a build makes, on average, by each of `ARMY_MIX_MINUTES`. */
export interface ArmyMixEntry {
  unitId: number
  counts: number[]
}

/**
 * Whether a unit is made enough to be part of a build's army mix. A unit that is, for any side, is
 * worth showing for every side, with whatever that side's average is.
 */
export function isArmyMixUnit(entry: ArmyMixEntry) {
  return Math.max(...entry.counts) >= MIN_ARMY_AVERAGE
}

/** One side of a build, like everyone who plays it, or only the games they won. */
export interface BuildSide {
  /** Players' games: a team with two players of a build counts two. */
  games: number
  /** Wins and losses, each team's counted once. */
  wins: number
  losses: number
  /** Games the user played in, with or against these players. */
  withUser: number
  steps: BuildStepSummary[]
  /** Every worker and army unit most games make, see `usualUnitSteps`. */
  unitSteps: BuildStepSummary[]
  workerStop?: WorkerStopSummary
  /** Workers at each of {@link WORKER_MINUTES}, in a typical game still going by then. */
  workersAt: Array<number | null>
  /** Every army unit made, see {@link isArmyMixUnit} for the ones worth showing. */
  armyMix: ArmyMixEntry[]
}

/** A build players use in these games, with how they play it. */
export interface CoachBuild {
  /** The build family it's named by, see `getBuildFamily`. */
  family: string
  /** Other players who use it. */
  players: number
  others: BuildSide
  /** The games other players won with it, leaving out players their team carried. */
  winners?: BuildSide
  /** The user's games with it. */
  user?: BuildSide
}

/** Two teammates' builds, and how teams that paired them did. */
export interface CoachTeamBuild {
  /**
   * The two builds, see `getBuildFamily`: the one of the race asked about first, and the user's
   * own first when both are of that race and the user played the pair.
   */
  families: [string, string]
  /** Other players' teams, leaving out the user's. */
  games: number
  wins: number
  losses: number
  userGames: number
  userWins: number
  userLosses: number
}

/** One team's game for {@link summarizeTeamBuilds}. */
export interface TeamBuildSample {
  families: [string, string]
  result: GameStatsResult
  user: boolean
}

/** The value a share of these are at or under, between the two nearest when none is exactly. */
function quantile(values: ReadonlyArray<number>, share: number): number {
  const sorted = values.toSorted((a, b) => a - b)
  const at = (sorted.length - 1) * share
  const below = Math.floor(at)
  const above = Math.min(below + 1, sorted.length - 1)
  return sorted[below] + (sorted[above] - sorted[below]) * (at - below)
}

function median(values: ReadonlyArray<number>): number {
  return quantile(values, 0.5)
}

/** A step's typical time, and the times the middle half of the games take it between. */
function timingOf(times: ReadonlyArray<number>) {
  return { timeMs: median(times), earlyMs: quantile(times, 0.25), lateMs: quantile(times, 0.75) }
}

/**
 * The steps most of these games take, each at its typical time and supply, in order of those
 * times. The second of a building always comes after the first, wherever each one's time falls.
 */
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
  const steps = Array.from(byStep.values())
    .filter(entry => entry.times.length >= games.length * USUAL_STEP_SHARE)
    .map(entry => ({
      key: entry.key,
      nth: entry.nth,
      ...timingOf(entry.times),
      supply: entry.supplies.length ? Math.round(median(entry.supplies)) : undefined,
      share: entry.times.length / games.length,
    }))
    .sort((a, b) => a.timeMs - b.timeMs)
  const byKey = new Map<string, BuildStepSummary[]>()
  for (const step of steps.toSorted((a, b) => a.nth - b.nth)) {
    byKey.set(step.key, [...(byKey.get(step.key) ?? []), step])
  }
  return steps.map(step => byKey.get(step.key)!.shift()!)
}

/**
 * Each worker and army unit most of these games make, numbered like the 9th Probe or the 2nd
 * Zealot, at its typical time, in order of those times.
 */
function usualUnitSteps(samples: ReadonlyArray<BuildSample>): BuildStepSummary[] {
  const games = samples.filter(s => s.player.unitTimes)
  const byStep = new Map<string, { key: string; nth: number; times: number[] }>()
  for (const { player } of games) {
    for (const [unitId, times] of Object.entries(player.unitTimes ?? {})) {
      const first = WORKER_IDS.has(Number(unitId)) ? STARTING_WORKERS + 1 : 1
      times.forEach((timeMs, i) => {
        const nth = first + i
        const id = `u${unitId}#${nth}`
        const entry = byStep.get(id) ?? { key: `u${unitId}`, nth, times: [] }
        entry.times.push(timeMs)
        byStep.set(id, entry)
      })
    }
  }
  return Array.from(byStep.values())
    .filter(entry => entry.times.length >= games.length * USUAL_STEP_SHARE)
    .map(entry => ({
      key: entry.key,
      nth: entry.nth,
      ...timingOf(entry.times),
      share: entry.times.length / games.length,
    }))
    .sort((a, b) => a.timeMs - b.timeMs || a.nth - b.nth)
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

function workersAtOf(samples: ReadonlyArray<BuildSample>): Array<number | null> {
  return WORKER_MINUTES.map(minute => {
    const index = CHECKPOINT_MINUTES.indexOf(minute)
    const counts = samples.flatMap(s => {
      const count = s.player.workers[index]
      return count !== null && count !== undefined ? [count] : []
    })
    return counts.length ? Math.round(median(counts)) : null
  })
}

/**
 * Each army unit's average count a game, at each minute, the most made by 10 minutes first. Each
 * minute averages the games still going then, so games over early don't pull it down. Every unit
 * made is listed, so a side can show its real count of a unit another side makes more of.
 */
function armyMixOf(samples: ReadonlyArray<BuildSample>): ArmyMixEntry[] {
  const games = samples.filter(s => s.player.armyMix)
  const playing = ARMY_MIX_MINUTES.map(
    minute => games.filter(s => s.playedMs >= minute * 60_000).length,
  )
  if (!games.length) {
    return []
  }
  const totals = new Map<number, number[]>()
  for (const sample of games) {
    for (const [unitId, counts] of Object.entries(sample.player.armyMix ?? {})) {
      const total = totals.get(Number(unitId)) ?? ARMY_MIX_MINUTES.map(() => 0)
      counts.forEach((count, i) => {
        if (sample.playedMs >= ARMY_MIX_MINUTES[i] * 60_000) {
          total[i] += count
        }
      })
      totals.set(Number(unitId), total)
    }
  }
  return Array.from(totals, ([unitId, total]) => ({
    unitId,
    counts: total.map((count, i) => (playing[i] ? count / playing[i] : 0)),
  })).sort((a, b) => (b.counts.at(-1) ?? 0) - (a.counts.at(-1) ?? 0))
}

/**
 * Wins and losses with each side's result counted once. Samples without a side count by team only
 * when they show different teams in one game, since a melee game puts every player on one team.
 */
function countTeams(samples: ReadonlyArray<BuildSample>) {
  const teamsByGame = new Map<string, Set<number>>()
  for (const s of samples) {
    teamsByGame.set(s.gameId, (teamsByGame.get(s.gameId) ?? new Set()).add(s.player.team))
  }
  const sideOf = (s: BuildSample) => {
    if (s.side !== undefined) {
      return `side:${s.side}`
    }
    return teamsByGame.get(s.gameId)!.size > 1 ? `team:${s.player.team}` : `player:${s.name}`
  }
  const results = new Map<string, GameStatsResult>()
  for (const s of samples) {
    results.set(`${s.gameId}:${sideOf(s)}`, s.result)
  }
  const all = Array.from(results.values())
  return {
    wins: all.filter(result => result === 'win').length,
    losses: all.filter(result => result === 'loss').length,
  }
}

function sideOf(samples: ReadonlyArray<BuildSample>): BuildSide {
  return {
    games: samples.length,
    ...countTeams(samples),
    withUser: samples.filter(s => s.withUser).length,
    steps: usualSteps(samples),
    unitSteps: usualUnitSteps(samples),
    workerStop: workerStopOf(samples),
    workersAt: workersAtOf(samples),
    armyMix: armyMixOf(samples),
  }
}

/**
 * The builds in these games, the most played first: how other players play each, how the ones who
 * won did, and how the user does. The build the user plays most is listed whatever its count.
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
  const listed = Array.from(byFamily)
    .filter(([, games]) => games.pool.length >= MIN_BUILD_GAMES)
    .sort(([, a], [, b]) => b.pool.length - a.pool.length)
    .slice(0, MAX_BUILDS)
  if (
    userFamily &&
    userFamily[1].user.length >= MIN_BUILD_GAMES &&
    !listed.some(([family]) => family === userFamily[0])
  ) {
    listed.push(userFamily)
  }
  return listed.map(([family, games]) => {
    const winners = games.pool.filter(s => s.result === 'win' && !s.carried)
    return {
      family,
      players: new Set(games.pool.map(s => s.name)).size,
      others: sideOf(games.pool),
      winners: winners.length >= MIN_WINNER_GAMES ? sideOf(winners) : undefined,
      user: games.user.length ? sideOf(games.user) : undefined,
    }
  })
}

/**
 * Pairs of teammates' builds, the most played first, with how other players' teams did and how the
 * user's did. Two builds of one race are the same pair in either order.
 */
export function summarizeTeamBuilds(teams: ReadonlyArray<TeamBuildSample>): CoachTeamBuild[] {
  const byPair = new Map<string, CoachTeamBuild>()
  for (const team of teams) {
    const [first, second] = team.families
    const sameRace = first.split(' ')[0] === second.split(' ')[0]
    const families: [string, string] =
      sameRace && second < first ? [second, first] : [first, second]
    const id = families.join('+')
    const pair = byPair.get(id) ?? {
      families,
      games: 0,
      wins: 0,
      losses: 0,
      userGames: 0,
      userWins: 0,
      userLosses: 0,
    }
    if (team.user) {
      if (!pair.userGames) {
        pair.families = team.families
      }
      pair.userGames += 1
      pair.userWins += team.result === 'win' ? 1 : 0
      pair.userLosses += team.result === 'loss' ? 1 : 0
    } else {
      pair.games += 1
      pair.wins += team.result === 'win' ? 1 : 0
      pair.losses += team.result === 'loss' ? 1 : 0
    }
    byPair.set(id, pair)
  }
  return Array.from(byPair.values())
    .filter(pair => pair.games >= MIN_TEAM_BUILD_GAMES || pair.userGames >= MIN_TEAM_BUILD_GAMES)
    .sort((a, b) => b.games - a.games || b.userGames - a.userGames)
    .slice(0, MAX_TEAM_BUILDS)
}
