import { describe, expect, test } from 'vitest'
import { getReplayChat } from './replay-chat'

const players = [
  { networkId: 0, slotId: 2, name: 'Bisu', isObserver: false },
  { networkId: 1, slotId: 5, name: 'Stork', isObserver: false },
  { networkId: 128, slotId: 8, name: 'Tasteless', isObserver: true },
]

describe('common/games/replay-chat', () => {
  test('gives each message its time and sender, leaving out color codes and other commands', () => {
    // Every message is recorded under the replay owner, Bisu; the sender byte says who sent it.
    const chat = getReplayChat(players, [
      { frame: 42, playerId: 0, command: { type: 'chat', senderSlot: 2, message: 'gl hf' } },
      { frame: 50, playerId: 1, command: { type: 'train', unitType: 65 } },
      { frame: 84, playerId: 0, command: { type: 'chat', senderSlot: 5, message: 'u2 ' } },
      { frame: 126, playerId: 0, command: { type: 'chat', senderSlot: 128, message: '  wow ' } },
      { frame: 168, playerId: 0, command: { type: 'chat', senderSlot: 7, message: 'gg' } },
    ])
    expect(chat).toEqual([
      { timeMs: 42 * 42, name: 'Bisu', isObserver: false, message: 'gl hf' },
      { timeMs: 84 * 42, name: 'Stork', isObserver: false, message: 'u2' },
      { timeMs: 126 * 42, name: 'Tasteless', isObserver: true, message: 'wow' },
      { timeMs: 168 * 42, name: '', isObserver: false, message: 'gg' },
    ])
  })
})
