import { FINGERPRINT_VERSION } from '../../common/games/fingerprint'
import {
  buildIdentityPrint,
  CohortSums,
  FingerprintModel,
  getAliasConfidence,
  IdentityPrint,
  projectFingerprint,
  scoreAliases,
} from '../../common/games/fingerprint-match'
import modelData from '../../common/games/fingerprint-model.json'
import { RaceChar } from '../../common/races'
import { PlayerAlias, PlayerAliases } from '../../common/replays-library'
import { StoredFingerprint } from './replay-db'

const MODEL = modelData as unknown as FingerprintModel

/**
 * How many prints each likeness is measured against, to say how alike a print is to strangers.
 * More barely changes that, and each costs a comparison per name in the library.
 */
const MAX_COHORT = 400

/** The most aliases a player's page lists. */
const MAX_ALIASES = 5

/** A name playing one race, which is what a fingerprint is of: hotkeys differ race to race. */
interface Identity {
  print: IdentityPrint
  nameKey: string
  /** The name as it was last seen. */
  name: string
  race: RaceChar
  /** Projected games, the oldest first. */
  games: Float64Array[]
}

interface FinderState {
  identities: Identity[]
  /** For each name, the names it's played in a game with, who can't be the same person. */
  together: Map<string, Set<string>>
  cohort: Identity[]
  cohortSums: Map<string, CohortSums>
}

/** The data the finder works from, read from the replay index. */
export interface AliasFinderSource {
  getFingerprints(version: number): StoredFingerprint[]
  getFingerprintedPlayerNames(version: number): Map<number, string[]>
  countUnfingerprinted(version: number): number
}

/**
 * Finds the other names a player may play under, by comparing how they play to how everyone in the
 * replay library plays. What it learns from the library is kept until {@link invalidate}.
 */
export class AliasFinder {
  private state: FinderState | undefined

  constructor(private readonly source: AliasFinderSource) {}

  /** Forgets what was read from the library, like after more replays have fingerprints. */
  invalidate() {
    this.state = undefined
  }

  private getState(): FinderState {
    if (this.state) {
      return this.state
    }
    const byIdentity = new Map<string, Omit<Identity, 'print'>>()
    for (const row of this.source.getFingerprints(FINGERPRINT_VERSION)) {
      const key = `${row.nameKey}|${row.race}`
      const projected = projectFingerprint(MODEL, row.race, Array.from(row.features))
      const identity = byIdentity.get(key)
      if (identity) {
        identity.games.push(projected)
        identity.name = row.name
      } else {
        byIdentity.set(key, {
          nameKey: row.nameKey,
          name: row.name,
          race: row.race,
          games: [projected],
        })
      }
    }
    const identities: Identity[] = Array.from(byIdentity, ([key, identity]) => ({
      ...identity,
      print: buildIdentityPrint(key, identity.games)!,
    }))

    const together = new Map<string, Set<string>>()
    for (const names of this.source.getFingerprintedPlayerNames(FINGERPRINT_VERSION).values()) {
      for (const name of names) {
        let others = together.get(name)
        if (!others) {
          others = new Set()
          together.set(name, others)
        }
        for (const other of names) {
          if (other !== name) {
            others.add(other)
          }
        }
      }
    }

    // Spread evenly over the library rather than picked at random, so a page scores the same every
    // time it's opened.
    const step = Math.max(1, identities.length / MAX_COHORT)
    const cohort: Identity[] = []
    for (let i = 0; i < identities.length && cohort.length < MAX_COHORT; i += step) {
      cohort.push(identities[Math.floor(i)])
    }

    this.state = { identities, together, cohort, cohortSums: new Map() }
    return this.state
  }

  /**
   * The names that play most like the player who plays as `names`, leaving out `excludeNames` and
   * anyone who played in a game with them. Each race the player plays is compared with the same
   * race only.
   */
  find(names: ReadonlyArray<string>, excludeNames: ReadonlyArray<string>): PlayerAliases {
    const pendingReplays = this.source.countUnfingerprinted(FINGERPRINT_VERSION)
    const keys = new Set(names.map(n => n.toLowerCase()))
    const { identities, together, cohort, cohortSums } = this.getState()
    const own = identities.filter(i => keys.has(i.nameKey))
    const games = own.reduce((sum, i) => sum + i.games.length, 0)
    if (!own.length || cohort.length < 2) {
      return { aliases: [], games, pendingReplays }
    }

    const ruledOut = new Set([...keys, ...excludeNames.map(n => n.toLowerCase())])
    for (const key of keys) {
      for (const other of together.get(key) ?? []) {
        ruledOut.add(other)
      }
    }
    const cohortPrints = cohort.map(i => i.print)
    const leftOut = cohort.filter(i => keys.has(i.nameKey)).map(i => i.print)

    const best = new Map<string, PlayerAlias>()
    for (const race of new Set(own.map(i => i.race))) {
      // Every one of the player's names counts as theirs, so their games are one print.
      const probe = buildIdentityPrint(
        `|${race}`,
        own.filter(i => i.race === race).flatMap(i => i.games),
      )!
      const candidates = identities.filter(i => i.race === race && !ruledOut.has(i.nameKey))
      const byKey = new Map(candidates.map(c => [c.print.identity, c]))
      for (const scored of scoreAliases(
        probe,
        candidates.map(c => c.print),
        cohortPrints,
        { leftOut, cohortSumsCache: cohortSums },
      )) {
        const confidence = getAliasConfidence(scored.score)
        if (!confidence) {
          break
        }
        const candidate = byKey.get(scored.identity)!
        const before = best.get(candidate.nameKey)
        if (!before || before.score < scored.score) {
          best.set(candidate.nameKey, {
            name: candidate.name,
            race,
            confidence,
            score: scored.score,
            games: candidate.print.games,
          })
        }
      }
    }

    return {
      aliases: Array.from(best.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_ALIASES),
      games,
      pendingReplays,
    }
  }
}
