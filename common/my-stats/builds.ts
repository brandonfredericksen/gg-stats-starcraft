import { GameStatsResult } from '../games/game-stats'
import { ARMY_MIX_MINUTES, CHECKPOINT_MINUTES, PlayerMetrics } from '../games/player-metrics'

/** The fewest games a build needs to be listed, so one odd game doesn't make a build of its own. */
const MIN_BUILD_GAMES = 3
/** The fewest won games the winners' way of playing a build is shown from. */
const MIN_WINNER_GAMES = 5
/** The most builds listed, the most played first. The user's own is listed as well. */
const MAX_BUILDS = 8
/** A step most games of a build take, rather than one some players add. */
const USUAL_STEP_SHARE = 0.5
/** An army unit made this many times a game on average, by 10 minutes, is part of the mix. */
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
  /** The game and team it was played in, so teammates on one build count their result once. */
  gameId: string
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
  workerStop?: WorkerStopSummary
  /** Workers at each of {@link WORKER_MINUTES}, in a typical game still going by then. */
  workersAt: Array<number | null>
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
  /** The two builds, see `getBuildFamily`: the one of the race asked about first. */
  families: [string, string]
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

function median(values: ReadonlyArray<number>): number {
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * The steps most of these games take, each at its typical time and supply. They're in the order
 * players usually take them, by where each comes in its game's build, since each step's time is
 * from a different set of games and times alone can put them out of order.
 */
function usualSteps(samples: ReadonlyArray<BuildSample>): BuildStepSummary[] {
  const games = samples.filter(s => s.player.buildSteps)
  const byStep = new Map<
    string,
    { key: string; nth: number; times: number[]; supplies: number[]; places: number[] }
  >()
  for (const { player } of games) {
    const seen = new Map<string, number>()
    const steps = player.buildSteps ?? []
    steps.forEach((step, i) => {
      const nth = (seen.get(step.key) ?? 0) + 1
      seen.set(step.key, nth)
      const id = `${step.key}#${nth}`
      const entry = byStep.get(id) ?? { key: step.key, nth, times: [], supplies: [], places: [] }
      entry.times.push(step.timeMs)
      entry.places.push(i)
      if (step.supply !== undefined) {
        entry.supplies.push(step.supply)
      }
      byStep.set(id, entry)
    })
  }
  const steps = Array.from(byStep.values())
    .filter(entry => entry.times.length >= games.length * USUAL_STEP_SHARE)
    .map(entry => ({
      key: entry.key,
      nth: entry.nth,
      timeMs: median(entry.times),
      supply: entry.supplies.length ? Math.round(median(entry.supplies)) : undefined,
      share: entry.times.length / games.length,
      place: median(entry.places),
    }))
    .sort((a, b) => a.place - b.place || a.timeMs - b.timeMs)
  // The second Gateway always comes after the first, wherever each usually falls.
  const byKey = new Map<string, BuildStepSummary[]>()
  for (const { place: _, ...step } of steps.toSorted((a, b) => a.nth - b.nth)) {
    byKey.set(step.key, [...(byKey.get(step.key) ?? []), step])
  }
  return steps.map(step => byKey.get(step.key)!.shift()!)
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
 * minute averages the games still going then, so games over early don't pull it down.
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
  }))
    .filter(entry => Math.max(...entry.counts) >= MIN_ARMY_AVERAGE)
    .sort((a, b) => (b.counts.at(-1) ?? 0) - (a.counts.at(-1) ?? 0))
}

/** Wins and losses with each team's result counted once. */
function countTeams(samples: ReadonlyArray<BuildSample>) {
  const results = new Map<string, GameStatsResult>()
  for (const s of samples) {
    results.set(`${s.gameId}:${s.player.team}`, s.result)
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

/** Pairs of teammates' builds, the most played first, with how those teams did. */
export function summarizeTeamBuilds(teams: ReadonlyArray<TeamBuildSample>): CoachTeamBuild[] {
  const byPair = new Map<string, CoachTeamBuild>()
  for (const team of teams) {
    const id = team.families.join('+')
    const pair = byPair.get(id) ?? {
      families: team.families,
      games: 0,
      wins: 0,
      losses: 0,
      userGames: 0,
      userWins: 0,
      userLosses: 0,
    }
    pair.games += 1
    pair.wins += team.result === 'win' ? 1 : 0
    pair.losses += team.result === 'loss' ? 1 : 0
    if (team.user) {
      pair.userGames += 1
      pair.userWins += team.result === 'win' ? 1 : 0
      pair.userLosses += team.result === 'loss' ? 1 : 0
    }
    byPair.set(id, pair)
  }
  return Array.from(byPair.values())
    .filter(pair => pair.games >= MIN_TEAM_BUILD_GAMES)
    .sort((a, b) => b.games - a.games)
    .slice(0, MAX_TEAM_BUILDS)
}
