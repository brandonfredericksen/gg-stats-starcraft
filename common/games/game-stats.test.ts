import { describe, expect, test } from 'vitest'
import {
  fromGameStatsPayload,
  GamePlayerStatsPayload,
  GameStatsPayload,
  TimelinePayload,
} from './game-stats'

function player(overrides: Partial<GamePlayerStatsPayload> = {}): GamePlayerStatsPayload {
  return {
    id: 0,
    names: ['Flash'],
    race: 1,
    team: 1,
    victoryState: 3,
    leftAtFrame: null,
    actions: 1428,
    effectiveActions: 1000,
    mineralsMined: 5000,
    gasMined: 1000,
    unitScore: 400,
    killScore: 300,
    buildingScore: 200,
    razingScore: 100,
    // Marines, tanks in both modes, and a Barracks.
    produced: [
      [0, 20],
      [5, 2],
      [111, 1],
    ],
    kills: [[37, 30]],
    deaths: [[0, 10]],
    armyProduced: { score: 1000, minerals: 1000, gas: 0 },
    armyKilled: { score: 1050, minerals: 600, gas: 150 },
    armyLost: { score: 500, minerals: 500, gas: 0 },
    resourcesDestroyed: 750,
    resourcesLost: 500,
    supplyBlockedFrames: 238,
    timeline: {
      workers: [4, 9],
      armyScore: [0, 300],
      resourcesMined: [0, 450],
      unspent: [50, 150],
      supplyUsed: [4, 10],
      supplyAvailable: [10, 18],
      actions: [0, 40],
      resourcesLost: [0, 75],
      bases: [1, 1],
      supplyBlockedFrames: [0, 24],
    },
    buildOrder: [
      { frame: 238, kind: 'unit', id: 109, supply: 8, count: 1, cancelled: false },
      { frame: 476, kind: 'upgrade', id: 7, level: 1, supply: null, count: 1, cancelled: false },
    ],
    ...overrides,
  }
}

function payload(overrides: Partial<GameStatsPayload> = {}): GameStatsPayload {
  return {
    mapName: 'Fighting Spirit',
    frames: 14_286,
    complete: true,
    snapshotFrames: [0, 238],
    players: [player()],
    ...overrides,
  }
}

