import type { CommandData, ReplayCommand } from '@shieldbattery/broodrep'
import { describe, expect, test } from 'vitest'
import { listReplayActions } from './replay-actions'

const players = [
  { networkId: 0, slotId: 1, name: 'Bisu', playerType: 'human' as const, isObserver: false },
  { networkId: 1, slotId: 0, name: 'Stork', playerType: 'human' as const, isObserver: false },
  { networkId: 128, slotId: 8, name: 'Watcher', playerType: 'human' as const, isObserver: true },
]

const recall = (group: number): CommandData => ({ type: 'hotkey', hotkeyType: 1, group })
const train = (unitType: number): CommandData => ({ type: 'train', unitType })
const select = (tag: number): CommandData => ({ type: 'select', unitTags: [tag] })

function command(frame: number, playerId: number, data: CommandData): ReplayCommand {
  return { frame, playerId, command: data }
}

describe('common/games/replay-actions', () => {
  test("lists the players' commands, leaving out observers and the game's own", () => {
    const { players: listed, actions } = listReplayActions(players, [
      command(10, 0, select(5)),
      command(11, 0, { type: 'keepAlive' }),
      command(12, 128, { type: 'chat', senderSlot: 8, message: 'hi' }),
      command(13, 1, train(7)),
    ])
    expect(listed.map(p => p.name)).toEqual(['Bisu', 'Stork'])
    expect(actions.map(a => [a.frame, a.playerId, a.command.type])).toEqual([
      [10, 0, 'select'],
      [13, 1, 'train'],
    ])
    expect(actions.every(a => !a.labels)).toBe(true)
  })

  test('credits chat to whoever sent it, not whoever saved the replay', () => {
    const { actions } = listReplayActions(players, [
      command(20, 1, { type: 'chat', senderSlot: 1, message: 'gl hf' }),
      command(21, 1, { type: 'chat', senderSlot: 0, message: 'u2' }),
      command(22, 1, { type: 'chat', senderSlot: 128, message: 'from the stands' }),
    ])
    expect(actions.map(a => [a.frame, a.playerId])).toEqual([
      [20, 0],
      [21, 1],
    ])
  })

  test('labels making something and switching back on one frame', () => {
    const { actions } = listReplayActions(players, [
      command(4000, 0, recall(1)),
      command(4000, 1, select(9)),
      command(4000, 0, recall(4)),
      command(4000, 0, train(64)),
      command(4000, 0, recall(1)),
    ])
    expect(actions.map(a => a.labels ?? [])).toEqual([
      [],
      [],
      ['macroCycle'],
      ['macroCycle'],
      ['macroCycle'],
    ])
  })

  test('labels bursts of commands no hand could send', () => {
    const commands: ReplayCommand[] = []
    for (let turn = 0; turn < 300; turn++) {
      const frame = 100 + turn
      commands.push(command(frame, 1, select(turn)), command(frame, 1, train(0)))
      if (turn % 10 === 0) {
        for (let i = 0; i < 4; i++) {
          commands.push(command(frame, 0, select(i)), command(frame, 0, train(64)))
        }
      }
    }
    const { actions } = listReplayActions(players, commands)
    const labeled = actions.filter(a => a.labels?.includes('burst'))
    expect(labeled.length).toBe(30 * 8)
    expect(labeled.every(a => a.playerId === 0)).toBe(true)
  })
})
