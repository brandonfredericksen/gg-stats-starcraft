import { describe, expect, test } from 'vitest'
import { CHECKPOINT_MINUTES, PlayerMetrics } from '../games/player-metrics'
import {
  BuildSample,
  isArmyMixUnit,
  quantile,
  summarizeBuilds,
  summarizeBuildSide,
  summarizeTeamBuilds,
} from './builds'

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
let nextGame = 0

function threeGate(name: string, result: 'win' | 'loss', gasMs = 250_000): BuildSample {
  return {
    name,
    result,
    gameId: String(nextGame++),
    withUser: false,
    carried: false,
    playedMs: 900_000,
    player: player({
      buildSteps: [
        { key: 'u156', timeMs: 50_000, supply: 8 },
        { key: 'u160', timeMs: 80_000, supply: 10 },
        { key: 'u160', timeMs: 120_000, supply: 12 },
        { key: 'u160', timeMs: 160_000, supply: 14 },
        { key: 'u157', timeMs: gasMs, supply: 20 },
      ],
      workerStop: { workers: 22, atMs: 420_000 },
      armyMix: { 65: [4, 8, 10, 12] },
      unitTimes: { 64: [0, 13_000], 65: [200_000, 230_000] },
    }),
  }
}

function forgeFirst(name: string): BuildSample {
  return {
    name,
    result: 'loss',
    gameId: String(nextGame++),
    withUser: false,
    carried: false,
    playedMs: 900_000,
    player: player({
      buildSteps: [
        { key: 'u156', timeMs: 50_000, supply: 8 },
        { key: 'u166', timeMs: 70_000, supply: 9 },
      ],
      workerStop: null,
      armyMix: { 66: [0, 2, 4, 6] },
    }),
  }
}

const familyOf = ({ player }: BuildSample) =>
  player.buildSteps?.some(s => s.key === 'u166') ? 'oneBase:forge' : 'oneBase:gates3'

