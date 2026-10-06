import { TypedIpcRenderer } from '../../common/ipc'
import { dispatch } from '../dispatch-registry'
import { addRecentReplayPathAtom } from '../games/game-atoms'
import {
  failReplayAnalysisAtom,
  showGameStatsAtom,
  updateRunningAnalysesAtom,
} from '../games/game-stats-atoms'
import { jotaiStore } from '../jotai-store'
import { updateActiveGame } from './wait-for-active-game'

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  ipcRenderer
    .on('activeGameStatus', (event, status) => {
      dispatch({
        type: '@active-game/status',
        payload: status,
      })

      updateActiveGame(status)

      jotaiStore.set(updateRunningAnalysesAtom, { gameId: status.id, state: status.state })
      // A replay analysis that reported its stats is already done by the time it exits: the app
      // sends the stats ahead of the exit's status, so this only fails one that never reported.
      if (status.state === 'error') {
        jotaiStore.set(failReplayAnalysisAtom, { gameId: status.id, reason: 'launch' })
      } else if (status.state === 'unknown' || status.state === 'finished') {
        jotaiStore.set(failReplayAnalysisAtom, { gameId: status.id, reason: 'stopped' })
      }
    })
    .on('activeGameReplaySaved', (_, gameId, path) => {
      jotaiStore.set(addRecentReplayPathAtom, { gameId, path })
    })
    .on('activeGameStats', (_, gameId, stats, source) => {
      jotaiStore.set(showGameStatsAtom, { gameId, source, stats })
    })
    .on('activeGameStatsFailed', (_, gameId) => {
      jotaiStore.set(failReplayAnalysisAtom, { gameId, reason: 'noStats' })
    })
}
