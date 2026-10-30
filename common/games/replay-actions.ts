import type { CommandData, CommandKind, Player, ReplayCommand } from '@shieldbattery/broodrep'
import {
  BurstCounter,
  estimateTurnFrames,
  NOT_ACTIONS,
  ProductionCycleFinder,
} from './command-stats'

/**
 * What an action was part of that a program does: making something and switching back on one frame
 * (see `MACRO_CYCLES`), or a burst of commands no hand could send.
 */
export type ActionLabel = 'macroCycle' | 'burst'

/** One command a player gave, as the replay recorded it. */
export interface ReplayAction {
  frame: number
  /** The player's network id, see {@link ReplayActionsPlayer}. */
  playerId: number
  command: CommandData
  labels?: ActionLabel[]
}

export interface ReplayActionsPlayer {
  networkId: number
  /** The slot the player played in, which is their id in the game's stats. */
  slotId: number
  name: string
}

/** Every command the players in a replay gave, in order. */
export interface ReplayActions {
  players: ReplayActionsPlayer[]
  actions: ReplayAction[]
}

/** Commands the game sends on its own to keep everyone in step, which say nothing a player did. */
const UNLISTED: ReadonlySet<CommandKind> = new Set<CommandKind>(['keepAlive', 'latency'])

/** Lists the commands the players in a replay gave, labeling the ones a program would give. */
export function listReplayActions(
  players: ReadonlyArray<
    Pick<Player, 'networkId' | 'slotId' | 'name' | 'playerType' | 'isObserver'>
  >,
  commands: ReadonlyArray<ReplayCommand>,
): ReplayActions {
  const playing = players.filter(p => !p.isObserver)
  const ids = new Set(playing.map(p => p.networkId))
  const trackers = new Map(
    playing
      .filter(p => p.playerType === 'human')
      .map(p => [p.networkId, { bursts: new BurstCounter(), cycles: new ProductionCycleFinder() }]),
  )

  const actions: ReplayAction[] = []
  const labels = new Map<number, Set<ActionLabel>>()
  const label = (index: number, add: ActionLabel) => {
    const set = labels.get(index) ?? new Set()
    set.add(add)
    labels.set(index, set)
  }
  for (const { frame, playerId, command } of commands) {
    if (!ids.has(playerId) || UNLISTED.has(command.type)) {
      continue
    }
    const index = actions.length
    actions.push({ frame, playerId, command })
    const tracker = trackers.get(playerId)
    if (!tracker || NOT_ACTIONS.has(command.type)) {
      continue
    }
    tracker.bursts.add(frame, command)
    for (const i of tracker.cycles.add(index, frame, command) ?? []) {
      label(i, 'macroCycle')
    }
  }

  const turnFrames = estimateTurnFrames(
    Array.from(trackers.values()).flatMap(({ bursts }) => Array.from(bursts.byFrame.keys())),
  )
  for (const [index, action] of actions.entries()) {
    const tracker = trackers.get(action.playerId)
    if (
      tracker &&
      !NOT_ACTIONS.has(action.command.type) &&
      tracker.bursts.isBurst(action.frame, turnFrames)
    ) {
      label(index, 'burst')
    }
    const found = labels.get(index)
    if (found) {
      action.labels = Array.from(found)
    }
  }

  return {
    players: playing.map(({ networkId, slotId, name }) => ({ networkId, slotId, name })),
    actions,
  }
}
