import { LADDER_RANKS, LadderRank } from '../games/ladder'
import { GameMetrics, PlayerMetrics } from '../games/player-metrics'
import { AssignedRaceChar } from '../races'
import { makeScriptedCheck, splitsByMap } from './player-games'

/**
 * eSkill estimates a player's 1v1 ladder MMR from how they played one game: how fast their hands
 * were, how they used hotkeys and how they spent their money. It's fit to the ladder players the
 * app ships, whose MMR is known, and goes by nothing an opponent decides for them, like what they
 * killed or how much they mined.
 *
 * Each number is first ranked against players of the same race in the same kind of game, so a Zerg
 * isn't scored up for the actions larvae take, and a bank in a 3v3 on Big Game Hunters is judged
 * against other banks there. Those ranks are what the model weighs, one model per race, so every
 * game type ends up on the 1v1 ladder's scale.
 */

/** Players who stopped before this haven't played enough of a game to be scored. */
export const ESKILL_MIN_PLAYED_MS = 6 * 60_000
/**
 * How many of a player's latest games their eSkill is averaged over. One game is a rough read,
 * within about 220 MMR of the ladder's on average, and an average of several a much closer one.
 */
export const ESKILL_AVERAGE_GAMES = 20

/** What a part of eSkill measures. */
export type ESkillPart = 'speed' | 'hands' | 'macro'
export const ESKILL_PARTS: ReadonlyArray<ESkillPart> = ['speed', 'hands', 'macro']

interface Feature {
  part: ESkillPart
  get: (p: PlayerMetrics) => number | null | undefined
}

/**
 * The numbers eSkill weighs. Time out of supply isn't one: it counts being at the cap with nothing
 * to build or no money to build it, so it says little about a player. Neither is anything an
 * opponent shapes, like workers, income or army killed.
 */
const FEATURES: ReadonlyArray<Feature> = [
  { part: 'speed', get: p => p.eapm },
  ...[0, 1, 2].map(i => ({
    part: 'speed' as const,
    get: (p: PlayerMetrics) => p.eapmByPhase?.[i],
  })),
  ...[0, 1, 2].map(i => ({
    part: 'hands' as const,
    get: (p: PlayerMetrics) => p.hotkeyRecallsPerMin?.[i],
  })),
  ...[1, 2].map(i => ({
    part: 'hands' as const,
    get: (p: PlayerMetrics) => p.hotkeyJumpsPerMin?.[i],
  })),
  { part: 'hands', get: p => p.groupsUsed },
  ...[0, 1, 2].map(i => ({ part: 'macro' as const, get: (p: PlayerMetrics) => p.bank[i] })),
  { part: 'macro', get: p => p.workerProduction8 },
  { part: 'macro', get: p => p.larvaeFull10 },
  ...[1, 2].map(i => ({
    part: 'macro' as const,
    get: (p: PlayerMetrics) => p.armyMadePerMin?.[i],
  })),
]

/** How many players a kind of game needs for its numbers to be ranked against its own. */
const MIN_GROUP_PLAYERS = 100
/** How many ranked players of a race it takes to fit a model for it. */
const MIN_TRAINING_PLAYERS = 200
/** How many players of a rank it takes to say where the rank starts. */
const MIN_RANK_PLAYERS = 10
/** How hard the fit pulls each weight toward 0, so weights of numbers that say little stay small. */
const RIDGE = 50

interface RaceModel {
  /** The weight of each of {@link FEATURES}, then the intercept. */
  weights: number[]
  /** Every training player's score before calibration, in order. */
  rawScores: number[]
  /** Every training player's MMR, in order. */
  mmrs: number[]
  /** Every training player's score from each part alone, in order. */
  partScores: Record<ESkillPart, number[]>
}

export interface ESkillModel {
  /**
   * Each of {@link FEATURES}' values for players of a race in a kind of game, in order, keyed by
   * {@link groupKey}.
   */
  groups: Map<string, Array<number[]>>
  races: Partial<Record<AssignedRaceChar, RaceModel>>
  /** The lowest MMR of each rank, from the middle between its players and the rank below's. */
  rankStarts: Array<{ rank: LadderRank; mmr: number }>
  /** How many players the model was fit to. */
  players: number
}

/** A player's eSkill in one game. */
export interface ESkill {
  /** The estimated 1v1 ladder MMR. */
  value: number
  rank?: LadderRank
  /**
   * How each part compares with ladder players of the same race, from 0 to 100. Missing for a part
   * the game didn't measure, which then counts as the middle in {@link value}.
   */
  parts: Partial<Record<ESkillPart, number>>
}

function groupKey(game: GameMetrics, race: AssignedRaceChar, withMap: boolean) {
  return `${game.shape}:${withMap && splitsByMap(game.shape) ? game.mapFamily : ''}:${race}`
}

