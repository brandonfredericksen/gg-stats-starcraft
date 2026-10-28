import { RaceChar } from '../races'
import { FINGERPRINT_FEATURES, FINGERPRINT_VERSION } from './fingerprint'

/** Races the model has its own averages for. Random players use everyone's. */
type ModelRace = 'p' | 't' | 'z' | 'any'

interface FeatureStats {
  mean: number[]
  std: number[]
}

/**
 * How to weigh fingerprints against each other, learned from many players' games: each race's
 * average and spread of every feature, and how much each feature tells players apart.
 */
export interface FingerprintModel {
  version: typeof FINGERPRINT_VERSION
  byRace: Record<ModelRace, FeatureStats>
  /**
   * Per feature, one over how much it varies between one player's own games, or 0 for features
   * that tell players apart too little to count.
   */
  weights: number[]
}

/** A game's fingerprint, labeled with whose it is. */
export interface LabeledFingerprint {
  /** Whose game it is. Games with the same identity are taken to be one person's. */
  identity: string
  race: RaceChar
  features: ReadonlyArray<number>
}

/** Standardized values further out than this are clamped, so one odd game can't swamp the rest. */
const MAX_Z = 4

/** How many of the features that tell players apart best the model keeps. */
const DEFAULT_KEEP = 200

/**
 * The least a feature is taken to vary within one player's games, in standardized units. A feature
 * that barely varies for anyone, like one that's almost always 0, would otherwise get a weight so
 * big that it alone decides every match. Tuned with `pnpm run fingerprint-eval`.
 */
const MIN_WITHIN_VARIANCE = 0.2

/** Players need this many games to say how much their own games vary. */
const MIN_IDENTITY_GAMES = 3

function toModelRace(race: RaceChar): ModelRace {
  return race === 'r' ? 'any' : race
}

function getStats(samples: ReadonlyArray<ReadonlyArray<number>>, count: number): FeatureStats {
  const mean = new Array<number>(count).fill(0)
  const sq = new Array<number>(count).fill(0)
  const n = new Array<number>(count).fill(0)
  for (const features of samples) {
    for (let i = 0; i < count; i++) {
      const v = features[i]
      if (Number.isFinite(v)) {
        n[i] += 1
        mean[i] += v
        sq[i] += v * v
      }
    }
  }
  const std = new Array<number>(count)
  for (let i = 0; i < count; i++) {
    mean[i] = n[i] ? mean[i] / n[i] : 0
    const variance = n[i] > 1 ? sq[i] / n[i] - mean[i] * mean[i] : 0
    std[i] = Math.sqrt(Math.max(variance, 0)) || 1
  }
  return { mean, std }
}

function standardize(stats: FeatureStats, features: ReadonlyArray<number>): number[] {
  return stats.mean.map((mean, i) => {
    const v = features[i]
    if (!Number.isFinite(v)) {
      return 0
    }
    return Math.max(-MAX_Z, Math.min(MAX_Z, (v - mean) / stats.std[i]))
  })
}

/**
 * Learns a {@link FingerprintModel} from labeled games. Features are kept by how much more they
 * vary between players than within one player's games, and weighed by one over the latter, so
 * habits a player keeps count most.
 */
export function fitFingerprintModel(
  samples: ReadonlyArray<LabeledFingerprint>,
  keep = DEFAULT_KEEP,
): FingerprintModel {
  const count = FINGERPRINT_FEATURES.length
  const all = getStats(
    samples.map(s => s.features),
    count,
  )
  const byRace = { any: all } as Record<ModelRace, FeatureStats>
  for (const race of ['p', 't', 'z'] as const) {
    const ofRace = samples.filter(s => s.race === race)
    byRace[race] =
      ofRace.length >= 50
        ? getStats(
            ofRace.map(s => s.features),
            count,
          )
        : all
  }

  const byIdentity = new Map<string, number[][]>()
  for (const s of samples) {
    const z = standardize(byRace[toModelRace(s.race)], s.features)
    const games = byIdentity.get(s.identity)
    if (games) {
      games.push(z)
    } else {
      byIdentity.set(s.identity, [z])
    }
  }

  const within = new Array<number>(count).fill(0)
  let withinDf = 0
  const means: number[][] = []
  for (const games of byIdentity.values()) {
    if (games.length < MIN_IDENTITY_GAMES) {
      continue
    }
    const mean = new Array<number>(count).fill(0)
    for (const g of games) {
      for (let i = 0; i < count; i++) {
        mean[i] += g[i] / games.length
      }
    }
    for (const g of games) {
      for (let i = 0; i < count; i++) {
        within[i] += (g[i] - mean[i]) ** 2
      }
    }
    withinDf += games.length - 1
    means.push(mean)
  }
  const between = new Array<number>(count).fill(0)
  for (const mean of means) {
    for (let i = 0; i < count; i++) {
      between[i] += mean[i] ** 2 / Math.max(1, means.length - 1)
    }
  }
  const withinVar = within.map(w => Math.max(w / Math.max(1, withinDf), MIN_WITHIN_VARIANCE))
  const ratio = between.map((b, i) => b / withinVar[i])
  const kept = new Set(
    ratio
      .map((r, i) => [r, i] as const)
      .sort((a, b) => b[0] - a[0])
      .slice(0, keep)
      .map(([, i]) => i),
  )
  return {
    version: FINGERPRINT_VERSION,
    byRace,
    weights: withinVar.map((w, i) => (kept.has(i) ? 1 / Math.sqrt(w) : 0)),
  }
}

