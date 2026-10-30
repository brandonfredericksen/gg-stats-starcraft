import { isMacroAssisted, PlayerCommandStats, SCRIPTED_BURST_SHARE } from './command-stats'
import { GamePlayerStats } from './game-stats'

/**
 * Commands naming hidden enemy units from which a map hack is likely. One or two could be a unit
 * stepping out of sight while a command waited on high latency, but over hundreds of ladder games,
 * players without one had none.
 */
export const MAP_HACK_HIDDEN_TARGETS = 3

/** What a game's stats and commands say about a player using a program to play. */
export interface FairPlayFlags {
  mapHack: boolean
  macroProgram: boolean
  bot: boolean
}

export function getFairPlayFlags(
  player: Pick<GamePlayerStats, 'hiddenTargets'>,
  commands: PlayerCommandStats | undefined,
): FairPlayFlags {
  return {
    mapHack: (player.hiddenTargets?.count ?? 0) >= MAP_HACK_HIDDEN_TARGETS,
    macroProgram: !!commands && isMacroAssisted(commands),
    bot: (commands?.burstShare ?? 0) >= SCRIPTED_BURST_SHARE,
  }
}