function playedMs(game: GameMetrics, player: PlayerMetrics) {
  return Math.min(player.leftAtMs ?? game.durationMs, game.durationMs)
}

function isScorable(game: GameMetrics, player: PlayerMetrics) {
  return (
    player.human &&
    !!player.race &&
    !!player.eapm &&
    playedMs(game, player) >= ESKILL_MIN_PLAYED_MS &&
    game.players.every(p => p.human)
  )
}

/** The inverse of the standard normal distribution, by Acklam's approximation. */
function probit(p: number): number {
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ]
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ]
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const low = 0.02425
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    )
  }
  if (p > 1 - low) {
    return -probit(1 - p)
  }
  const q = p - 0.5
  const r = q * q
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  )
}

/** The index of the first of `sorted` that's at least `value`, or past `inclusive` ones equal to it. */
function bound(sorted: ReadonlyArray<number>, value: number, inclusive: boolean) {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < value || (inclusive && sorted[mid] === value)) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

/** Where `value` falls among `sorted`, from 0 to 1, ties counting as halfway through them. */
function percentileOf(sorted: ReadonlyArray<number>, value: number) {
  const middle = (bound(sorted, value, false) + bound(sorted, value, true)) / 2
  return (middle + 0.5) / (sorted.length + 1)
}

/** The value `share` of the way through `sorted`, between its values. */
function quantile(sorted: ReadonlyArray<number>, share: number) {
  const at = Math.min(Math.max(share * (sorted.length - 1), 0), sorted.length - 1)
  const below = Math.floor(at)
  const above = Math.min(below + 1, sorted.length - 1)
  return sorted[below] + (sorted[above] - sorted[below]) * (at - below)
}

/**
 * How a player's numbers rank against players of their race in the same kind of game, as normal
 * scores: 0 for the middle, -1 and 1 for about a sixth of the way from either end. A number the
 * player has no value for counts as the middle.
 */
function normalScores(
  model: Pick<ESkillModel, 'groups'>,
  game: GameMetrics,
  player: PlayerMetrics,
) {
  const race = player.race!
  const group =
    model.groups.get(groupKey(game, race, true)) ??
    model.groups.get(groupKey(game, race, false)) ??
    model.groups.get(`1v1::${race}`)
  return FEATURES.map((feature, i) => {
    const value = feature.get(player)
    const sorted = group?.[i]
    return value === null || value === undefined || !Number.isFinite(value) || !sorted?.length
      ? 0
      : probit(percentileOf(sorted, value))
  })
}

function buildGroups(games: ReadonlyArray<GameMetrics>, isScripted: (p: PlayerMetrics) => boolean) {
  const values = new Map<string, Array<number[]>>()
  const add = (key: string, player: PlayerMetrics) => {
    let group = values.get(key)
    if (!group) {
      group = FEATURES.map(() => [])
      values.set(key, group)
    }
    FEATURES.forEach((feature, i) => {
      const value = feature.get(player)
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        group[i].push(value)
      }
    })
  }
  const counts = new Map<string, number>()
  for (const game of games) {
    for (const p of game.players) {
      if (!isScorable(game, p) || isScripted(p)) {
        continue
      }
      for (const key of new Set([groupKey(game, p.race!, true), groupKey(game, p.race!, false)])) {
        add(key, p)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  const groups = new Map<string, Array<number[]>>()
  for (const [key, group] of values) {
    if ((counts.get(key) ?? 0) >= MIN_GROUP_PLAYERS) {
      groups.set(
        key,
        group.map(list => list.sort((a, b) => a - b)),
      )
    }
  }
  return groups
}

/** Solves `a x = b` for a small square `a`, by Gaussian elimination. */
function solve(a: number[][], b: number[]) {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) {
        pivot = row
      }
    }
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    if (m[col][col] === 0) {
      continue
    }
    for (let row = 0; row < n; row++) {
      if (row !== col) {
        const factor = m[row][col] / m[col][col]
        for (let k = col; k <= n; k++) {
          m[row][k] -= factor * m[col][k]
        }
      }
    }
  }
  return m.map((row, i) => (row[i] === 0 ? 0 : row[n] / row[i]))
}

/** Ridge regression of `ys` on `xs`, with an intercept that isn't pulled toward 0. */
function fitRidge(xs: ReadonlyArray<number[]>, ys: ReadonlyArray<number>) {
  const p = FEATURES.length + 1
  const a = Array.from({ length: p }, () => Array<number>(p).fill(0))
  const b = Array<number>(p).fill(0)
  xs.forEach((x, i) => {
    const row = [...x, 1]
    for (let j = 0; j < p; j++) {
      b[j] += row[j] * ys[i]
      for (let k = 0; k < p; k++) {
        a[j][k] += row[j] * row[k]
      }
    }
  })
  for (let j = 0; j < p - 1; j++) {
    a[j][j] += RIDGE
  }
  return solve(a, b)
}

