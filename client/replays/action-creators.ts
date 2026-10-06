import { nanoid } from 'nanoid'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getErrorStack } from '../../common/errors'
import { FASTEST_MS_PER_FRAME } from '../../common/games/game-stats'
import { makeReplayAnalysisConfig } from '../../common/games/replay-analysis-config'
import { TypedIpcRenderer } from '../../common/ipc'
import { urlPath } from '../../common/urls'
import { ReduxAction } from '../action-types'
import { isInActiveGame } from '../active-game/game-client-reducer'
import { openDialog, openSimpleDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { DispatchFunction, ThunkAction } from '../dispatch-registry'
import {
  cancelReplayAnalysisAtom,
  findRunningAnalysis,
  showGameStatsAtom,
  startReplayAnalysisAtom,
} from '../games/game-stats-atoms'
import i18n from '../i18n/i18next'
import { jotaiStore } from '../jotai-store'
import logger from '../logging/logger'
import { push, replace } from '../navigation/routing'
import { RootState } from '../root-reducer'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import { healthChecked } from '../starcraft/health-checked'

const ipcRenderer = new TypedIpcRenderer()

async function setGameConfig(replay: {
  name: string
  path: string
  analyze?: boolean
  linkedGameId?: string
  gameId?: string
  startFrame?: number
}) {
  const header = (await ipcRenderer.invoke('replayParseMetadata', replay.path))?.headerData
  return ipcRenderer.invoke(
    'activeGameSetConfig',
    makeReplayAnalysisConfig({
      ...replay,
      gameId: replay.gameId ?? nanoid(),
      seed: header?.startTime ?? 0,
    }),
  )
}

export function startReplay({
  path,
  name = 'Replay',
  startMs,
}: {
  path: string
  name?: string
  /** Where in the game to open it, rather than its start. */
  startMs?: number
}): ThunkAction {
  return healthChecked(dispatch => {
    const startFrame = startMs ? Math.round(startMs / FASTEST_MS_PER_FRAME) : undefined
    setGameConfig({ path, name, startFrame }).then(
      gameId => {
        if (gameId) {
          dispatch(openDialog({ type: DialogType.ReplayLoad, initData: { gameId } }))
        }
      },
      err => {
        logger.error(`Error starting replay file [${path}]: ${err?.stack ?? err}`)
        dispatch(
          openSimpleDialog(
            i18n.t('replays.loading.initFailureTitle', 'Error loading replay'),
            i18n.t(
              'replays.loading.initFailureBody',
              'The selected replay could not be loaded. It may either be corrupt, or was ' +
                'created by a version of StarCraft newer than is currently supported.',
            ),
          ),
        )
      },
    )
  })
}

/**
 * Watches a game's replay from `atMs` into it, for a moment worth seeing again. Says so when the
 * game's replay can't be found.
 */
export function watchGameAt(gameId: string, atMs: number): ThunkAction {
  return dispatch => {
    Promise.resolve(ipcRenderer.invoke('gameStatsGet', gameId))
      .then(saved => {
        const source = saved?.source
        const path = source?.kind === 'replay' ? source.path : source?.replayPath
        if (!path) {
          externalShowSnackbar(i18n.t('replays.watchMissing', "Couldn't find this game's replay."))
          return
        }
        const name = path.split(/[\\/]/).at(-1) ?? path
        dispatch(startReplay({ path, name, startMs: atMs }))
      })
      .catch(err => {
        logger.error(`Error finding the replay of game ${gameId}: ${getErrorStack(err)}`)
      })
  }
}

/** Where the stats of a game played or replay analyzed are shown. */
export function getGameStatsUrl(gameId: string) {
  return urlPath`/replays/stats/${gameId}`
}

/** Paths of replays whose analysis was asked for and hasn't been tracked as running yet. */
const startingAnalyses = new Set<string>()

/**
 * Shows each player's stats for a replay. Replays analyzed before show their saved stats right
 * away; otherwise (or when asked to analyze again) the replay is played through to its end in the
 * background while the stats page shows its progress.
 */
export function analyzeReplay({
  path,
  name,
  linkedGameId,
  reanalyze = false,
}: {
  path: string
  name: string
  /**
   * The game these stats belong with: the game id the replay records, if the client that saved it
   * records one, or the game whose page asked for the analysis.
   */
  linkedGameId?: string
  /**
   * Analyzes the replay even if its stats were saved before. The new analysis replaces the page
   * it was asked for from, so going back doesn't return to the stats it replaces.
   */
  reanalyze?: boolean
}): ThunkAction {
  return healthChecked((dispatch, getState) => {
    const running = findRunningAnalysis(path)
    if (running) {
      push(getGameStatsUrl(running))
      return
    }
    if (startingAnalyses.has(path)) {
      // Asked for again, like by a double click, before the first request got going.
      return
    }
    startingAnalyses.add(path)

    const findSaved = reanalyze
      ? Promise.resolve(null)
      : (ipcRenderer.invoke('gameStatsFindByReplay', path) ?? Promise.resolve(null))
    findSaved
      .catch(err => {
        // Not finding saved stats only means analyzing the replay again.
        logger.error(`Error looking up saved stats for [${path}]: ${getErrorStack(err)}`)
        return null
      })
      .then(saved => {
        if (saved) {
          jotaiStore.set(showGameStatsAtom, saved)
          push(getGameStatsUrl(saved.gameId))
        } else if (isInActiveGame(getState().gameClient)) {
          dispatch(openStarcraftInUseDialog())
        } else {
          launchReplayAnalysis(dispatch, getState, { path, name, linkedGameId }, reanalyze)
        }
      })
      .catch(swallowNonBuiltins)
      .finally(() => startingAnalyses.delete(path))
  })
}

function openStarcraftInUseDialog() {
  return openSimpleDialog(
    i18n.t('replays.analysis.inUseTitle', 'StarCraft is in use'),
    i18n.t(
      'replays.analysis.inUseBody',
      "Analyzing a replay needs StarCraft, which you're playing or watching something in. Try " +
        "again once you're done.",
    ),
  )
}

function launchReplayAnalysis(
  dispatch: DispatchFunction<ReduxAction>,
  getState: () => RootState,
  replay: { path: string; name: string; linkedGameId?: string },
  replacePage: boolean,
) {
  // The analysis is tracked before it's launched, since its launch can fail before the launch
  // request returns.
  const gameId = nanoid()
  jotaiStore.set(startReplayAnalysisAtom, { gameId, replay: { kind: 'replay', ...replay } })

  const notLaunched = (dialog: ReturnType<typeof openSimpleDialog>) => {
    jotaiStore.set(cancelReplayAnalysisAtom, gameId)
    dispatch(dialog)
  }
  setGameConfig({ ...replay, analyze: true, gameId }).then(
    launchedId => {
      if (launchedId) {
        ;(replacePage ? replace : push)(getGameStatsUrl(launchedId))
      } else if (isInActiveGame(getState().gameClient)) {
        // A game started while this was being set up, and the app won't replace it.
        notLaunched(openStarcraftInUseDialog())
      } else {
        logger.error(`StarCraft couldn't be started to analyze replay file [${replay.path}]`)
        notLaunched(analysisLaunchErrorDialog())
      }
    },
    err => {
      logger.error(`Error analyzing replay file [${replay.path}]: ${getErrorStack(err)}`)
      notLaunched(analysisLaunchErrorDialog())
    },
  )
}

function analysisLaunchErrorDialog() {
  return openSimpleDialog(
    i18n.t('replays.analysis.initFailureTitle', 'Error analyzing replay'),
    i18n.t(
      'replays.analysis.initFailureBody',
      "The selected replay couldn't be analyzed. It may be corrupt, or from a version of " +
        'StarCraft newer than this one supports.',
    ),
  )
}

export function showReplayInfo(filePath: string) {
  return openDialog({ type: DialogType.ReplayInfo, initData: { filePath } })
}
