import { TypedIpcRenderer } from '../../common/ipc'
import { startReplayAnalysisAtom } from '../games/game-stats-atoms'
import i18n from '../i18n/i18next'
import { jotaiStore } from '../jotai-store'
import { liveGameAtom } from '../live-game/live-game-atoms'
import { openNextPageIn } from '../navigation/page-nav'
import { push, replace } from '../navigation/routing'
import { getGameStatsUrl } from '../replays/action-creators'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import { DURATION_LONG } from '../snackbars/snackbar-durations'

/**
 * Opens a game the app pointed to, like from a notification, under the Last game tab whatever page
 * was showing: it's the game just played, not one of that page's.
 */
function openInLastGame(gameId: string) {
  openNextPageIn('lastGame')
  push(getGameStatsUrl(gameId))
}

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  ipcRenderer
    .on('autoCaptureAnalysisStarted', (_, gameId, source) => {
      // Tracked like an analysis asked for here, so its page shows the progress and asking for the
      // same replay again goes to it instead of starting another.
      jotaiStore.set(startReplayAnalysisAtom, { gameId, replay: source })
      // Someone watching who's in their game sees how it went once it's over, unless the next
      // game has already started.
      if (window.location.pathname === '/live-game' && !jotaiStore.get(liveGameAtom)) {
        openNextPageIn('lastGame')
        replace(getGameStatsUrl(gameId))
      }
    })
    .on('autoCaptureAnalyzed', (_, gameId, { matchup, mapName }) => {
      externalShowSnackbar(
        matchup
          ? i18n.t('autoCapture.analyzedWithMatchup', {
              defaultValue: 'New game analyzed: {{matchup}} on {{mapName}}',
              matchup,
              mapName,
            })
          : i18n.t('autoCapture.analyzed', {
              defaultValue: 'New game analyzed: {{mapName}}',
              mapName,
            }),
        {
          durationMillis: DURATION_LONG,
          tone: 'success',
          action: {
            label: i18n.t('autoCapture.viewStats', 'View stats'),
            onClick: () => openInLastGame(gameId),
          },
        },
      )
    })
    .on('autoCaptureOpenStats', (_, gameId) => openInLastGame(gameId))
}
