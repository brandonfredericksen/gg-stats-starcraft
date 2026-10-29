import { describe, expect, test } from 'vitest'
import { FINGERPRINT_FEATURES } from '../../common/games/fingerprint'
import modelData from '../../common/games/fingerprint-model.json'
import { RaceChar } from '../../common/races'
import { LadderFingerprintGame } from '../ladder-baseline/ladder-fingerprints'
import { AliasFinder, AliasFinderSource } from './alias-finder'
import { StoredFingerprint } from './replay-db'

/** A repeatable stream of numbers in [0, 1). */
function random(seed: number) {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31
    return state / 2 ** 31
  }
}

const next = random(3)
const model = modelData as { byRace: Record<string, { mean: number[]; std: number[] }> }

/** Habits of their own for a made up person: each feature somewhere in the ladder's spread. */
function makeHabits(race: Exclude<RaceChar, 'r'>) {
  const { mean, std } = model.byRace[race]
  return mean.map((m, i) => m + (next() - 0.5) * 3 * std[i])
}

interface Game {
  names: Array<{ name: string; race: Exclude<RaceChar, 'r'>; habits: number[] }>
}

/** A source holding `games`, each its own replay, played in the order given. */
function makeSource(games: Game[]): AliasFinderSource {
  const prints: StoredFingerprint[] = games.flatMap((game, replayId) =>
    game.names.map(({ name, race, habits }) => {
      const { std } = model.byRace[race]
      return {
        replayId,
        name,
        nameKey: name.toLowerCase(),
        race,
        features: Float32Array.from(habits.map((v, i) => v + (next() - 0.5) * 0.4 * std[i])),
        gameTime: replayId,
      }
    }),
  )
  return {
    getFingerprints: () => prints,
    getFingerprintedPlayerNames: () =>
      new Map(games.map((game, replayId) => [replayId, game.names.map(n => n.name.toLowerCase())])),
    countUnfingerprinted: () => 7,
  }
}

/** `games` as a baseline built on this computer has them, each started at `gameTimeMs`. */
function makeLadderGames(games: Array<Game & { gameTimeMs: number }>): LadderFingerprintGame[] {
  return games.map(({ names, gameTimeMs }) => ({
    gameTimeMs,
    names: names.map(n => n.name),
    prints: names.map(({ name, race, habits }) => {
      const { std } = model.byRace[race]
      return {
        name,
        race,
        features: Float32Array.from(habits.map((v, i) => v + (next() - 0.5) * 0.4 * std[i])),
      }
    }),
  }))
}

/** A library of 1v1s between 60 strangers, each playing a few games against the next. */
function makeLibrary() {
  const strangers = Array.from({ length: 60 }, (_, i) => ({
    name: `Stranger${i}`,
    race: (['p', 't', 'z'] as const)[i % 3],
    habits: [] as number[],
  }))
  for (const s of strangers) {
    s.habits = makeHabits(s.race)
  }
  const games: Game[] = []
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < strangers.length; i++) {
      games.push({ names: [strangers[i], strangers[(i + 1 + round) % strangers.length]] })
    }
  }
  return { strangers, games }
}

describe('app/replay-library/alias-finder', () => {
  test('finds the other name someone plays the same race under, and how sure it is', () => {
    const { strangers, games } = makeLibrary()
    const habits = makeHabits('t')
    const main = { name: 'Flash', race: 't' as const, habits }
    const smurf = { name: 'iIlIlIl', race: 't' as const, habits }
    for (let i = 0; i < 5; i++) {
      games.push({ names: [main, strangers[i]] })
      games.push({ names: [smurf, strangers[30 + i]] })
    }

    const found = new AliasFinder(makeSource(games)).find(['flash'], [])
    expect(found.games).toBe(5)
    expect(found.pendingReplays).toBe(7)
    expect(found.aliases[0]).toMatchObject({ name: 'iIlIlIl', race: 't', games: 5 })
    expect(found.aliases[0].confidence).toBe('strong')
    expect(found.aliases.map(a => a.name)).not.toContain('Flash')
  })

  test("finds names among the ladder's players, counting games the library has once", () => {
    const { strangers, games } = makeLibrary()
    const habits = makeHabits('p')
    const main = { name: 'Bisu', race: 'p' as const, habits }
    const smurf = { name: 'Sauron', race: 'p' as const, habits }
    const ladder: Array<Game & { gameTimeMs: number }> = []
    for (let i = 0; i < 5; i++) {
      games.push({ names: [main, strangers[i]] })
      ladder.push({ names: [smurf, strangers[30 + i]], gameTimeMs: 10_000 + i })
    }
    // The library's own replay of one of Bisu's games, which mustn't count again.
    ladder.push({ names: [main, strangers[0]], gameTimeMs: games.length - 5 })

    const found = new AliasFinder(makeSource(games), () => makeLadderGames(ladder)).find(
      ['bisu'],
      [],
    )
    expect(found.games).toBe(5)
    expect(found.aliases[0]).toMatchObject({ name: 'Sauron', race: 'p', games: 5 })
  })

  test('leaves out names played against, names excluded, and other races', () => {
    const { strangers, games } = makeLibrary()
    const habits = makeHabits('z')
    const main = { name: 'Jaedong', race: 'z' as const, habits }
    const opponent = { name: 'Rival', race: 'z' as const, habits }
    const mine = { name: 'MyName', race: 'z' as const, habits }
    const offRace = { name: 'OffRace', race: 'p' as const, habits: makeHabits('p') }
    for (let i = 0; i < 4; i++) {
      games.push({ names: [main, opponent] })
      games.push({ names: [mine, strangers[i]] })
      games.push({ names: [offRace, strangers[10 + i]] })
    }

    const found = new AliasFinder(makeSource(games)).find(['Jaedong'], ['mYnAmE'])
    const names = found.aliases.map(a => a.name)
    expect(names).not.toContain('Rival')
    expect(names).not.toContain('MyName')
    expect(names).not.toContain('OffRace')
  })

  test('finds nothing for a name with no games', () => {
    const { games } = makeLibrary()
    expect(new AliasFinder(makeSource(games)).find(['Nobody'], [])).toEqual({
      aliases: [],
      games: 0,
      pendingReplays: 7,
    })
  })

  test('reads the library again once invalidated', () => {
    const { games } = makeLibrary()
    const source = makeSource(games)
    let reads = 0
    const counting: AliasFinderSource = {
      ...source,
      getFingerprints: version => {
        reads += 1
        return source.getFingerprints(version)
      },
    }
    const finder = new AliasFinder(counting)
    finder.find(['Stranger0'], [])
    finder.find(['Stranger1'], [])
    expect(reads).toBe(1)
    finder.invalidate()
    finder.find(['Stranger0'], [])
    expect(reads).toBe(2)
  })

  test('the shipped model has every feature', () => {
    expect(model.byRace.p.mean).toHaveLength(FINGERPRINT_FEATURES.length)
  })
})
