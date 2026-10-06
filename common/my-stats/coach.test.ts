import { describe, expect, test } from 'vitest'
import { GameStatsResult } from '../games/game-stats'
import {
  CHECKPOINT_MINUTES,
  GAME_METRICS_VERSION,
  GameShape,
  PlayerMetrics,
} from '../games/player-metrics'
import { AssignedRaceChar } from '../races'
import { CoachQuery, computeCoach } from './coach'
import { DatedGameMetrics } from './my-stats'

const at = (minute: number) => CHECKPOINT_MINUTES.indexOf(minute)

function player(
  name: string,
  race: AssignedRaceChar,
  team: number,
  result: GameStatsResult,
  { workers6 = 18, eapm = 150, ...overrides }: Partial<PlayerMetrics> & { workers6?: number } = {},
): PlayerMetrics {
  const empty = CHECKPOINT_MINUTES.map(() => null)
  const workers = CHECKPOINT_MINUTES.map(() => null as number | null)
  workers[at(6)] = workers6
  return {
    names: [name],
    race,
    team,
    result,
    human: true,
    apm: eapm + 50,
    eapm,
    workers,
    mined: empty,
    income: empty,
    armyScore: empty,
    production: empty,
    supplyTimesMs: [null, null, null],
    bank: [null, null, null],
    supplyBlockedShare: null,
    townHallTimesMs: [null, null],
    firstStartsMs: {},
    opening: [],
    firstArmyMs: null,
    ...overrides,
  }
}

let nextId = 0

function game(shape: GameShape, players: PlayerMetrics[]): DatedGameMetrics {
  nextId += 1
  return {
    version: GAME_METRICS_VERSION,
    gameId: `game-${nextId}`,
    durationMs: 15 * 60_000,
    complete: true,
    mapName: 'Polypoid',
    mapFamily: 'standard',
    shape,
    players,
    gameTimeMs: nextId,
  }
}

const me = 'Kestrel'
const query: CoachQuery = {
  names: [me],
  shape: '1v1',
  race: 'p',
  opponentRace: 'z',
}

/** The user's PvZ games, each against a different Zerg. */
function myGames(
  count: number,
  workers6: number,
  result: (i: number) => GameStatsResult = () => 'win',
) {
  return Array.from({ length: count }, (_, i) =>
    game('1v1', [
      player(me, 'p', 0, result(i), { workers6 }),
      player(`zerg${i}`, 'z', 0, result(i) === 'win' ? 'loss' : 'win'),
    ]),
  )
}

/** Other Protoss players' PvZ games, each a different player. */
function poolGames(count: number, workers6: (i: number) => number, eapm = 150) {
  return Array.from({ length: count }, (_, i) =>
    game('1v1', [
      player(`toss${i}`, 'p', 0, 'win', { workers6: workers6(i), eapm }),
      player(`zergling${i}`, 'z', 0, 'loss'),
    ]),
  )
}

