import { describe, expect, test } from 'vitest'
import { BuildStepMetric, CHECKPOINT_MINUTES, PlayerMetrics } from '../games/player-metrics'
import { AssignedRaceChar } from '../races'
import { getBuildFamily } from './build-family'

const empty = CHECKPOINT_MINUTES.map(() => null)

/** A player with these steps, each `[key, minutes, supply]`. */
function family(race: AssignedRaceChar, steps: Array<[string, number, number?]>) {
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
  }
  return getBuildFamily(player)
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
    // Gateway, gas, Core, then two more Gateways and Dragoons: one Gateway before the Core.
    expect(
      family('p', [
        ['u160', 1.2],
        ['u157', 1.5],
        ['u164', 2],
        ['u160', 3],
        ['u160', 3.2],
        ['u155', 4.5],
      ]),
    ).toBe('p gates1 u155')
    expect(
      family('p', [
        ['u160', 1.2],
        ['u164', 2],
        ['u154', 3],
      ]),
    ).toBe('p gates1 expand')
    expect(
      family('p', [
        ['u160', 1.2],
        ['u160', 1.6],
        ['u160', 2.6],
        ['u160', 5],
        ['u160', 5.5],
        ['u164', 6],
      ]),
    ).toBe('p gates4')
  })

  test('names Terran builds by what follows the first Barracks', () => {
    expect(
      family('t', [
        ['u111', 1, 8],
        ['u111', 1.3, 9],
      ]),
    ).toBe('t bbs')
    expect(
      family('t', [
        ['u111', 1.3, 11],
        ['u110', 1.6, 12],
        ['u113', 2.5, 16],
        ['u120', 3.2, 20],
        ['t5', 3.6, 22],
        ['u106', 4, 24],
      ]),
    ).toBe('t siegeExpand')
    expect(
      family('t', [
        ['u111', 1.3],
        ['u106', 2],
        ['u111', 3],
        ['u112', 3.5],
        ['u111', 4],
      ]),
    ).toBe('t raxCC bio')
  })

  test('names Zerg builds by when the pool came and what tech followed', () => {
    expect(
      family('z', [
        ['u42', 0.6, 9],
        ['u131', 1.2, 12],
        ['u142', 1.4, 11],
        ['u131', 2.5, 13],
        ['u132', 4, 20],
        ['u141', 5.2, 30],
      ]),
    ).toBe('z hatch muta3')
    expect(family('z', [['u142', 0.6, 9]])).toBe('z pool9')
    expect(
      family('z', [
        ['u42', 0.6, 9],
        ['u142', 0.9, 9],
      ]),
    ).toBe('z overpool')
    expect(family('z', [['u142', 0.4, 4]])).toBe('z pool4')
  })
})
