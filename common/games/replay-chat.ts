import type { Player, ReplayCommand } from '@shieldbattery/broodrep'
import { filterColorCodes } from '../maps'
import { FASTEST_MS_PER_FRAME } from './game-stats'

/** A message someone sent in a replay's game. */
export interface ReplayChatMessage {
  /** How far into the game it was sent. */
  timeMs: number
  /** Who sent it, or an empty string if the replay doesn't say. */
  name: string
  isObserver: boolean
  message: string
}

/** The chat in a replay, along with who saved it. */
export interface ReplayChat {
  /**
   * Who saved the replay. It only has the ally chat this person could see. Unknown when nothing was
   * said, since the replay only says through its chat.
   */
  recorder?: { name: string; isObserver: boolean }
  messages: ReplayChatMessage[]
}

/** The chat in a replay's commands, in the order it was sent, with BW's color codes left out. */
export function getReplayChat(
  players: ReadonlyArray<Pick<Player, 'networkId' | 'slotId' | 'name' | 'isObserver'>>,
  commands: ReadonlyArray<ReplayCommand>,
): ReplayChat {
  const result: ReplayChat = { messages: [] }
  for (const { frame, playerId, command } of commands) {
    if (command.type !== 'chat') {
      continue
    }
    const message = filterColorCodes(command.message).trim()
    if (!message) {
      continue
    }
    // Chat is recorded under the replay owner's id. The message's own sender byte says who sent
    // it: their slot, or 128-131 for an observer, which matches observers' network ids.
    if (!result.recorder) {
      const recorder = players.find(p => p.networkId === playerId)
      if (recorder) {
        result.recorder = { name: recorder.name, isObserver: recorder.isObserver }
      }
    }
    const sender =
      command.senderSlot >= 128
        ? players.find(p => p.isObserver && p.networkId === command.senderSlot)
        : players.find(p => !p.isObserver && p.slotId === command.senderSlot)
    result.messages.push({
      timeMs: frame * FASTEST_MS_PER_FRAME,
      name: sender?.name ?? '',
      isObserver: sender?.isObserver ?? false,
      message,
    })
  }
  return result
}
