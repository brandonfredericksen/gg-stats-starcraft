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

/** The chat in a replay's commands, in the order it was sent, with BW's color codes left out. */
export function getReplayChat(
  players: ReadonlyArray<Pick<Player, 'networkId' | 'slotId' | 'name' | 'isObserver'>>,
  commands: ReadonlyArray<ReplayCommand>,
): ReplayChatMessage[] {
  const result: ReplayChatMessage[] = []
  for (const { frame, playerId, command } of commands) {
    if (command.type !== 'chat') {
      continue
    }
    const message = filterColorCodes(command.message).trim()
    if (!message) {
      continue
    }
    const sender =
      players.find(p => p.networkId === playerId) ??
      players.find(p => p.slotId === command.senderSlot)
    result.push({
      timeMs: frame * FASTEST_MS_PER_FRAME,
      name: sender?.name ?? '',
      isObserver: sender?.isObserver ?? false,
      message,
    })
  }
  return result
}