function partScore(
  weights: ReadonlyArray<number>,
  scores: ReadonlyArray<number>,
  part: ESkillPart,
) {
  return FEATURES.reduce((sum, f, i) => (f.part === part ? sum + weights[i] * scores[i] : sum), 0)
}

function rawScore(weights: ReadonlyArray<number>, scores: ReadonlyArray<number>) {
  return scores.reduce((sum, score, i) => sum + weights[i] * score, weights[FEATURES.length])
}

function getRankStarts(players: ReadonlyArray<PlayerMetrics>): ESkillModel['rankStarts'] {
  const medians = LADDER_RANKS.flatMap(rank => {
    const mmrs = players
      .filter(p => p.rank === rank)
      .map(p => p.mmr!)
      .sort((a, b) => a - b)
    return mmrs.length >= MIN_RANK_PLAYERS ? [{ rank, median: quantile(mmrs, 0.5) }] : []
  })
  return medians.map(({ rank, median }, i) => ({
    rank,
    mmr: i === 0 ? -Infinity : Math.round((medians[i - 1].median + median) / 2),
  }))
}

/**
 * Fits eSkill to `games`: every kind of game's numbers to rank players against, and for each race,
 * how those ranks weigh up to the MMR of the 1v1 ladder players among them. Undefined without
 * enough ranked players of any race.
 */
export function fitESkillModel(games: ReadonlyArray<GameMetrics>): ESkillModel | undefined {
  const isScripted = makeScriptedCheck(games)
  const groups = buildGroups(games, isScripted)
  const training = games.flatMap(game =>
    game.shape === '1v1'
      ? game.players
          .filter(p => p.mmr !== undefined && isScorable(game, p) && !isScripted(p))
          .map(player => ({ player, scores: normalScores({ groups }, game, player) }))
      : [],
  )
  const races: ESkillModel['races'] = {}
  for (const race of ['p', 't', 'z'] as const) {
    const players = training.filter(t => t.player.race === race)
    if (players.length < MIN_TRAINING_PLAYERS) {
      continue
    }
    const weights = fitRidge(
      players.map(t => t.scores),
      players.map(t => t.player.mmr!),
    )
    const sortedScores = (score: (scores: number[]) => number) =>
      players.map(t => score(t.scores)).sort((a, b) => a - b)
    races[race] = {
      weights,
      rawScores: sortedScores(scores => rawScore(weights, scores)),
      mmrs: players.map(t => t.player.mmr!).sort((a, b) => a - b),
      partScores: Object.fromEntries(
        ESKILL_PARTS.map(part => [part, sortedScores(scores => partScore(weights, scores, part))]),
      ) as Record<ESkillPart, number[]>,
    }
  }
  if (!Object.keys(races).length) {
    return undefined
  }
  return {
    groups,
    races,
    rankStarts: getRankStarts(training.map(t => t.player)),
    players: training.length,
  }
}

/** The ladder rank an eSkill falls in. */
export function getESkillRank(model: ESkillModel, value: number): LadderRank | undefined {
  return model.rankStarts.findLast(start => value >= start.mmr)?.rank
}

/**
 * A player's eSkill in a game, if they played long enough to score. The model's estimate is spread
 * out to match the ladder: a player whose estimate beats 90% of ladder players of their race gets
 * the MMR that 90% of them are under, so the best and worst aren't pulled toward the middle.
 */
export function getESkill(
  model: ESkillModel,
  game: GameMetrics,
  player: PlayerMetrics,
): ESkill | undefined {
  const raceModel = player.race ? model.races[player.race] : undefined
  if (!raceModel || !isScorable(game, player)) {
    return undefined
  }
  const scores = normalScores(model, game, player)
  const raw = rawScore(raceModel.weights, scores)
  const value = Math.round(quantile(raceModel.mmrs, percentileOf(raceModel.rawScores, raw)))
  return {
    value,
    rank: getESkillRank(model, value),
    parts: Object.fromEntries(
      ESKILL_PARTS.filter(part => hasPart(player, part)).map(part => [
        part,
        Math.round(
          100 *
            percentileOf(raceModel.partScores[part], partScore(raceModel.weights, scores, part)),
        ),
      ]),
    ),
  }
}

/**
 * Whether the game measured any of a part for the player. Hotkeys come from the replay's commands,
 * which stats saved without a replay don't have.
 */
function hasPart(player: PlayerMetrics, part: ESkillPart) {
  return FEATURES.some(feature => {
    const value = feature.part === part ? feature.get(player) : undefined
    return value !== null && value !== undefined && Number.isFinite(value)
  })
}
