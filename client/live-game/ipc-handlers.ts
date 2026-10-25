import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import { LiveGame } from '../../common/live-game'
import windowFocusTracker from '../dom/window-focus'
import { jotaiStore } from '../jotai-store'
import logger from '../logging/logger'
import { push } from '../navigation/routing'
import { liveGameAtom } from './live-game-atoms'
import { clearScoutsSoon } from './live-game-data'

function onLiveGame(game: LiveGame | undefined) {
  const before = jotaiStore.get(liveGameAtom)
  jotaiStore.set(liveGameAtom, game)
  // Someone joining a game is in StarCraft, not here: the page is waiting when they look. While
  // they're using the app, it's not taken from under them, and going from game to game while it's
  // showing doesn't add a page to go back through for each.
  if (
    game &&
    game.id !== before?.id &&
    !windowFocusTracker.isFocused() &&
    window.location.pathname !== '/live-game'
  ) {
    push('/live-game')
  }
}

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  // A change sent while the first fetch is on its way is newer than what that fetch returns.
  let changed = false
  ipcRenderer.on('liveGameChanged', (_, game) => {
    changed = true
    onLiveGame(game)
  })
  // What the stats say about players changes with newly analyzed games.
  ipcRenderer.on('myStatsChanged', () => clearScoutsSoon())
  ipcRenderer.on('activeGameStats', () => clearScoutsSoon())
  ipcRenderer
    .invoke('liveGameGet')
    ?.then(game => {
      if (game && !changed) {
        jotaiStore.set(liveGameAtom, game)
      }
    })
    .catch(err => {
      logger.error(`Error getting the live game: ${getErrorStack(err)}`)
    })
}
