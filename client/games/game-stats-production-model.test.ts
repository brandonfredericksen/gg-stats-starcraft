import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { BuildStep, GamePlayerStats } from '../../common/games/game-stats'
import {
  findSnapshotIndex,
  getProduction,
  getResources,
  toProductionSteps,
} from './game-stats-production-model'

// Fills in values the way the real translations do.
const t = ((_key: string, defaultValue: string, values?: Record<string, unknown>) =>
  defaultValue.replace(/{{(\w+)}}/g, (_, name: string) =>
    String(values?.[name] ?? ''),
  )) as unknown as TFunction

const MARINE = 0
const SCV = 7
const SIEGE_TANK = 5
const SIEGE_TANK_SIEGED = 30
const SUPPLY_DEPOT = 109
const HATCHERY = 131
const LAIR = 132
const HIVE = 133

function step(timeMs: number, id: number, overrides: Partial<BuildStep> = {}): BuildStep {
  return { timeMs, kind: 'unit', id, count: 1, cancelled: false, ...overrides }
}

function production(buildOrder: BuildStep[], atMs?: number) {
  const player = { buildOrder } as GamePlayerStats
  return getProduction(toProductionSteps(player, t)!, atMs)
}

describe('client/games/game-stats-production-model', () => {
  test('has no steps without a build order', () => {
    expect(toProductionSteps({} as GamePlayerStats, t)).toBeUndefined()
  })

  test('counts what was started by the moment, and nothing is in production without one', () => {
    const buildOrder = [step(1000, MARINE), step(2000, MARINE), step(9000, MARINE)]

    expect(production(buildOrder, 5000).units).toEqual([
      expect.objectContaining({ name: 'Marine', count: 2 }),
    ])
    const done = production(buildOrder)
    expect(done.units[0].count).toBe(3)
    expect(done.producing).toEqual([])
  })

  test('stacks units in production and follows the oldest', () => {
    // A Marine takes 360 frames, 15120ms.
    const buildOrder = [step(0, MARINE), step(5000, MARINE, { count: 2 }), step(0, SCV)]

    const { producing } = production(buildOrder, 7560)
    expect(producing.map(p => [p.name, p.count])).toEqual([
      ['Marine', 3],
      ['SCV', 1],
    ])
    expect(producing[0].progress).toBeCloseTo(0.5)

    expect(production(buildOrder, 15120).producing.map(p => p.name)).toEqual(['Marine'])
  })

  test('combines the modes of a unit and leaves out canceled and hidden steps', () => {
    const { units, structures } = production([
      step(0, SIEGE_TANK),
      step(1000, SIEGE_TANK_SIEGED),
      step(2000, MARINE, { cancelled: true }),
      step(3000, SUPPLY_DEPOT),
    ])
    expect(units).toEqual([expect.objectContaining({ name: 'Siege Tank', count: 2 })])
    expect(structures).toEqual([])
  })

  test('shows a line of morphing buildings as one, counted by the first', () => {
    const { structures } = production([
      step(0, HATCHERY),
      step(1000, HATCHERY),
      step(2000, LAIR),
      step(3000, HIVE),
    ])
    expect(structures).toEqual([expect.objectContaining({ name: 'Hatchery', id: HIVE, count: 2 })])
  })

  test('keeps items in the order they first showed up', () => {
    const { units } = production([step(0, MARINE), step(1, SCV), step(2, SCV), step(3, MARINE)])
    expect(units.map(u => u.name)).toEqual(['Marine', 'SCV'])
  })

  test('lists upgrades with their levels', () => {
    const { upgrades } = production([
      step(0, 0, { kind: 'upgrade', level: 1 }),
      step(5000, 0, { kind: 'upgrade', level: 2 }),
    ])
    expect(upgrades).toEqual([
      expect.objectContaining({ count: 1 }),
      expect.objectContaining({ count: 2 }),
    ])
  })

  test('finds the recorded time for a moment', () => {
    const times = [0, 10000, 20000]
    expect(findSnapshotIndex(times, undefined)).toBe(2)
    expect(findSnapshotIndex(times, 15000)).toBe(1)
    expect(findSnapshotIndex(times, -1)).toBe(-1)
  })

  test("reads a player's numbers and how fast they're mining", () => {
    const player = {
      timeline: {
        workers: [4, 20, 30],
        armyScore: [0, 5, 9],
        resourcesMined: [0, 1000, 2500],
        supplyUsed: [4, 25, 40],
        supplyAvailable: [10, 30, 50],
      },
    } as GamePlayerStats
    const times = [0, 30000, 90000]

    expect(getResources(player, times, 1)).toEqual(
      expect.objectContaining({ workers: 20, supplyUsed: 25, minedPerMinute: undefined }),
    )
    // Measured from 30s, the last time a minute or more back.
    expect(getResources(player, times, 2)).toEqual(
      expect.objectContaining({ mined: 2500, minedPerMinute: 1500 }),
    )
    expect(getResources(player, times, 3)).toBeUndefined()
    expect(getResources({} as GamePlayerStats, times, 0)).toBeUndefined()
  })
})
