import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { GamePlayerStats } from '../../common/games/game-stats'
import {
  getMatchup,
  getRatePerMinute,
  getSideTotals,
  getTeamsByPlayer,
  getTimelineTicks,
  groupSides,
  toBuildOrderRows,
  toFinishingOrder,
  toTimelineRows,
  toUnitEntries,
} from './game-stats-model'

// Fills in values the way the real translations do.
const t = ((_key: string, defaultValue: string, values?: Record<string, unknown>) =>
  defaultValue.replace(/{{(\w+)}}/g, (_, name: string) =>
    String(values?.[name] ?? ''),
  )) as unknown as TFunction

function player(id: number, overrides: Partial<GamePlayerStats> = {}): GamePlayerStats {
  return {
    id,
    name: `player${id}`,
    names: [`player${id}`],
    race: 'p',
    team: 0,
    result: 'unknown',
    mineralsMined: 0,
    gasMined: 0,
    totalScore: 0,
    kills: [],
    deaths: [],
    ...overrides,
  }
}

describe('client/games/game-stats-model', () => {
  test('makes each player their own side when the game had no teams', () => {
    const sides = groupSides([
      player(0, { race: 'z', result: 'loss' }),
      player(1, { race: 't', result: 'win' }),
    ])

    expect(sides.map(s => s.players.map(p => p.id))).toEqual([[1], [0]])
    expect(sides.every(s => !s.isTeam)).toBe(true)
    expect(getTeamsByPlayer(sides).size).toBe(0)
    expect(getMatchup(sides, t)).toBe('TvZ')
  })

  test('groups players by team, winners first', () => {
    const sides = groupSides([
      player(0, { team: 1, race: 'p', result: 'loss' }),
      player(1, { team: 2, race: 'z', result: 'win' }),
      player(2, { team: 1, race: 't', result: 'loss' }),
      player(3, { team: 2, race: 'p', result: 'win' }),
    ])

    expect(sides.map(s => [s.number, s.result, s.players.map(p => p.id)])).toEqual([
      [1, 'win', [1, 3]],
      [2, 'loss', [0, 2]],
    ])
    expect(getTeamsByPlayer(sides).get(2)?.number).toBe(2)
    expect(getMatchup(sides, t)).toBe('ZP vs PT')
  })

  test("shows a race it doesn't know as a question mark", () => {
    expect(getMatchup(groupSides([player(0), player(1, { race: undefined })]), t)).toBe('Pv?')
  })

  test('combines unit types that share a name and lists units before buildings', () => {
    const entries = toUnitEntries(
      [
        [111, 1], // Barracks
        [0, 4], // Marine
        [5, 2], // Siege Tank
        [30, 3], // Siege Tank, sieged
      ],
      t,
    )

    expect(entries.map(e => [e.name, e.count, e.isBuilding])).toEqual([
      ['Siege Tank', 5, false],
      ['Marine', 4, false],
      ['Barracks', 1, true],
    ])
  })

  test('measures income over the half minute before each time', () => {
    const times = [0, 10_000, 20_000, 30_000, 40_000]
    const mined = [0, 100, 200, 300, 600]
    expect(getRatePerMinute(times, mined, 30_000)).toEqual([undefined, 600, 600, 600, 1000])
    expect(getRatePerMinute(times, mined, 10_000)).toEqual([undefined, 600, 600, 600, 1800])
  })

  test("lines up every player's progress by time, leaving gaps once they stopped", () => {
    const rows = toTimelineRows(
      [0, 10_000],
      [
        player(0, { timeline: { workers: [4, 6], armyScore: [0, 0], resourcesMined: [0, 0] } }),
        player(1, { timeline: { workers: [4], armyScore: [0], resourcesMined: [0] } }),
        player(2),
      ],
      timeline => timeline.workers,
    )
    expect(rows).toEqual([
      { timeMs: 0, player0: 4, player1: 4, player2: undefined },
      { timeMs: 10_000, player0: 6, player1: undefined, player2: undefined },
    ])
  })

  test('marks timelines at the start, the end and round times between, closer for short games', () => {
    const seconds = (ticks: number[]) => ticks.map(ms => ms / 1000)
    // A 1:40 game is marked every 30 seconds.
    expect(seconds(getTimelineTicks(100_000))).toEqual([0, 30, 60, 100])
    // A 5:28 game every 2 minutes.
    expect(seconds(getTimelineTicks(328_000))).toEqual([0, 120, 240, 328])
    // A 15:57 game every 5 minutes, with 15:00 giving way to the end so their labels don't collide.
    expect(seconds(getTimelineTicks(15 * 60_000 + 57_000))).toEqual([0, 300, 600, 957])
    expect(getTimelineTicks(0)).toEqual([0])
  })

  test('names build steps at the time each started, leaving out workers', () => {
    const step = (
      timeMs: number,
      kind: 'unit' | 'upgrade' | 'tech',
      id: number,
      extra: { level?: number; count?: number; cancelled?: boolean } = {},
    ) => ({ timeMs, kind, id, count: 1, cancelled: false, supply: 9, ...extra })
    const rows = toBuildOrderRows(
      [
        step(0, 'unit', 41), // Drone
        step(10, 'unit', 41),
        step(20, 'unit', 142), // Spawning Pool
        step(30, 'unit', 37, { count: 2 }), // Zergling
        step(31, 'unit', 37, { count: 2 }),
        step(32, 'unit', 142, { cancelled: true }),
        step(40, 'upgrade', 27, { level: 1 }), // Metabolic Boost
        step(50, 'upgrade', 10, { level: 2 }), // Zerg Melee Attacks
        step(60, 'tech', 11), // Burrowing
      ],
      t,
    )
    expect(rows.map(r => [r.timeMs, r.name, r.count, r.cancelled, r.isBuilding])).toEqual([
      [20, 'Spawning Pool', 1, false, true],
      [30, 'Zergling', 2, false, false],
      [31, 'Zergling', 2, false, false],
      [32, 'Spawning Pool', 1, true, true],
      [40, 'Metabolic Boost', 1, false, false],
      [50, 'Zerg Melee Attacks 2', 1, false, false],
      [60, 'Burrowing', 1, false, false],
    ])
  })

  test("adds up a side's totals and averages, and finds its peak army supply", () => {
    const timeline = (supplyUsed: number[], workers: number[]) => ({
      workers,
      armyScore: [],
      resourcesMined: [],
      supplyUsed,
    })
    const totals = getSideTotals([
      player(0, {
        mineralsMined: 5000,
        gasMined: 1200,
        supplyBlockedMs: 30_000,
        eapm: 100,
        averageUnspent: 400,
        timeline: timeline([10, 40, 60], [8, 20, 30]),
      }),
      player(1, {
        mineralsMined: 4000,
        gasMined: 800,
        supplyBlockedMs: 15_000,
        eapm: 140,
        timeline: timeline([10, 50, 30], [8, 20, 25]),
      }),
    ])
    expect(totals).toEqual({
      minerals: 9000,
      gas: 2000,
      // 20 + 30 a third of the way in beats 30 + 5 at the end.
      peakArmySupply: 50,
      supplyBlockedMs: 45_000,
      eapm: 120,
      averageUnspent: 400,
    })
  })

  test("doesn't count workers being made as army", () => {
    const totals = getSideTotals([
      player(0, {
        timeline: {
          workers: [8, 20],
          workersStarted: [9, 23],
          armyScore: [],
          resourcesMined: [],
          supplyUsed: [9, 40],
        },
      }),
    ])
    expect(totals.peakArmySupply).toBe(17)
  })

  test("leaves out side totals the game didn't track", () => {
    expect(getSideTotals([player(0, { mineralsMined: 100 })])).toEqual({
      minerals: 100,
      gas: 0,
      peakArmySupply: undefined,
      supplyBlockedMs: undefined,
      eapm: undefined,
      averageUnspent: undefined,
    })
  })

  test('ranks a free for all by who won, then who stayed in longest', () => {
    const sides = groupSides([
      player(0, { leftAtMs: 60_000, result: 'loss' }),
      player(1),
      player(2, { result: 'win' }),
      player(3, { leftAtMs: 120_000, result: 'loss' }),
    ])
    expect(toFinishingOrder(sides).map(side => side.key)).toEqual([2, 1, 3, 0])
  })

  test('ranks the player whose replay stopped when they left after everyone still in', () => {
    const sides = groupSides([
      // The recording player left, so they lost but have no time of leaving.
      player(0, { result: 'loss' }),
      player(1, { leftAtMs: 60_000, result: 'loss' }),
      player(2),
      player(3, { result: 'win' }),
    ])
    expect(toFinishingOrder(sides).map(side => side.key)).toEqual([3, 2, 0, 1])
  })
})