describe('common/my-stats/builds', () => {
  test('weighs values as if each were there that many times', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([1, 2, 3, 4], 0.5, [1, 1, 1, 1])).toBe(2.5)
    expect(quantile([1, 3], 0.5, [2, 1])).toBe(quantile([1, 1, 3], 0.5))
    expect(quantile([4, 1, 3], 0.25, [1, 3, 2])).toBe(quantile([4, 1, 1, 1, 3, 3], 0.25))
  })

  test('takes typical steps by how much each game counts', () => {
    const light = threeGate('a', 'win', 200_000)
    const heavy = { ...threeGate('b', 'win', 300_000), weight: 2 }
    const [gas] = summarizeBuildSide([light, heavy]).steps.filter(s => s.key === 'u157')
    expect(gas.timeMs).toBe(300_000)
  })

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
    expect(builds[0].others.armyMix).toEqual([{ unitId: 65, counts: [4, 8, 10, 12] }])
    expect(builds[0].others.unitSteps.map(s => [s.key, s.nth, s.timeMs])).toEqual([
      ['u64', 5, 0],
      ['u64', 6, 13_000],
      ['u65', 1, 200_000],
      ['u65', 2, 230_000],
    ])
    expect(builds[1].others.workerStop).toMatchObject({ stopped: 0, games: 3 })
  })

  test('gives each step the times the middle half of games take it between', () => {
    const pool = [200_000, 250_000, 300_000, 350_000].map(gasMs => threeGate('a', 'win', gasMs))
    const [build] = summarizeBuilds([], pool, familyOf)
    expect(build.others.steps.find(s => s.key === 'u157')).toMatchObject({
      timeMs: 275_000,
      earlyMs: 237_500,
      lateMs: 312_500,
    })
  })

  test('counts a team once, leaves carried players out of the winners and keeps the user build', () => {
    const teammates = ['a', 'b'].map(name => ({
      ...threeGate(name, 'win'),
      gameId: 'team',
      side: '0',
    }))
    const carried = ['c', 'd', 'e', 'f', 'g'].map(name => ({
      ...threeGate(name, 'win'),
      carried: true,
    }))
    const [build] = summarizeBuilds([], [...teammates, ...carried], familyOf)
    expect(build.others).toMatchObject({ games: 7, wins: 6 })
    expect(build.winners).toBeUndefined()

    const busy = Array.from({ length: 10 }, (_, i) =>
      Array.from({ length: 3 }, () => {
        const sample = threeGate(`p${i}`, 'win')
        return { ...sample, player: { ...sample.player, names: [`p${i}`] } }
      }),
    ).flat()
    const user = [1, 2, 3].map(() => forgeFirst('me'))
    const builds = summarizeBuilds(user, busy, ({ player }) =>
      player.buildSteps?.some(s => s.key === 'u166') ? 'mine' : player.names[0],
    )
    expect(builds).toHaveLength(9)
    expect(builds.at(-1)?.family).toBe('mine')
  })

  test("shows the user's version of a build next to everyone's, and the winners'", () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((name, i) =>
      threeGate(name, i < 5 ? 'win' : 'loss'),
    )
    const user = [1, 2, 3].map(() => threeGate('me', 'loss', 330_000))
    const [build] = summarizeBuilds(user, pool, familyOf)
    expect(build.winners?.games).toBe(5)
    expect(build.user?.games).toBe(3)
    expect(build.user?.steps.find(s => s.key === 'u157')?.timeMs).toBe(330_000)
  })

  test('counts each player once in a melee game, where everyone is on one team', () => {
    const mirror = ['a', 'b'].map((name, i) => ({
      ...threeGate(name, i ? 'loss' : 'win'),
      gameId: 'mirror',
    }))
    const [build] = summarizeBuilds([], [...mirror, threeGate('c', 'win')], familyOf)
    expect(build.others).toMatchObject({ games: 3, wins: 2, losses: 1 })

    const sided = mirror.map(s => ({ ...s, side: s.name }))
    const [sidedBuild] = summarizeBuilds([], [...sided, threeGate('c', 'win')], familyOf)
    expect(sidedBuild.others).toMatchObject({ wins: 2, losses: 1 })
  })

  test('counts teammates once when their teams differ from their opponents', () => {
    const game = ['a', 'b', 'c'].map((name, i) => {
      const sample = threeGate(name, i < 2 ? 'win' : 'loss')
      return { ...sample, gameId: 'team', player: { ...sample.player, team: i < 2 ? 1 : 2 } }
    })
    const [build] = summarizeBuilds([], game, familyOf)
    expect(build.others).toMatchObject({ games: 3, wins: 1, losses: 1 })
  })

  test('keeps every unit made, so a side shows its real count of a unit another makes more of', () => {
    const pool = ['a', 'b', 'c'].map(name => {
      const sample = threeGate(name, 'win')
      return { ...sample, player: { ...sample.player, armyMix: { 65: [0, 0, 0.2, 0.3] } } }
    })
    const [build] = summarizeBuilds([], pool, familyOf)
    const [entry] = build.others.armyMix
    expect(entry.unitId).toBe(65)
    expect(entry.counts.at(-1)).toBeCloseTo(0.3)
    expect(isArmyMixUnit(entry)).toBe(false)
    expect(isArmyMixUnit({ unitId: 65, counts: [0, 0.5, 1, 2] })).toBe(true)
  })
})

describe('common/my-stats/builds summarizeTeamBuilds', () => {
  const team = (families: [string, string], user = false, result: 'win' | 'loss' = 'win') => ({
    families,
    result,
    user,
  })

  test('counts two builds of one race as one pair in either order', () => {
    const pairs = summarizeTeamBuilds([
      team(['z pool9', 'z hatch']),
      team(['z hatch', 'z pool9']),
      team(['z hatch', 'z pool9'], false, 'loss'),
    ])
    expect(pairs).toEqual([
      expect.objectContaining({ families: ['z hatch', 'z pool9'], games: 3, wins: 2, losses: 1 }),
    ])
  })

  test("keeps the race asked about first, and the user's own build first", () => {
    const pairs = summarizeTeamBuilds([
      ...[1, 2, 3].map(() => team(['p gates2', 'z pool9'])),
      ...[1, 2, 3].map(() => team(['z hatch', 'z pool9'])),
      team(['z pool9', 'z hatch'], true),
    ])
    expect(pairs.map(p => [p.families, p.games, p.userGames])).toEqual([
      [['z pool9', 'z hatch'], 3, 1],
      [['p gates2', 'z pool9'], 3, 0],
    ])
  })

  test("leaves the user's teams out of other players' win rate", () => {
    const pairs = summarizeTeamBuilds([
      ...[1, 2, 3].map(() => team(['t rax', 't factory'], false, 'loss')),
      ...[1, 2].map(() => team(['t rax', 't factory'], true, 'win')),
    ])
    expect(pairs[0]).toMatchObject({
      games: 3,
      wins: 0,
      losses: 3,
      userGames: 2,
      userWins: 2,
      userLosses: 0,
    })

    const userOnly = summarizeTeamBuilds([1, 2, 3].map(() => team(['p gates1', 'p forge'], true)))
    expect(userOnly[0]).toMatchObject({ games: 0, userGames: 3 })
  })
})
