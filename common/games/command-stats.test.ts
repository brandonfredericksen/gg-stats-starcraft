import type { CommandData, ReplayCommand } from '@shieldbattery/broodrep'
import { describe, expect, test } from 'vitest'
import { summarizeCommands } from './command-stats'

/** Frames in a minute of game time on Fastest. */
const MINUTE = 60_000 / 42

function at(minutes: number, playerId: number, command: CommandData): ReplayCommand {
  return { frame: Math.round(minutes * MINUTE), playerId, command }
}

const players = [
  { networkId: 0, name: 'Bisu', playerType: 'human' as const, isObserver: false },
  { networkId: 1, name: 'Stork', playerType: 'human' as const, isObserver: false },
  { networkId: 255, name: 'Computer', playerType: 'computer' as const, isObserver: false },
]

describe('common/games/command-stats', () => {
  test('counts hotkeys, selections, production and spells per phase', () => {
    const stats = summarizeCommands(
      players,
      [
        at(1, 0, { type: 'hotkey', hotkeyType: 0, group: 1 }),
        at(2, 0, { type: 'hotkey', hotkeyType: 1, group: 1 }),
        at(7, 0, { type: 'hotkey', hotkeyType: 1, group: 2 }),
        at(7, 0, { type: 'hotkey', hotkeyType: 1, group: 2 }),
        at(13, 0, { type: 'hotkey', hotkeyType: 2, group: 3 }),
        at(3, 0, { type: 'select', unitTags: [1] }),
        at(3, 0, { type: 'train', unitType: 65 }),
        at(3, 0, { type: 'chat', senderSlot: 0, message: 'gl hf' }),
        at(14, 0, {
          type: 'targetedOrder',
          x: 0,
          y: 0,
          targetUnitTag: 0,
          targetUnitType: 0,
          order: 0x8e,
          queued: false,
        }),
      ],
      Math.round(20 * MINUTE),
    )
    const [bisu, stork] = stats.players
    expect(stats.players).toHaveLength(2)
    expect(bisu.phases.map(p => p.hotkeyRecalls)).toEqual([1, 2, 0])
    expect(bisu.phases[0]).toMatchObject({
      hotkeyAssigns: 1,
      selections: 1,
      production: 1,
      actions: 4,
    })
    expect(bisu.phases[2]).toMatchObject({ hotkeyAdds: 1, actions: 2 })
    expect(bisu.groupsUsed).toBe(2)
    expect(bisu.casts).toEqual({ psionicStorm: 1 })
    expect(bisu.phases.map(p => Math.round(p.minutes))).toEqual([6, 6, 8])
    expect(stork.phases[0].actions).toBe(0)
  })

  test('counts only army unit orders as production', () => {
    const stats = summarizeCommands(
      players,
      [
        at(1, 0, { type: 'train', unitType: 65 }),
        at(1, 0, { type: 'unitMorph', unitType: 43 }),
        at(1, 0, { type: 'train', unitType: 64 }),
        at(1, 0, { type: 'unitMorph', unitType: 42 }),
        at(1, 0, { type: 'unitMorph', unitType: 103 }),
        at(1, 0, { type: 'build', order: 0, x: 0, y: 0, unitType: 160 }),
        at(1, 0, { type: 'buildingMorph', unitType: 132 }),
        at(1, 0, { type: 'trainFighter' }),
      ],
      Math.round(20 * MINUTE),
    )
    expect(stats.players[0].phases[0]).toMatchObject({ production: 2, actions: 8 })
  })

  test('only counts the time a player was in the game', () => {
    const stats = summarizeCommands(
      players,
      [at(4, 1, { type: 'leaveGame', reason: 0 })],
      Math.round(20 * MINUTE),
    )
    expect(stats.players[1].phases.map(p => Math.round(p.minutes))).toEqual([4, 0, 0])
  })
})