describe('common/my-stats/coach', () => {
  test('says when there are no games to coach', () => {
    expect(computeCoach([], { names: [me] }).status).toBe('noGames')
  })

  test('coaches the most played kind of game when none is picked', () => {
    const coach = computeCoach([...myGames(5, 18)], { names: [me] })
    expect(coach.status === 'ready' && coach.scope).toEqual({
      shape: '1v1',
      race: 'p',
      opponentRace: 'z',
      mapFamily: undefined,
    })
  })

  test('points out a number most of the user games fall behind on', () => {
    const coach = computeCoach([...myGames(12, 14), ...poolGames(40, i => 16 + (i % 5))], query)
    if (coach.status !== 'ready') {
      throw new Error('Expected a ready coach')
    }
    const [bucket] = coach.buckets
    expect(bucket).toMatchObject({ userGames: 12, poolGames: 40 })
    expect(bucket.gaps).toEqual([
      expect.objectContaining({ key: 'workers6', userValue: 14, poolValue: 18, beats: 0 }),
    ])
    expect(bucket.strengths).toEqual([])
    // Everything with enough games is listed, pointed out or not, like EAPM here.
    expect(bucket.compared.map(f => f.key)).toEqual(['workers6', 'eapm'])
  })

  test('points out strengths too', () => {
    const coach = computeCoach([...myGames(12, 24), ...poolGames(40, i => 16 + (i % 5))], query)
    expect(coach.status === 'ready' && coach.buckets[0].strengths[0]?.key).toBe('workers6')
  })

  test("doesn't compare until there are enough games on both sides", () => {
    const fewMine = computeCoach([...myGames(9, 14), ...poolGames(40, () => 18)], query)
    expect(fewMine.status === 'ready' && fewMine.buckets[0].gaps).toEqual([])
    const fewTheirs = computeCoach([...myGames(12, 14), ...poolGames(29, () => 18)], query)
    expect(fewTheirs.status === 'ready' && fewTheirs.buckets[0].gaps).toEqual([])
  })

  test('leaves out players under the EAPM floor', () => {
    const coach = computeCoach([...myGames(12, 14), ...poolGames(40, () => 18, 90)], query)
    expect(coach.status === 'ready' && coach.buckets[0].poolGames).toBe(0)
  })

  test('counts at most a few games of any one player', () => {
    const sameOpponent = Array.from({ length: 40 }, () =>
      game('1v1', [player('Bisu', 'p', 0, 'win'), player('Jaedong', 'z', 0, 'loss')]),
    )
    const coach = computeCoach([...myGames(12, 14), ...sameOpponent], query)
    expect(coach.status === 'ready' && coach.buckets[0].poolGames).toBe(5)
  })

  test('offers the kinds of game the user played most, as quick picks', () => {
    const pvt = Array.from({ length: 3 }, (_, i) =>
      game('1v1', [player(me, 'p', 0, 'win'), player(`terran${i}`, 't', 1, 'loss')]),
    )
    const teams = Array.from({ length: 3 }, () =>
      game('3v3', [
        player(me, 'z', 0, 'win'),
        player('a', 'p', 0, 'win'),
        player('b', 't', 0, 'win'),
        player('c', 'p', 1, 'loss'),
        player('d', 'p', 1, 'loss'),
        player('e', 'p', 1, 'loss'),
      ]),
    )
    // One stray game of a kind isn't worth a pick.
    const stray = game('2v2', [
      player(me, 'z', 0, 'win'),
      player('a', 'p', 0, 'win'),
      player('c', 'p', 1, 'loss'),
      player('d', 'p', 1, 'loss'),
    ])
    const coach = computeCoach([...myGames(5, 18), ...pvt, ...teams, stray], { names: [me] })
    expect(coach.scopes).toEqual([
      { shape: '1v1', race: 'p', opponentRace: 'z', games: 5 },
      { shape: '1v1', race: 'p', opponentRace: 't', games: 3 },
      { shape: '3v3', race: 'z', opponentRace: undefined, mapFamily: 'standard', games: 3 },
    ])
  })

  test('counts the games it skipped because someone left early', () => {
    const left = game('1v1', [
      player(me, 'p', 0, 'win', { leftAtMs: 2 * 60_000 }),
      player('quitter', 'z', 1, 'loss'),
    ])
    const coach = computeCoach([...myGames(3, 18), left], query)
    expect(coach.status === 'ready' && coach.buckets[0]).toMatchObject({
      userGames: 3,
      skippedGames: 1,
    })
    expect(coach.scopes[0].games).toBe(3)
  })

  test('splits 3v3 by map family, but not 2v2', () => {
    const teamGame = (shape: '2v2' | '3v3', mapFamily: 'bgh' | 'fastest') => {
      const size = shape === '2v2' ? 2 : 3
      const g = game(shape, [
        player(me, 'p', 0, 'win'),
        ...Array.from({ length: size - 1 }, (_, i) => player(`ally${i}`, 't', 0, 'win')),
        ...Array.from({ length: size }, (_, i) => player(`foe${i}`, 'z', 1, 'loss')),
      ])
      return { ...g, mapFamily }
    }
    const games = (shape: '2v2' | '3v3') => [teamGame(shape, 'bgh'), teamGame(shape, 'fastest')]
    const families = (shape: '2v2' | '3v3') => {
      const coach = computeCoach(games(shape), { names: [me], shape, race: 'p' })
      return coach.status === 'ready' ? coach.buckets.map(b => b.mapFamily) : []
    }
    expect(families('3v3').toSorted()).toEqual(['bgh', 'fastest'])
    expect(families('2v2')).toEqual([undefined])
    const coach = computeCoach(games('3v3'), { names: [me], shape: '3v3', race: 'p' })
    expect(coach.status === 'ready' && coach.buckets.map(b => b.mapNames)).toEqual([
      ['Polypoid'],
      ['Polypoid'],
    ])
  })

  test('compares with players who opened the same way once there are 15 of them', () => {
    const opening = ['u160', 'u160', 'u160', 'u157']
    const firstStartsMs = { u160: 60_000, u157: 90_000 }
    const mine = Array.from({ length: 12 }, (_, i) =>
      game('1v1', [
        player(me, 'p', 0, 'win', { opening, firstStartsMs: { ...firstStartsMs, u154: 240_000 } }),
        player(`zerg${i}`, 'z', 0, 'loss'),
      ]),
    )
    const theirs = Array.from({ length: 20 }, (_, i) =>
      game('1v1', [
        player(`toss${i}`, 'p', 0, 'win', {
          opening,
          firstStartsMs: { ...firstStartsMs, u154: 200_000 },
        }),
        player(`zergling${i}`, 'z', 0, 'loss'),
      ]),
    )
    const coach = computeCoach([...mine, ...theirs], query)
    if (coach.status !== 'ready') {
      throw new Error('Expected a ready coach')
    }
    // 20 players opened the same way: fewer than 30, but enough to compare with.
    expect(coach.buckets[0].timings.find(t => t.buildKey === 'u154')).toMatchObject({
      userMs: 240_000,
      poolMs: 200_000,
      sameOpening: true,
      notable: true,
    })
  })

  test("says what's different in the user's losses", () => {
    const coach = computeCoach(
      [...myGames(6, 20), ...myGames(6, 14, () => 'loss'), ...poolGames(40, () => 17)],
      query,
    )
    expect(coach.status === 'ready' && coach.buckets[0].inLosses).toEqual([
      expect.objectContaining({ key: 'workers6', winValue: 20, lossValue: 14 }),
    ])
  })

  test("compares the user's latest games with the ones before", () => {
    const coach = computeCoach(
      [...myGames(8, 14, () => 'loss'), ...myGames(10, 20, i => (i < 7 ? 'win' : 'loss'))],
      query,
    )
    if (coach.status !== 'ready') {
      throw new Error('Expected a ready coach')
    }
    const { recentForm, notes } = coach.buckets[0]
    expect(recentForm).toMatchObject({ wins: 7, losses: 3, earlierGames: 8, earlierLosses: 8 })
    expect(recentForm.games).toHaveLength(10)
    expect(recentForm.changes.find(c => c.key === 'workers6')).toMatchObject({
      recentValue: 20,
      earlierValue: 14,
      direction: 'better',
    })
    expect(notes.map(n => n.kind)).toEqual(['form', 'inLosses', 'improving'])
  })

  test('waits for enough earlier games before comparing recent form', () => {
    const coach = computeCoach(myGames(12, 14), query)
    expect(coach.status === 'ready' && coach.buckets[0].recentForm).toMatchObject({
      earlierGames: 2,
      changes: [],
    })
  })

  test('sets goals for the next game, and checks the latest game against them', () => {
    const coach = computeCoach(
      [...myGames(11, 14), ...myGames(1, 19), ...poolGames(40, i => 16 + (i % 5))],
      query,
    )
    expect(coach.status === 'ready' && coach.buckets[0].goals).toEqual([
      expect.objectContaining({
        key: 'workers6',
        basis: 'others',
        target: 18,
        userValue: 14,
        recentValue: 14,
        lastValue: 19,
        lastHit: true,
        inLosses: false,
      }),
    ])
  })

  test('without other players to compare with, aims for what the user reaches in their wins', () => {
    const coach = computeCoach(
      [...myGames(6, 20), ...myGames(6, 14, () => 'loss'), ...myGames(1, 21)],
      query,
    )
    expect(coach.status === 'ready' && coach.buckets[0].goals).toEqual([
      expect.objectContaining({
        key: 'workers6',
        basis: 'wins',
        target: 20,
        inLosses: true,
        lastValue: 21,
        lastHit: true,
      }),
    ])
  })

  test('then aims for where the user was before a slip', () => {
    const coach = computeCoach([...myGames(8, 20), ...myGames(10, 14)], query)
    const goals = coach.status === 'ready' ? coach.buckets[0].goals : []
    expect(goals).toEqual([
      expect.objectContaining({ key: 'workers6', basis: 'earlier', target: 20, beats: undefined }),
    ])
  })
})
