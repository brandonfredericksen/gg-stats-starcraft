import { describe, expect, test } from 'vitest'
import { BuildStepMetric, CHECKPOINT_MINUTES, PlayerMetrics } from '../games/player-metrics'
import { AssignedRaceChar } from '../races'
import { FamilyGame, getBuildFamily } from './build-family'

const empty = CHECKPOINT_MINUTES.map(() => null)

/** Workers at each checkpoint, from these counts at 4, 5 and 6 minutes on. */
function workers(...counts: number[]) {
  return CHECKPOINT_MINUTES.map((_, i) => counts[i] ?? null)
}

/** A player with these steps, each `[key, minutes, supply]`. */
function family(
  race: AssignedRaceChar,
  steps: Array<[string, number, number?]>,
  { game, ...overrides }: Partial<PlayerMetrics> & { game?: FamilyGame } = {},
) {
  const player: PlayerMetrics = {
    names: ['p'],
    race,
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
    buildSteps: steps.map(([key, minutes, supply]): BuildStepMetric => ({
      key,
      timeMs: minutes * 60_000,
      supply,
    })),
    ...overrides,
  }
  return getBuildFamily(player, game)
}

describe('common/my-stats/build-family', () => {
  test('names Protoss builds by their opening and the tech they lead to', () => {
    // Forge, Nexus, Gateway, with Cannons in between.
    expect(
      family('p', [
        ['u156', 0.6],
        ['u166', 1.2],
        ['u154', 1.9],
        ['u162', 2.2],
        ['u160', 2.6],
      ]),
    ).toBe('p forgeExpand')
    // Forge, Gateway, then the Nexus: still a Forge expand.
    expect(
      family('p', [
        ['u166', 1.2],
        ['u160', 1.7],
        ['u154', 2.2],
      ]),
    ).toBe('p forgeExpand')
    // Gateway, gas, Core, then one more Gateway and a Robotics Facility.
    expect(
      family('p', [
        ['u160', 1.2],
        ['u157', 1.5],
        ['u164', 2],
        ['u160', 3],
        ['u155', 4.5],
      ]),
    ).toBe('p gates1 u155')
    // Three Gateways before the Robotics Facility.
    expect(
      family('p', [
        ['u160', 1.2],
        ['u157', 1.5],
        ['u164', 2],
        ['u160', 3],
        ['u160', 3.2],
        ['u155', 4.5],
      ]),
    ).toBe('p gates3 u155')
    expect(
      family('p', [
        ['u160', 1.2],
        ['u164', 2],
        ['u154', 3],
      ]),
    ).toBe('p gates1 expand')
    // Zealots first: two Gateways before the Core.
    expect(
      family('p', [
        ['u160', 1.2],
        ['u160', 1.6],
        ['u164', 3],
        ['u155', 4.5],
      ]),
    ).toBe('p gates2 u155')
    // Four Gateways and Dragoons, no tech.
    expect(
      family('p', [
        ['u160', 1.2],
        ['u164', 2],
        ['u160', 3],
        ['u160', 3.4],
        ['u160', 3.8],
      ]),
    ).toBe('p gates4')
  })

  test('names where Protoss tech led', () => {
    expect(
      family('p', [
        ['u160', 1.2],
        ['u164', 2],
        ['u154', 3.4],
        ['u155', 4],
        ['u171', 4.6],
      ]),
    ).toBe('p gates1 expand u155 reaver')
    expect(
      family('p', [
        ['u160', 1.2],
        ['u164', 2],
        ['u163', 4],
        ['u165', 4.8],
        ['u61', 5.6],
      ]),
    ).toBe('p gates1 u163 dt')
  })

  test('names a team 2 Gate by what comes after its second Gateway', () => {
    const opening: Array<[string, number]> = [
      ['u156', 0.8],
      ['u160', 1.3],
      ['u160', 1.7],
      ['u156', 2.1],
      ['u156', 2.6],
    ]
    const team = { game: { shape: '3v3' as const } }
    expect(family('p', [...opening, ['u160', 3]], team)).toBe('p gates2 gate3')
    expect(family('p', [...opening, ['u166', 3.3], ['u162', 3.9]], team)).toBe('p gates2 forge')
    expect(family('p', [...opening, ['u157', 3], ['u164', 3.4]], team)).toBe('p gates2 core')
    // Not in 1v1, where tech names it.
    expect(family('p', [...opening, ['u160', 3]])).toBe('p gates2')
  })

  test('names Terran builds by what follows the first Barracks', () => {
    expect(
      family('t', [
        ['u111', 1, 8],
        ['u111', 1.3, 9],
      ]),
    ).toBe('t bbs')
    // A Siege Tank before the Command Center.
    expect(
      family('t', [
        ['u111', 1.3, 11],
        ['u110', 1.6, 12],
        ['u113', 2.5, 16],
        ['u120', 3.2, 20],
        ['u5', 3.4, 21],
        ['u106', 4, 24],
      ]),
    ).toBe('t siegeExpand')
    // The same with Marines being made: a fake double.
    expect(
      family(
        't',
        [
          ['u111', 1.3, 11],
          ['u110', 1.6, 12],
          ['u113', 2.5, 16],
          ['u5', 3.4, 21],
          ['u106', 4.5, 26],
        ],
        { unitTimes: { 0: [1.8, 2.3, 2.8, 3.3, 3.8].map(m => m * 60_000) } },
      ),
    ).toBe('t fd')
    expect(
      family('t', [
        ['u111', 1.3],
        ['u113', 2.5],
        ['u106', 3.5],
        ['u106', 5],
      ]),
    ).toBe('t factDouble')
    expect(
      family('t', [
        ['u111', 1.3],
        ['u113', 2.5],
        ['u106', 3.5],
        ['u114', 4.5],
        ['u8', 5.5],
      ]),
    ).toBe('t factExpand wraith')
    expect(
      family('t', [
        ['u111', 1.3],
        ['u106', 2],
        ['u111', 3],
        ['u112', 3.5],
        ['u111', 4],
      ]),
    ).toBe('t raxCC bio')
    expect(
      family('t', [
        ['u111', 1.3],
        ['u106', 2],
        ['u111', 3],
        ['u112', 3.5],
        ['u111', 4],
        ['u113', 5],
        ['u5', 6.3],
      ]),
    ).toBe('t raxCC bioTanks')
  })

  test('names Zerg builds by when the pool came and what tech followed', () => {
    // A third Hatchery before the Lair starts.
    expect(
      family('z', [
        ['u42', 0.6, 9],
        ['u131', 1.2, 12],
        ['u142', 1.4, 11],
        ['u131', 2.5, 13],
        ['u132', 3, 18],
        ['u141', 4.2, 26],
      ]),
    ).toBe('z hatch muta3')
    // The third Hatchery while the Lair morphs: still a 2 hatch build.
    expect(
      family('z', [
        ['u131', 1.2, 12],
        ['u142', 1.4, 11],
        ['u132', 2.8, 16],
        ['u131', 3.4, 19],
        ['u141', 3.9, 21],
      ]),
    ).toBe('z hatch muta2')
    expect(
      family('z', [
        ['u142', 1, 9],
        ['g27.1', 2, 10],
        ['u132', 2.6, 11],
        ['u141', 3.6, 12],
      ]),
    ).toBe('z pool9 muta1')
    // A Spire, then Hydras outnumbering the Mutalisks.
    expect(
      family(
        'z',
        [
          ['u131', 1.2, 12],
          ['u142', 1.4, 11],
          ['u131', 2.5, 13],
          ['u132', 3, 18],
          ['u141', 4.2, 26],
        ],
        { armyMix: { 43: [0, 2, 3, 3], 38: [0, 0, 6, 14], 47: [0, 2, 4, 4] } },
      ),
    ).toBe('z hatch muta3 intoHydra')
    // Speed whether or not a Hatchery came first.
    expect(
      family('z', [
        ['u142', 0.9, 9],
        ['u131', 1.8, 10],
        ['g27.1', 2.2, 9],
      ]),
    ).toBe('z pool9 speed')
    expect(family('z', [['u142', 0.6, 9]])).toBe('z pool9')
    expect(
      family('z', [
        ['u42', 0.6, 9],
        ['u142', 0.9, 9],
      ]),
    ).toBe('z overpool')
    expect(family('z', [['u142', 0.4, 4]])).toBe('z pool4')
  })

  test('tags an all-in, and leaves games over too soon to tell unnamed', () => {
    const twoGate: Array<[string, number]> = [
      ['u160', 1.2],
      ['u160', 1.6],
    ]
    expect(family('p', twoGate, { workers: workers(11, 11, 11) })).toBe('p gates2 allIn')
    expect(family('p', twoGate, { workers: workers(10), game: { playedMs: 4.5 * 60_000 } })).toBe(
      'p gates2 allIn',
    )
    expect(family('p', twoGate, { workers: workers(18), game: { playedMs: 5 * 60_000 } })).toBe(
      undefined,
    )
    expect(family('p', twoGate, { workers: workers(18, 21, 24) })).toBe('p gates2')
    // An opening that says where it was going on its own is named however soon the game ended.
    expect(
      family(
        't',
        [
          ['u111', 1, 8],
          ['u111', 1.3, 9],
        ],
        { game: { playedMs: 4 * 60_000 } },
      ),
    ).toBe('t bbs')
  })
})
