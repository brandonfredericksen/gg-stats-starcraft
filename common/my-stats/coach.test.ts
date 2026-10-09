import { describe, expect, test } from 'vitest'
import { GameStatsResult } from '../games/game-stats'
import {
  CHECKPOINT_MINUTES,
  GAME_METRICS_VERSION,
  GameShape,
  PlayerMetrics,
} from '../games/player-metrics'
import { AssignedRaceChar } from '../races'
import { CoachQuery, computeCoach, roundTarget } from './coach'
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
    bases: empty,
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

  test('lists army killed and lost without pointing them out', () => {
    const mine = Array.from({ length: 12 }, (_, i) =>
      game('1v1', [
        player(me, 'p', 0, 'win', { armyKilled: 1000, armyLost: 5000 }),
        player(`zerg${i}`, 'z', 0, 'loss'),
      ]),
    )
    const theirs = Array.from({ length: 40 }, (_, i) =>
      game('1v1', [
        player(`toss${i}`, 'p', 0, 'win', { armyKilled: 4000, armyLost: 2000 }),
        player(`zergling${i}`, 'z', 0, 'loss'),
      ]),
    )
    const coach = computeCoach([...mine, ...theirs], query)
    if (coach.status !== 'ready') {
      throw new Error('Expected a ready coach')
    }
    const [bucket] = coach.buckets
    expect(bucket.compared).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'armyKilled', userValue: 1000, poolValue: 4000 }),
        expect.objectContaining({ key: 'armyLost', userValue: 5000, poolValue: 2000 }),
      ]),
    )
    const pointedOut = [...bucket.gaps, ...bucket.strengths, ...bucket.goals].map(f => f.key)
    expect(pointedOut).not.toContain('armyKilled')
    expect(pointedOut).not.toContain('armyLost')
  })

  test('leaves out games from before the time range, on both sides', () => {
    const before = [...myGames(4, 14), ...poolGames(10, () => 18)]
    const after = [...myGames(12, 14), ...poolGames(40, () => 18)]
    const coach = computeCoach([...before, ...after], {
      ...query,
      window: 'all',
      fromMs: after[0].gameTimeMs,
    })
    expect(coach.status === 'ready' && coach.buckets[0]).toMatchObject({
      userGames: 12,
      poolGames: 40,
    })
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

  test('counts the games it skipped because someone quit early', () => {
    const left = game('1v1', [
      player(me, 'p', 0, 'win', { leftAtMs: 2 * 60_000, quit: true }),
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

  test('looks at the latest games picked, and other players from the same stretch', () => {
    const earlier = [...myGames(30, 14), ...poolGames(40, () => 10)]
    const recent = [...myGames(10, 20), ...poolGames(40, () => 16), ...myGames(15, 20)]
    const coach = computeCoach([...earlier, ...recent], { ...query, window: 25 })
    expect(coach.status === 'ready' && coach.sinceMs).toBe(recent[0].gameTimeMs)
    expect(coach.status === 'ready' && coach.buckets[0]).toMatchObject({
      userGames: 25,
      poolGames: 40,
    })
  })

  test('by default looks at the last 3 months, but no fewer than 30 games', () => {
    const later = (games: DatedGameMetrics[]) =>
      games.map(g => ({ ...g, gameTimeMs: g.gameTimeMs + 100 * 24 * 60 * 60_000 }))
    const few = computeCoach([...myGames(40, 14), ...later(myGames(20, 20))], query)
    expect(few.status === 'ready' && few.autoGames).toBe(30)
    expect(few.status === 'ready' && few.buckets[0].userGames).toBe(30)

    const many = computeCoach([...myGames(40, 14), ...later(myGames(35, 20))], query)
    expect(many.status === 'ready' && many.buckets[0].userGames).toBe(35)

    const all = computeCoach([...myGames(40, 14), ...later(myGames(35, 20))], {
      ...query,
      window: 'all',
    })
    expect(all.status === 'ready' && all.sinceMs).toBeUndefined()
    expect(all.status === 'ready' && all.buckets[0].userGames).toBe(75)
  })

  test('sets goals for the next game, and checks the latest games against them', () => {
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
        checks: [false, false, false, false, true],
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
        checks: [false, false, false, false, true],
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

  test('keeps team games where a rush defeated someone early', () => {
    const rushed = Array.from({ length: 4 }, (_, i) =>
      game('2v2', [
        player(me, 'z', 0, 'win', { workers6: 14 }),
        player('ally', 't', 0, 'win'),
        player(`rushed${i}`, 'p', 1, 'loss', { leftAtMs: 3 * 60_000, quit: false }),
        player(`foe${i}`, 'p', 1, 'loss'),
      ]),
    )
    const quit = game('2v2', [
      player(me, 'z', 0, 'win'),
      player('ally', 't', 0, 'win'),
      player('quitter', 'p', 1, 'loss', { leftAtMs: 3 * 60_000, quit: true }),
      player('foe', 'p', 1, 'loss'),
    ])
    const coach = computeCoach([...rushed, quit], { names: [me], shape: '2v2', race: 'z' })
    const bucket = coach.status === 'ready' ? coach.buckets[0] : undefined
    expect(bucket).toMatchObject({ userGames: 4, skippedGames: 1, wins: 4 })
  })

  test('only reads numbers from before anyone in a team game went out', () => {
    const games = Array.from({ length: 12 }, (_, i) =>
      game('2v2', [
        player(me, 'z', 0, 'win', { workers6: 14 }),
        player('ally', 't', 0, 'win'),
        // Out at 5 minutes, so workers at 6 come from a game played a player up.
        player(`early${i}`, 'p', 1, 'loss', { leftAtMs: 5 * 60_000 }),
        player(`foe${i}`, 'p', 1, 'loss'),
      ]),
    )
    const coach = computeCoach(games, { names: [me], shape: '2v2', race: 'z' })
    const form = coach.status === 'ready' ? coach.buckets[0].recentForm : undefined
    expect(form?.games).toHaveLength(10)
    const goals = coach.status === 'ready' ? coach.buckets[0].goals : []
    expect(goals).toEqual([])
  })

  test('splits 2v2 by the teammate race, falling back to any ally when too few match', () => {
    const mine = Array.from({ length: 12 }, (_, i) =>
      game('2v2', [
        player(me, 'z', 0, 'win', { workers6: 14 }),
        player('partner', 't', 0, 'win'),
        player(`foeA${i}`, 'p', 1, 'loss'),
        player(`foeB${i}`, 'p', 1, 'loss'),
      ]),
    )
    const zergWith = (ally: AssignedRaceChar, count: number, workers6: number) =>
      Array.from({ length: count }, (_, i) =>
        game('2v2', [
          player(`zerg${ally}${i}`, 'z', 0, 'win', { workers6 }),
          player(`ally${ally}${i}`, ally, 0, 'win'),
          player(`other${ally}${i}`, 'p', 1, 'loss'),
          player(`another${ally}${i}`, 'p', 1, 'loss'),
        ]),
      )
    const query: CoachQuery = { names: [me], shape: '2v2', race: 'z', allyRace: 't' }
    const enough = computeCoach(
      [...mine, ...zergWith('t', 30, 20), ...zergWith('z', 30, 10)],
      query,
    )
    expect(enough.status === 'ready' && enough.buckets[0]).toMatchObject({
      allyRace: 't',
      anyAlly: false,
      poolGames: 30,
    })
    expect(enough.status === 'ready' && enough.buckets[0].gaps[0]).toMatchObject({
      key: 'workers6',
      poolValue: 20,
    })
    const few = computeCoach([...mine, ...zergWith('t', 10, 20), ...zergWith('z', 30, 10)], query)
    expect(few.status === 'ready' && few.buckets[0]).toMatchObject({ anyAlly: true, poolGames: 70 })
    // The kinds of game name the teammate's race.
    expect(enough.status === 'ready' && enough.scopes[0]).toMatchObject({ allyRace: 't' })
  })

  test('keeps teammates a lobby gave the user once among the players compared with', () => {
    const withRandoms = Array.from({ length: 12 }, (_, i) =>
      game('2v2', [
        player(me, 'z', 0, 'win'),
        player(`random${i}`, 'z', 0, 'win'),
        player(`foeA${i}`, 'p', 1, 'loss'),
        player(`foeB${i}`, 'p', 1, 'loss'),
      ]),
    )
    const coach = computeCoach(withRandoms, { names: [me], shape: '2v2', race: 'z' })
    expect(coach.status === 'ready' && coach.buckets[0].poolGames).toBe(12)
  })

  test("leaves the user's regular partners out of the players they're compared with", () => {
    const withPartner = Array.from({ length: 12 }, (_, i) =>
      game('2v2', [
        player(me, 'z', 0, 'win'),
        player('partner', 'z', 0, 'win'),
        player(`foeA${i}`, 'p', 1, 'loss'),
        player(`foeB${i}`, 'p', 1, 'loss'),
      ]),
    )
    const coach = computeCoach(withPartner, { names: [me], shape: '2v2', race: 'z' })
    expect(coach.status === 'ready' && coach.buckets[0].poolGames).toBe(0)
  })

  test('compares speed with every player, not only those over the EAPM floor', () => {
    const slowMe = Array.from({ length: 12 }, (_, i) =>
      game('1v1', [
        player(me, 'p', 0, 'win', { eapm: 90 }),
        player(`zerg${i}`, 'z', 0, 'loss', { eapm: 90 }),
      ]),
    )
    const others = [
      ...poolGames(40, () => 18, 150),
      ...Array.from({ length: 40 }, (_, i) =>
        game('1v1', [
          player(`slow${i}`, 'p', 0, 'win', { eapm: 80 }),
          player(`slowz${i}`, 'z', 0, 'loss', { eapm: 80 }),
        ]),
      ),
    ]
    const coach = computeCoach([...slowMe, ...others], query)
    const eapm =
      coach.status === 'ready' ? coach.buckets[0].compared.find(f => f.key === 'eapm') : undefined
    expect(eapm).toMatchObject({ poolGames: 80, beats: 0.5 })
  })

  test('puts the basics ahead of speed, one goal of each kind, and never a target of nothing', () => {
    const mine = Array.from({ length: 12 }, (_, i) =>
      game('1v1', [
        player(me, 'p', 0, 'win', {
          workers6: 14,
          eapm: 100,
          eapmByPhase: [100, 100, 100],
          workersLost: 6,
        }),
        player(`zerg${i}`, 'z', 0, 'loss'),
      ]),
    )
    const theirs = Array.from({ length: 40 }, (_, i) =>
      game('1v1', [
        player(`toss${i}`, 'p', 0, 'win', {
          workers6: 16 + (i % 5),
          eapm: 160 + (i % 5),
          eapmByPhase: [160, 160, 160],
          workersLost: 0,
        }),
        player(`zergling${i}`, 'z', 0, 'loss'),
      ]),
    )
    const coach = computeCoach([...mine, ...theirs], query)
    const goals = coach.status === 'ready' ? coach.buckets[0].goals : []
    // EAPM and EAPM by phase are one kind, after the workers; no workers lost isn't a target.
    expect(goals.map(g => g.key)).toEqual(['workers6', 'eapm'])
  })

  test('compares with players who opened the same broad way, whatever the order', () => {
    const gatesFirst = { u160: 60_000, u166: 150_000 }
    const mine = Array.from({ length: 12 }, (_, i) =>
      game('1v1', [
        player(me, 'p', 0, 'win', {
          workers6: 14,
          opening: ['u160', 'u160', 'u160', 'u166'],
          firstStartsMs: gatesFirst,
        }),
        player(`zerg${i}`, 'z', 0, 'loss'),
      ]),
    )
    const sameWay = Array.from({ length: 20 }, (_, i) =>
      game('1v1', [
        player(`toss${i}`, 'p', 0, 'win', {
          workers6: 15,
          opening: ['u160', 'u160', 'u166', 'u160'],
          firstStartsMs: gatesFirst,
        }),
        player(`zergling${i}`, 'z', 0, 'loss'),
      ]),
    )
    const expanders = Array.from({ length: 30 }, (_, i) =>
      game('1v1', [
        player(`fe${i}`, 'p', 0, 'win', {
          workers6: 22,
          opening: ['u154', 'u166', 'u160', 'u160'],
          firstStartsMs: { u154: 70_000, u166: 100_000 },
          townHallTimesMs: [70_000, null],
        }),
        player(`ling${i}`, 'z', 0, 'loss'),
      ]),
    )
    const coach = computeCoach([...mine, ...sameWay, ...expanders], query)
    const workers =
      coach.status === 'ready'
        ? coach.buckets[0].compared.find(f => f.key === 'workers6')
        : undefined
    expect(workers).toMatchObject({ sameOpening: true, poolValue: 15, poolGames: 20 })
  })

  test("in team games, compares losses only where a teammate didn't fall first", () => {
    const wins = Array.from({ length: 6 }, (_, i) =>
      game('2v2', [
        player(me, 'z', 0, 'win', { workers6: 20 }),
        player('ally', 't', 0, 'win'),
        player(`a${i}`, 'p', 1, 'loss'),
        player(`b${i}`, 'p', 1, 'loss'),
      ]),
    )
    const lossesAlone = Array.from({ length: 6 }, (_, i) =>
      game('2v2', [
        player(me, 'z', 0, 'loss', { workers6: 12, leftAtMs: 14 * 60_000 }),
        player('ally', 't', 0, 'loss', { leftAtMs: 9 * 60_000 }),
        player(`c${i}`, 'p', 1, 'win'),
        player(`d${i}`, 'p', 1, 'win'),
      ]),
    )
    const coach = computeCoach([...wins, ...lossesAlone], { names: [me], shape: '2v2', race: 'z' })
    expect(coach.status === 'ready' && coach.buckets[0].inLosses).toEqual([])
  })

  test('scales the difference that matters with the size of the number', () => {
    const atMinute = (income: number) => {
      const values = CHECKPOINT_MINUTES.map(() => null as number | null)
      values[at(10)] = income
      return values
    }
    const mine = Array.from({ length: 12 }, (_, i) =>
      game('1v1', [
        player(me, 'p', 0, 'win', { income: atMinute(1900) }),
        player(`zerg${i}`, 'z', 0, 'loss'),
      ]),
    )
    const theirs = Array.from({ length: 40 }, (_, i) =>
      game('1v1', [
        player(`toss${i}`, 'p', 0, 'win', { income: atMinute(1980 + (i % 5)) }),
        player(`zergling${i}`, 'z', 0, 'loss'),
      ]),
    )
    // 80 a minute behind is past the 60 that matters in a small game, but not 6% of 1,980.
    const coach = computeCoach([...mine, ...theirs], query)
    expect(coach.status === 'ready' && coach.buckets[0].gaps).toEqual([])
  })

  test('on Big Game Hunters, reads later numbers and never makes base timing a gap', () => {
    const late = (minute: number, value: number) => {
      const values = CHECKPOINT_MINUTES.map(() => null as number | null)
      values[at(minute)] = value
      return values
    }
    const bgh = (players: PlayerMetrics[]) => ({
      ...game('3v3', players),
      mapFamily: 'bgh' as const,
    })
    const team = (name: string, i: number, overrides: Partial<PlayerMetrics>) =>
      bgh([
        player(name, 'p', 0, 'win', overrides),
        player(`${name}ally1`, 't', 0, 'win'),
        player(`${name}ally2`, 'z', 0, 'win'),
        player(`${name}foe1${i}`, 'p', 1, 'loss'),
        player(`${name}foe2${i}`, 'p', 1, 'loss'),
        player(`${name}foe3${i}`, 'p', 1, 'loss'),
      ])
    const mine = Array.from({ length: 12 }, (_, i) =>
      team(me, i, { workers: late(15, 50), townHallTimesMs: [400_000, null] }),
    )
    const theirs = Array.from({ length: 40 }, (_, i) =>
      team(`toss${i}`, i, { workers: late(15, 70), townHallTimesMs: [200_000, null] }),
    )
    const coach = computeCoach([...mine, ...theirs], {
      names: [me],
      shape: '3v3',
      race: 'p',
      mapFamily: 'bgh',
    })
    const bucket = coach.status === 'ready' ? coach.buckets[0] : undefined
    expect(bucket?.gaps.map(g => g.key)).toEqual(['workers15'])
    expect(bucket?.compared.map(f => f.key)).toContain('secondBase')
  })

  test('says when the user is the first of their team to fall in losses more than most', () => {
    const loss = (name: string, i: number, firstOut: boolean) =>
      game('2v2', [
        player(name, 'z', 0, 'loss', { leftAtMs: firstOut ? 8 * 60_000 : 12 * 60_000 }),
        player(`${name}ally${i}`, 't', 0, 'loss', {
          leftAtMs: firstOut ? 12 * 60_000 : 8 * 60_000,
        }),
        player(`${name}foe1${i}`, 'p', 1, 'win'),
        player(`${name}foe2${i}`, 'p', 1, 'win'),
      ])
    const mine = Array.from({ length: 12 }, (_, i) => loss(me, i, i < 10))
    const theirs = Array.from({ length: 40 }, (_, i) => loss(`zerg${i}`, i, i % 2 === 0))
    const coach = computeCoach([...mine, ...theirs], { names: [me], shape: '2v2', race: 'z' })
    const bucket = coach.status === 'ready' ? coach.buckets[0] : undefined
    expect(bucket?.firstOut).toEqual({ losses: 12, firstOut: 10, poolShare: 0.5 })
    expect(bucket?.notes.map(n => n.kind)).toContain('firstOut')
  })

  test('sets a goal to start tech on time, but not for buildings from the opening', () => {
    const mine = Array.from({ length: 12 }, (_, i) =>
      game('1v1', [
        player(me, 'p', 0, 'win', {
          opening: ['u160', 'u157', 'u164'],
          firstStartsMs: { u160: 60_000, u157: 90_000, u164: 150_000, u163: 400_000 },
        }),
        player(`zerg${i}`, 'z', 0, 'loss'),
      ]),
    )
    const theirs = Array.from({ length: 40 }, (_, i) =>
      game('1v1', [
        player(`toss${i}`, 'p', 0, 'win', {
          opening: ['u160', 'u157', 'u164'],
          firstStartsMs: { u160: 60_000, u157: 90_000, u164: 110_000, u163: 330_000 },
        }),
        player(`zergling${i}`, 'z', 0, 'loss'),
      ]),
    )
    const coach = computeCoach([...mine, ...theirs], query)
    const bucket = coach.status === 'ready' ? coach.buckets[0] : undefined
    expect(bucket?.goals).toEqual([
      expect.objectContaining({ key: 'buildTiming', buildKey: 'u163', target: 330_000 }),
    ])
    expect(bucket?.notes.find(n => n.kind === 'timing')).toMatchObject({
      timing: { buildKey: 'u163' },
    })
  })

  test('points out long supply blocks even when many players have them too', () => {
    const blocked = (share: number, name: string, result: GameStatsResult = 'win') =>
      game('1v1', [
        player(name, 'p', 0, result, { supplyBlockedShare: share }),
        player(`${name}-zerg`, 'z', 1, result === 'win' ? 'loss' : 'win'),
      ])
    const coach = computeCoach(
      [
        ...Array.from({ length: 12 }, (_, i) => blocked(0.12, me, i % 2 ? 'win' : 'loss')),
        ...Array.from({ length: 40 }, (_, i) => blocked(0.01 * (i % 20), `toss${i}`)),
      ],
      query,
    )
    const gaps = coach.status === 'ready' ? coach.buckets[0].gaps : []
    expect(gaps.map(g => g.key)).toContain('supplyBlocked')
    expect(gaps.find(g => g.key === 'supplyBlocked')!.beats).toBeGreaterThan(0.3)
  })

  test('points a goal at the moment in the game that missed it by the most', () => {
    const blocked = (share: number, name: string, startMs = 0) =>
      game('1v1', [
        player(name, 'p', 0, 'win', {
          supplyBlockedShare: share,
          moments: { supplyBlock: { startMs, endMs: startMs + 30_000 } },
        }),
        player(`${name}-zerg`, 'z', 1, 'loss'),
      ])
    const mine = Array.from({ length: 12 }, (_, i) =>
      blocked(i === 10 ? 0.2 : 0.12, me, 60_000 * (i + 1)),
    )
    const coach = computeCoach(
      [...mine, ...Array.from({ length: 40 }, (_, i) => blocked(0.02, `toss${i}`))],
      query,
    )
    const goal = coach.status === 'ready' ? coach.buckets[0].goals[0] : undefined
    expect(goal).toMatchObject({
      key: 'supplyBlocked',
      review: {
        game: { gameId: mine[10].gameId },
        atMs: 660_000,
        endMs: 690_000,
        kind: 'supplyBlock',
      },
    })
  })

  test("doesn't count a difference between wins and losses that's mostly chance", () => {
    const coach = computeCoach(
      [
        ...myGames(12, 0).map((g, i) => {
          g.players[0].workers[at(6)] = i % 2 ? 26 : 14
          return g
        }),
        ...myGames(12, 0, () => 'loss').map((g, i) => {
          g.players[0].workers[at(6)] = i % 2 ? 24 : 12
          return g
        }),
      ],
      query,
    )
    const bucket = coach.status === 'ready' ? coach.buckets[0] : undefined
    expect(bucket?.inLosses.find(f => f.key === 'workers6')).toMatchObject({
      winValue: 20,
      lossValue: 18,
      notable: false,
    })
  })

  test('compares with players about as fast as the user, unless a floor is picked', () => {
    const fast = myGames(12, 18).map(g => {
      g.players[0].eapm = 250
      return g
    })
    const auto = computeCoach(fast, query)
    expect(auto.eapmFloor).toBe(200)
    const picked = computeCoach(fast, { ...query, eapmFloor: 100 })
    expect(picked.eapmFloor).toBe(100)
  })
  test('rounds targets as precisely as the page shows them, never to -0', () => {
    // 29.6s per 10 minutes shows as 30s, so a target of 30s or less is 30/600.
    expect(roundTarget(29.6 / 600, 'share', false)).toBe(29 / 600)
    expect(roundTarget(1.234, 'ratio', true)).toBe(1.24)
    expect(Object.is(roundTarget(-0.5, 'count', true), -0)).toBe(false)
  })

  test("doesn't point out a listed only number that changed lately", () => {
    const games = Array.from({ length: 20 }, (_, i) =>
      game('1v1', [
        player(me, 'p', 0, i % 2 ? 'win' : 'loss', { armyLost: i < 10 ? 1000 : 5000 }),
        player(`zerg${i}`, 'z', 0, i % 2 ? 'loss' : 'win'),
      ]),
    )
    const coach = computeCoach([...games, ...poolGames(40, () => 18)], query)
    if (coach.status !== 'ready') {
      throw new Error('Expected a ready coach')
    }
    const [bucket] = coach.buckets
    expect(bucket.recentForm.changes.map(c => c.key)).not.toContain('armyLost')
    expect(bucket.goals.map(g => g.key)).not.toContain('armyLost')
  })

  test('counts the losses it compares with wins', () => {
    const coach = computeCoach(
      [...myGames(12, 14, i => (i < 7 ? 'win' : 'loss')), ...poolGames(40, () => 18)],
      query,
    )
    expect(coach.status === 'ready' && coach.buckets[0]).toMatchObject({
      wins: 7,
      losses: 5,
      lossesCompared: 5,
    })
  })

  test("counts other players' games from the ladder baseline", () => {
    const baseline = poolGames(20, () => 18).map(g => ({ ...g, ladderBaseline: true }))
    const coach = computeCoach([...myGames(12, 18), ...poolGames(15, () => 18), ...baseline], query)
    const bucket = coach.status === 'ready' ? coach.buckets[0] : undefined
    expect(bucket).toMatchObject({ poolGames: 35, poolFromBaseline: 20 })
  })

  describe('ladder rank', () => {
    /** Other Protoss players at C, and as many at A, who make more workers. */
    const ranked = () => [
      ...poolGames(30, () => 16).map(g => {
        g.players[0].rank = 'c'
        return g
      }),
      ...poolGames(30, () => 22).map(g => {
        g.players[0].rank = 'a'
        return g
      }),
    ]
    const bucketOf = (coach: ReturnType<typeof computeCoach>) =>
      coach.status === 'ready' ? coach.buckets[0] : undefined

    test('compares with everyone until the user has a ranked game or picks a rank', () => {
      const coach = computeCoach([...myGames(12, 18), ...ranked()], query)
      expect(coach.rank).toBeUndefined()
      expect(bucketOf(coach)).toMatchObject({ poolGames: 60, rank: undefined })
    })

    test('compares with players of the rank picked', () => {
      const coach = computeCoach([...myGames(12, 18), ...ranked()], { ...query, rank: 'a' })
      expect(coach.rank).toBe('a')
      expect(bucketOf(coach)).toMatchObject({ poolGames: 30, rank: 'a' })
      expect(bucketOf(coach)?.compared.find(f => f.key === 'workers6')?.poolValue).toBe(22)
    })

    test("picks the rank of the user's latest ranked game", () => {
      const mine = myGames(12, 18)
      mine[3].players[0].rank = 'a'
      mine[9].players[0].rank = 'c'
      const coach = computeCoach([...mine, ...ranked()], query)
      expect(coach.rank).toBe('c')
      expect(bucketOf(coach)?.compared.find(f => f.key === 'workers6')?.poolValue).toBe(16)
    })

    test("keeps the user's latest rank apart from the one picked", () => {
      const mine = myGames(12, 18)
      mine[9].players[0].rank = 'c'
      const coach = computeCoach([...mine, ...ranked()], { ...query, rank: 'a' })
      expect(coach).toMatchObject({ rank: 'a', autoRank: 'c' })
    })

    test('says what MMRs each rank covers, once it has enough of its players', () => {
      const withMmr = (rank: 'c' | 'a', mmrs: number[]) =>
        mmrs.map(mmr => {
          const [g] = poolGames(1, () => 18)
          g.players[0].rank = rank
          g.players[0].mmr = mmr
          return g
        })
      const coach = computeCoach(
        [
          ...myGames(12, 18),
          // The lowest and highest of the C players are left out, and the rest rounded to tens.
          ...withMmr('c', [1400, 1571, 1580, 1600, 1620, 1640, 1660, 1680, 1690, 1704, 1900]),
          ...withMmr('a', [2100, 2200]),
        ],
        query,
      )
      expect(coach.rankMmr).toEqual({ c: { low: 1570, high: 1700 } })
    })

    test('compares with every rank when any is picked', () => {
      const mine = myGames(12, 18)
      mine[9].players[0].rank = 'c'
      const coach = computeCoach([...mine, ...ranked()], { ...query, rank: 'any' })
      expect(coach.rank).toBeUndefined()
      expect(bucketOf(coach)?.poolGames).toBe(60)
    })

    test('only applies to 1v1', () => {
      const coach = computeCoach(
        [
          game('2v2', [
            player(me, 'p', 1, 'win', { rank: 'a' }),
            player('ally', 'z', 1, 'win'),
            player('foe1', 't', 2, 'loss'),
            player('foe2', 't', 2, 'loss'),
          ]),
        ],
        { names: [me], shape: '2v2', race: 'p', rank: 'a' },
      )
      expect(coach.rank).toBeUndefined()
    })
  })
})
