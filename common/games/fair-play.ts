import { isMacroAssisted, PlayerCommandStats, SCRIPTED_BURST_SHARE } from './command-stats'
import { GamePlayerStats, HiddenTargets } from './game-stats'

/**
 * How long a player goes without clicking a hidden unit before another click is a separate time. A
 * player chasing one unit that just went out of sight can click it over and over, and a bot gives
 * the same order many times in one go, so those count once.
 */
export const HIDDEN_CLICK_GAP_MS = 10_000

/**
 * Separate times a player clicked hidden enemy units from which a map hack is likely. Once or twice
 * could be a unit stepping out of sight while a command waited on high latency, but over hundreds of
 * ladder games, players without one had none.
 */
export const MAP_HACK_TIMES = 3

/** What a game's stats and commands say about a player using a program to play. */
export interface FairPlayFlags {
  mapHack: boolean
  macroProgram: boolean
  bot: boolean
}

/**
 * How many separate times a player clicked hidden enemy units: clicks less than
 * {@link HIDDEN_CLICK_GAP_MS} apart count as one.
 */
export function countHiddenClickTimes(hidden: HiddenTargets | undefined): number {
  const times = (hidden?.targets ?? []).map(target => target.timeMs).sort((a, b) => a - b)
  let count = 0
  let last: number | undefined
  for (const time of times) {
    if (last === undefined || time - last > HIDDEN_CLICK_GAP_MS) {
      count += 1
    }
    last = time
  }
  return count
}

export function getFairPlayFlags(
  player: Pick<GamePlayerStats, 'hiddenTargets'>,
  commands: PlayerCommandStats | undefined,
): FairPlayFlags {
  return {
    mapHack: countHiddenClickTimes(player.hiddenTargets) >= MAP_HACK_TIMES,
    macroProgram: !!commands && isMacroAssisted(commands),
    bot: (commands?.burstShare ?? 0) >= SCRIPTED_BURST_SHARE,
  }
}