/** A game's fingerprint in the model's terms: standardized for its race, weighed, kept features. */
export function projectFingerprint(
  model: FingerprintModel,
  race: RaceChar,
  features: ReadonlyArray<number>,
): Float64Array {
  const z = standardize(model.byRace[toModelRace(race)], features)
  const out: number[] = []
  for (let i = 0; i < z.length; i++) {
    if (model.weights[i]) {
      out.push(z[i] * model.weights[i])
    }
  }
  return Float64Array.from(out)
}

/** Everything known about how one identity plays: its games, averaged. */
export interface IdentityPrint {
  identity: string
  games: number
  /** The average of its games, scaled to length 1. */
  unit: Float64Array
}

/** The most games of one identity averaged. More stops making a fingerprint any clearer. */
export const MAX_IDENTITY_GAMES = 60

/** Averages an identity's games, the newest {@link MAX_IDENTITY_GAMES} of them, into one print. */
export function buildIdentityPrint(
  identity: string,
  games: ReadonlyArray<Float64Array>,
): IdentityPrint | undefined {
  if (!games.length) {
    return undefined
  }
  const used = games.slice(-MAX_IDENTITY_GAMES)
  const sum = new Float64Array(used[0].length)
  for (const g of used) {
    for (let i = 0; i < sum.length; i++) {
      sum[i] += g[i]
    }
  }
  let norm = 0
  for (const v of sum) {
    norm += v * v
  }
  norm = Math.sqrt(norm) || 1
  return { identity, games: used.length, unit: sum.map(v => v / norm) }
}

function cosine(a: Float64Array, b: Float64Array) {
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
  }
  return dot
}

/** How alike a print is to the prints of a cohort, as sums to take others out of. */
export interface CohortSums {
  n: number
  sum: number
  sq: number
}

/** How alike `print` is to each print of `cohort` but its own, summed. */
function getCohortSums(print: IdentityPrint, cohort: ReadonlyArray<IdentityPrint>): CohortSums {
  const sums = { n: 0, sum: 0, sq: 0 }
  for (const other of cohort) {
    if (other.identity !== print.identity) {
      const s = cosine(print.unit, other.unit)
      sums.n += 1
      sums.sum += s
      sums.sq += s * s
    }
  }
  return sums
}

/** The mean and spread of `sums`, without the likeness to each of `leftOut`. */
function toCohortStats(
  print: IdentityPrint,
  sums: CohortSums,
  leftOut: ReadonlyArray<IdentityPrint>,
) {
  let { n, sum, sq } = sums
  for (const other of leftOut) {
    if (other.identity !== print.identity) {
      const s = cosine(print.unit, other.unit)
      n -= 1
      sum -= s
      sq -= s * s
    }
  }
  const mean = n ? sum / n : 0
  const std = n > 1 ? Math.sqrt(Math.max(sq / n - mean * mean, 0)) : 1
  return { mean, std: std || 1 }
}

/** A possible other identity of the same person, scored. */
export interface AliasCandidate {
  identity: string
  /**
   * How far above the usual likeness of either print to strangers this pair's is, in standard
   * deviations: about 0 for a stranger, and up from there.
   */
  score: number
  /** The fewer games of the two prints, which bounds how sure the score can be. */
  games: number
}

/**
 * Scores `probe` against every candidate, each likeness measured against how alike either one is to
 * the cohort, so a print that's like everyone doesn't look like a match for anyone. Prints of the
 * probe's own person in the cohort, `leftOut`, aren't strangers, and are left out of it. Best first.
 *
 * `cohortSumsCache` keeps each candidate's sums over the whole cohort, for scoring another probe
 * against the same cohort.
 */
export function scoreAliases(
  probe: IdentityPrint,
  candidates: ReadonlyArray<IdentityPrint>,
  cohort: ReadonlyArray<IdentityPrint>,
  {
    leftOut = [],
    cohortSumsCache,
  }: {
    leftOut?: ReadonlyArray<IdentityPrint>
    cohortSumsCache?: Map<string, CohortSums>
  } = {},
): AliasCandidate[] {
  const probeStats = toCohortStats(probe, getCohortSums(probe, cohort), leftOut)
  return candidates
    .filter(c => c.identity !== probe.identity)
    .map(candidate => {
      let sums = cohortSumsCache?.get(candidate.identity)
      if (!sums) {
        sums = getCohortSums(candidate, cohort)
        cohortSumsCache?.set(candidate.identity, sums)
      }
      const stats = toCohortStats(candidate, sums, leftOut)
      const s = cosine(probe.unit, candidate.unit)
      const score = ((s - probeStats.mean) / probeStats.std + (s - stats.mean) / stats.std) / 2
      return { identity: candidate.identity, score, games: Math.min(probe.games, candidate.games) }
    })
    .sort((a, b) => b.score - a.score)
}

/** How sure a score says two names are one person. */
export type AliasConfidence = 'strong' | 'likely' | 'possible'

/**
 * The least score for each confidence, from scoring about 1,100 ladder and ShieldBattery players
 * against each other with `pnpm run fingerprint-eval`. Strangers scored as high as possible about
 * once in 10,000 comparisons of one game each and once in 1,000 of three or more, as high as likely
 * about once in 10,000 at most, and as high as strong twice in over a million. Many of those
 * strangers look like real smurfs, so it's likely rarer still. A player's page compares one player
 * to every name in the library, so anything lower would turn up a stranger on most pages.
 */
const CONFIDENCE_SCORES: ReadonlyArray<readonly [AliasConfidence, number]> = [
  ['strong', 6.5],
  ['likely', 5.75],
  ['possible', 5],
]

/** How sure `score` says a match is, if it says one is at all. */
export function getAliasConfidence(score: number): AliasConfidence | undefined {
  return CONFIDENCE_SCORES.find(([, least]) => score >= least)?.[0]
}
