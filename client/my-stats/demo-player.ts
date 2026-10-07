import { atom, useAtomValue } from 'jotai'
import { DEMO_PLAYER_NAME, generateDemoGames } from '../../common/my-stats/demo-player'
import { DatedGameMetrics } from '../../common/my-stats/my-stats'
import { useMyPlayerNames } from '../games/my-player-names'

/**
 * Whether My stats and the coach show a made up player with games of every type, instead of the
 * user. Only in development, to see pages that need far more games than a dev library has.
 */
export const demoPlayerAtom = atom(false)

export const DEMO_PLAYER_NAMES: ReadonlyArray<string> = [DEMO_PLAYER_NAME]

export function useDemoPlayer(): boolean {
  const on = useAtomValue(demoPlayerAtom)
  return import.meta.env.DEV && on
}

/** The names My stats and the coach count as the user's: the made up player's while it's shown. */
export function useStatsPlayerNames(): ReadonlyArray<string> | undefined {
  const names = useMyPlayerNames()
  return useDemoPlayer() ? DEMO_PLAYER_NAMES : names
}

let demoGames: DatedGameMetrics[] | undefined

/** The made up player's games, made the first time they're asked for. */
export function getDemoGames(): DatedGameMetrics[] {
  demoGames ??= generateDemoGames(Date.now())
  return demoGames
}
