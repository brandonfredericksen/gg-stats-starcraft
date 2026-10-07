import { describe, expect, test } from 'vitest'
import { CHECKPOINT_MINUTES, PlayerMetrics } from '../games/player-metrics'
import { BuildSample, summarizeBuilds } from './builds'

const empty = CHECKPOINT_MINUTES.map(() => null)

function player(overrides: Partial<PlayerMetrics>): PlayerMetrics {
  return {
    names: ['p'],
    race: 'p',
    team: 0,
    result: 'win',
    human: true,
    workers: empty,
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

/** A 3 Gate game: three Gateways, then gas, with Zealots, stopping workers at 22. */
function threeGate(name: string, result: 'win' | 'loss', gasMs = 250_000): BuildSample {
  return {
    name,
    result,
    player: player({
      buildSteps: [
        { key: 'u156', timeMs: 50_000, supply: 8 },
        { key: 'u160', timeMs: 80_000, supply: 10 },
        { key: 'u160', timeMs: 120_000, supply: 12 },
        { key: 'u160', timeMs: 160_000, supply: 14 },
        { key: 'u157', timeMs: gasMs, supply: 20 },
      ],
      workerStop: { workers: 22, atMs: 420_000 },
      armyMix: { 65: [4, 8, 12] },
    }),
  }
}

function forgeFirst(name: string): BuildSample {
  return {
    name,
    result: 'loss',
    player: player({
      buildSteps: [
        { key: 'u156', timeMs: 50_000, supply: 8 },
        { key: 'u166', timeMs: 70_000, supply: 9 },
      ],
      workerStop: null,
      armyMix: { 66: [0, 2, 6] },
    }),
  }
}

const familyOf = (p: PlayerMetrics) =>
  p.buildSteps?.some(s => s.key === 'u166') ? 'oneBase:forge' : 'oneBase:gates3'

describe('common/my-stats/builds', () => {
  test('lists builds by how many games play them, with how most players play each', () => {
    const pool = [
      ...['a', 'b', 'c', 'd'].map((name, i) => threeGate(name, i % 2 ? 'win' : 'loss')),
      ...['e', 'f', 'g'].map(forgeFirst),
    ]
    const builds = summarizeBuilds([], pool, familyOf)
    expect(builds.map(b => [b.family, b.players, b.others.games])).toEqual([
      ['oneBase:gates3', 4, 4],
      ['oneBase:forge', 3, 3],
    ])
    expect(builds[0].others.steps.map(s => [s.key, s.nth, s.supply])).toEqual([
      ['u156', 1, 8],
      ['u160', 1, 10],
      ['u160', 2, 12],
      ['u160', 3, 14],
      ['u157', 1, 20],
    ])
    expect(builds[0].others.workerStop).toEqual({
      workers: 22,
      atMs: 420_000,
      stopped: 4,
      games: 4,
    })
    expect(builds[0].others.armyMix).toEqual([{ unitId: 65, counts: [4, 8, 12] }])
    expect(builds[1].others.workerStop).toMatchObject({ stopped: 0, games: 3 })
  })

  test("shows the user's version of a build next to everyone's, and the winners'", () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f'].map((name, i) =>
      threeGate(name, i < 3 ? 'win' : 'loss'),
    )
    const user = [1, 2, 3].map(() => threeGate('me', 'loss', 330_000))
    const [build] = summarizeBuilds(user, pool, familyOf)
    expect(build.winners?.games).toBe(3)
    expect(build.user?.games).toBe(3)
    expect(build.user?.steps.find(s => s.key === 'u157')?.timeMs).toBe(330_000)
  })
})
