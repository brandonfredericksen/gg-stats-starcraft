import type { CommandData, ReplayCommand } from '@shieldbattery/broodrep'
import { describe, expect, test } from 'vitest'
import { FINGERPRINT_FEATURES, fingerprintReplay, MIN_FINGERPRINT_ACTIONS } from './fingerprint'

const players = [
  {
    networkId: 0,
    name: 'Bisu',
    race: 'p' as const,
    playerType: 'human' as const,
    isObserver: false,
  },
  {
    networkId: 1,
    name: 'Stork',
    race: 'p' as const,
    playerType: 'human' as const,
    isObserver: false,
  },
  {
    networkId: 2,
    name: 'Watcher',
    race: 'z' as const,
    playerType: 'human' as const,
    isObserver: true,
  },
  {
    networkId: 255,
    name: 'Computer',
    race: 't' as const,
    playerType: 'computer' as const,
    isObserver: false,
  },
]

const recall = (group: number): CommandData => ({ type: 'hotkey', hotkeyType: 1, group })
const assign = (group: number): CommandData => ({ type: 'hotkey', hotkeyType: 0, group })
const move = (x: number): CommandData => ({
  type: 'rightClick',
  x,
  y: 0,
  targetUnitTag: 0,
  targetUnitType: 0,
  queued: false,
})

function feature(features: ReadonlyArray<number>, name: string) {
  return features[FINGERPRINT_FEATURES.indexOf(name)]
}

/** `count` commands from `playerId`, `gap` frames apart, made by `make`. */
function stream(playerId: number, count: number, gap: number, make: (i: number) => CommandData) {
  return Array.from({ length: count }, (_, i): ReplayCommand => ({
    frame: 10 + i * gap,
    playerId,
    command: make(i),
  }))
}

describe('common/games/fingerprint', () => {
  test('fingerprints the humans who played enough, with every feature', () => {
    const commands = [
      ...stream(0, 400, 8, i => (i % 2 ? recall(1) : move(i))),
      ...stream(1, MIN_FINGERPRINT_ACTIONS - 1, 8, i => move(i)),
      ...stream(2, 400, 8, i => move(i)),
      ...stream(255, 400, 8, i => move(i)),
    ]
    const prints = fingerprintReplay(players, commands, 20_000)
    expect(prints.map(p => p.name)).toEqual(['Bisu'])
    expect(prints[0].race).toBe('p')
    expect(prints[0].actions).toBe(400)
    expect(prints[0].features).toHaveLength(FINGERPRINT_FEATURES.length)
    expect(new Set(FINGERPRINT_FEATURES).size).toBe(FINGERPRINT_FEATURES.length)
  })

  test('measures which groups a player uses and how they move between them', () => {
    // Assigns 1 then 2, and recalls 1, 2, 1, 2... with a move between each.
    const commands = [
      { frame: 1, playerId: 0, command: assign(1) },
      { frame: 2, playerId: 0, command: assign(2) },
      ...stream(0, 400, 20, i => (i % 2 ? move(i) : recall(i % 4 === 0 ? 1 : 2))),
    ]
    const [print] = fingerprintReplay(players, commands, 20_000)
    expect(feature(print.features, 'recall1')).toBeCloseTo(0.5)
    expect(feature(print.features, 'recall2')).toBeCloseTo(0.5)
    expect(feature(print.features, 'recall3')).toBe(0)
    expect(feature(print.features, 'firstAssign1')).toBeCloseTo(0.5)
    expect(feature(print.features, 'recall1to2')).toBeCloseTo(0.5, 1)
    expect(feature(print.features, 'recallNext')).toBeCloseTo(0.5, 1)
    expect(feature(print.features, 'doubleTapShare')).toBe(0)
    // Nothing else was ever sent, so no orders, and the share of queued ones is unknown.
    expect(feature(print.features, 'orderQueued')).toBeNaN()
  })

  test('counts double taps', () => {
    const commands = stream(0, 400, 6, i => (i % 3 === 2 ? move(i) : recall(4)))
    const [print] = fingerprintReplay(players, commands, 20_000)
    expect(feature(print.features, 'doubleTapShare')).toBeCloseTo(0.5)
    expect(feature(print.features, 'tripleTapShare')).toBe(0)
  })

  test("leaves out what a player sent after they left, and doesn't count leaving", () => {
    const commands = [
      ...stream(0, 300, 8, i => move(i)),
      { frame: 300 * 8 + 20, playerId: 0, command: { type: 'leaveGame', reason: 0 } as const },
      ...stream(0, 300, 8, i => move(i)).map(c => ({ ...c, frame: c.frame + 5_000 })),
    ]
    const [print] = fingerprintReplay(players, commands, 20_000)
    expect(print.actions).toBe(300)
  })

  test('measures rhythm in network turns, so latency changes nothing', () => {
    const fast = fingerprintReplay(
      players,
      stream(0, 400, 2, i => move(i)),
      20_000,
    )[0]
    const slow = fingerprintReplay(
      players,
      stream(0, 400, 4, i => move(i)),
      20_000,
    )[0]
    expect(feature(fast.features, 'gapTurns1')).toBe(1)
    expect(feature(slow.features, 'gapTurns1')).toBe(1)
  })
})
