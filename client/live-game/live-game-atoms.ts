import { atom } from 'jotai'
import { LiveGame } from '../../common/live-game'

/** The game the user joined, while they're in one. */
export const liveGameAtom = atom<LiveGame | undefined>(undefined)

/** Whether there's a game, which changes far less often than who's in it. */
export const hasLiveGameAtom = atom(get => !!get(liveGameAtom))
