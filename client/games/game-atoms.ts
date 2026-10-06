import { atom } from 'jotai'
import { atomWithImmer } from 'jotai-immer'

const MAX_RECENT_REPLAY_PATHS = 8

/**
 * Paths to the replay files saved for games recently played in this client, keyed by game ID. A
 * game's replay is saved (and its path reported) some time after the game completes, so UIs for a
 * completed game (e.g. the post-match dialog) should subscribe to this atom to pick up the path
 * whenever it arrives, rather than capturing its presence/absence once.
 */
export const recentReplayPathsAtom = atomWithImmer<ReadonlyMap<string, string>>(new Map())

/** Records the path of a saved replay, evicting the oldest recorded path if full. */
export const addRecentReplayPathAtom = atom(
  null,
  (_get, set, { gameId, path }: { gameId: string; path: string }) => {
    set(recentReplayPathsAtom, draft => {
      draft.delete(gameId)
      draft.set(gameId, path)
      if (draft.size > MAX_RECENT_REPLAY_PATHS) {
        draft.delete(draft.keys().next().value!)
      }
    })
  },
)
