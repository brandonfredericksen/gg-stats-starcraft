import { getErrorStack } from '../../common/errors'
import { ThunkAction } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import logger from '../logging/logger'
import { push } from '../navigation/routing'
import { analyzeReplay } from '../replays/action-creators'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import { findNewestOwnGame } from './own-games-needed'

/**
 * Shows the stats for the newest game the user played in, analyzing it first if it hasn't been.
 * Without one, shows why: no names set, or no replay with those names.
 */
export function openLastGame(): ThunkAction {
  return (dispatch, getState) => {
    findNewestOwnGame(getState().settings.local.myPlayerNames)
      .then(result => {
        if (result.state === 'found') {
          const { entry } = result
          dispatch(
            analyzeReplay({
              path: entry.path,
              name: entry.fileName,
              linkedGameId: entry.linkedGameId,
            }),
          )
        } else {
          push('/last-game')
        }
      })
      .catch(err => {
        logger.error(`Error finding the newest replay: ${getErrorStack(err)}`)
        externalShowSnackbar(i18n.t('lastGame.error', "Couldn't find your last game."))
      })
  }
}