describe('common/games/game-stats/fromGameStatsPayload', () => {
  test('converts a complete report', () => {
    const stats = fromGameStatsPayload(payload())
    expect(stats.durationMs).toBe(14_286 * 42)
    expect(stats.complete).toBe(true)
    expect(stats.players[0]).toMatchObject({
      race: 't',
      result: 'win',
      apm: 143,
      eapm: 100,
      totalScore: 7000,
    })
  })

  test('measures a player who left by the time they were in the game', () => {
    const stats = fromGameStatsPayload(payload({ players: [player({ leftAtFrame: 7143 })] }))
    expect(stats.players[0].leftAtMs).toBe(7143 * 42)
    expect(stats.players[0].apm).toBe(286)
  })

  test('leaves untracked stats missing instead of zero', () => {
    const stats = fromGameStatsPayload(
      payload({
        players: [
          player({
            actions: null,
            effectiveActions: null,
            produced: null,
            kills: null,
            deaths: null,
            armyProduced: null,
          }),
        ],
      }),
    )
    expect(stats.players[0].apm).toBeUndefined()
    expect(stats.players[0].eapm).toBeUndefined()
    expect(stats.players[0].produced).toBeUndefined()
    expect(stats.players[0].kills).toBeUndefined()
    expect(stats.players[0].deaths).toBeUndefined()
    expect(stats.players[0].armyProduced).toBeUndefined()
    expect(stats.players[0].totalScore).toBe(7000)
  })

  test('reads build orders, leaving out steps it cannot make sense of', () => {
    const stats = fromGameStatsPayload(
      payload({
        players: [
          player(),
          player({
            buildOrder: [
              { frame: 10, kind: 'unit', id: 0, supply: 4, count: 1, cancelled: true },
              { frame: 20, kind: 'spell', id: 0 } as any,
              null as any,
            ],
          }),
          player({ buildOrder: null }),
        ],
      }),
    )
    expect(stats.players[0].buildOrder).toEqual([
      {
        timeMs: 238 * 42,
        kind: 'unit',
        id: 109,
        level: undefined,
        supply: 8,
        count: 1,
        cancelled: false,
      },
      {
        timeMs: 476 * 42,
        kind: 'upgrade',
        id: 7,
        level: 1,
        supply: undefined,
        count: 1,
        cancelled: false,
      },
    ])
    expect(stats.players[1].buildOrder).toEqual([
      { timeMs: 420, kind: 'unit', id: 0, level: undefined, supply: 4, count: 1, cancelled: true },
    ])
    expect(stats.players[2].buildOrder).toBeUndefined()
  })

  test('names everyone sharing a slot', () => {
    const stats = fromGameStatsPayload(
      payload({ players: [player({ names: ['Jaedong', 'Flash'] }), player({ names: [] })] }),
    )
    expect(stats.players.map(p => p.name)).toEqual(['Jaedong + Flash', '?'])
  })

  test('survives malformed values without dropping the rest', () => {
    const broken = {
      ...player(),
      mineralsMined: 'lots',
      race: 9,
      kills: [[37, 3], 'zergling', [null, 2]],
      deaths: undefined,
    } as unknown as GamePlayerStatsPayload
    const stats = fromGameStatsPayload(payload({ players: [broken, player({ id: 1 })] }))
    expect(stats.players).toHaveLength(2)
    expect(stats.players[0].mineralsMined).toBe(0)
    expect(stats.players[0].race).toBeUndefined()
    expect(stats.players[0].kills).toEqual([[37, 3]])
    expect(stats.players[0].deaths).toBeUndefined()
  })

  test('handles a report with nothing usable in it', () => {
    const stats = fromGameStatsPayload({} as GameStatsPayload)
    expect(stats.players).toEqual([])
    expect(stats.durationMs).toBe(0)
    expect(stats.complete).toBe(true)
  })

  test("lines up each player's progress with when it was recorded", () => {
    const stats = fromGameStatsPayload(
      payload({
        snapshotFrames: [0, 238, 476],
        players: [
          player(),
          player({
            id: 1,
            // Malformed, and missing most of what a timeline has.
            timeline: {
              workers: [4, 5, 6, 7],
              armyScore: [0, 'lots'],
              resourcesMined: [0],
              unspent: [50, 60, 70],
            } as unknown as TimelinePayload,
          }),
          player({ id: 2, timeline: null }),
        ],
      }),
    )
    expect(stats.snapshotTimesMs).toEqual([0, 238 * 42, 476 * 42])
    expect(stats.players[0].timeline).toMatchObject({
      workers: [4, 9],
      armyScore: [0, 300],
      resourcesMined: [0, 450],
      unspent: [50, 150],
      actions: [0, 40],
      bases: [1, 1],
      supplyBlockedMs: [0, 24 * 42],
    })
    expect(stats.players[0].supplyBlockedMs).toBe(238 * 42)
    expect(stats.players[0].armyKilled).toEqual({ score: 1050, minerals: 600, gas: 150 })
    expect(stats.players[0].averageUnspent).toBe(100)
    // Lists are cut to line up with the shortest of the ones every timeline has.
    expect(stats.players[1].timeline).toMatchObject({
      workers: [4],
      armyScore: [0],
      resourcesMined: [0],
      unspent: [50],
    })
    expect(stats.players[1].timeline?.bases).toBeUndefined()
    expect(stats.players[2].timeline).toBeUndefined()
  })

  test('marks a partial replay analysis as incomplete', () => {
    expect(fromGameStatsPayload(payload({ complete: false })).complete).toBe(false)
  })
})
