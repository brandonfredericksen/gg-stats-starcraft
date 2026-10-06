import { TypedIpcRenderer } from '../../common/ipc'
import { startReplayAnalysisAtom } from '../games/game-stats-atoms'
import i18n from '../i18n/i18next'
import { jotaiStore } from '../jotai-store'
import { push } from '../navigation/routing'
import { getGameStatsUrl } from '../replays/action-creators'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import { DURATION_LONG } from '../snackbars/snackbar-durations'

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  ipcRenderer
    .on('autoCaptureAnalysisStarted', (_, gameId, source) => {
      // Tracked like an analysis asked for here, so its page shows the progress and asking for the
      // same replay again goes to it instead of starting another.
      jotaiStore.set(startReplayAnalysisAtom, { gameId, replay: source })
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
        DURATION_LONG,
        {
          action: {
            label: i18n.t('autoCapture.viewStats', 'View stats'),
            onClick: () => push(getGameStatsUrl(gameId)),
          },
        },
      )
    })
    .on('autoCaptureOpenStats', (_, gameId) => push(getGameStatsUrl(gameId)))
}
