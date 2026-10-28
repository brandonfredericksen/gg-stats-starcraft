import { describe, expect, test } from 'vitest'
import { FINGERPRINT_FEATURES } from './fingerprint'
import {
  buildIdentityPrint,
  fitFingerprintModel,
  getAliasConfidence,
  LabeledFingerprint,
  MAX_IDENTITY_GAMES,
  projectFingerprint,
  scoreAliases,
} from './fingerprint-match'

/** A repeatable stream of numbers in [0, 1). */
function random(seed: number) {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31
    return state / 2 ** 31
  }
}

/** Games of `players` people, each with habits of their own and some noise game to game. */
function makeGames(players: number, gamesEach: number, seed = 1): LabeledFingerprint[] {
  const next = random(seed)
  const habits = Array.from({ length: players }, () => FINGERPRINT_FEATURES.map(() => next()))
  return habits.flatMap((habit, p) =>
    Array.from({ length: gamesEach }, () => ({
      identity: `player${p}`,
      race: 'p' as const,
      features: habit.map(v => v + (next() - 0.5) * 0.3),
    })),
  )
}

describe('common/games/fingerprint-match', () => {
  test("finds a player's other name among strangers", () => {
    const games = makeGames(40, 6)
    const model = fitFingerprintModel(games)
    const printOf = (identity: string, list: LabeledFingerprint[]) =>
      buildIdentityPrint(
        identity,
        list.map(g => projectFingerprint(model, g.race, g.features)),
      )!
    const byPlayer = (p: number) => games.filter(g => g.identity === `player${p}`)

    const probe = printOf('smurf', byPlayer(0).slice(0, 3))
    const candidates = Array.from({ length: 40 }, (_, p) =>
      printOf(`player${p}`, byPlayer(p).slice(3)),
    )
    const [best, second] = scoreAliases(probe, candidates, candidates)
    expect(best.identity).toBe('player0')
    expect(best.games).toBe(3)
    expect(best.score).toBeGreaterThan(second.score + 2)
  })

  test('keeps the features that tell players apart, and drops ones that are noise', () => {
    const noise = random(7)
    const games = makeGames(30, 5).map(g => ({
      ...g,
      // The first feature is the same for everyone but for noise, so it says nothing of whose game
      // it is.
      features: [noise(), ...g.features.slice(1)],
    }))
    const model = fitFingerprintModel(games, 10)
    expect(model.weights.filter(w => w > 0)).toHaveLength(10)
    expect(model.weights[0]).toBe(0)
  })

  test('averages only the newest games of an identity', () => {
    const games = Array.from({ length: MAX_IDENTITY_GAMES + 10 }, (_, i) =>
      Float64Array.from([i < 10 ? -1 : 1, 0]),
    )
    const print = buildIdentityPrint('a', games)!
    expect(print.games).toBe(MAX_IDENTITY_GAMES)
    expect(Array.from(print.unit)).toEqual([1, 0])
  })

  test('says how sure a score is', () => {
    expect(getAliasConfidence(9)).toBe('strong')
    expect(getAliasConfidence(6.5)).toBe('strong')
    expect(getAliasConfidence(6)).toBe('likely')
    expect(getAliasConfidence(5)).toBe('possible')
    expect(getAliasConfidence(4.9)).toBeUndefined()
    expect(getAliasConfidence(0)).toBeUndefined()
  })
})
