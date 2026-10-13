import { atom } from 'jotai'

/**
 * A moment of the game picked on the minimap's timeline or a chart, which the minimap plays from
 * and the charts, build orders and chat mark. Undefined until someone plays, scrubs or picks one.
 */
export interface GameScrub {
  timeMs: number
  /** Whether the minimap picked it, so it doesn't jump back to a moment it already passed. */
  fromMinimap: boolean
}

export const gameScrubAtom = atom<GameScrub | undefined>(undefined)
