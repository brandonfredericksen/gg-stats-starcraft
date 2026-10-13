import { useRoute } from 'wouter'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  DEFAULT_LOCAL_SETTINGS,
  DEFAULT_SCR_SETTINGS,
} from '../../common/settings/default-settings'
import { LocalSettings, ScrSettings } from '../../common/settings/local-settings'
import { urlPath } from '../../common/urls'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { ThunkAction } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import { push } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import { SettingsPage } from './settings-page'

const ipcRenderer = new TypedIpcRenderer()

/** Returns whether the settings page is the one showing. */
export function useIsSettingsOpen(): boolean {
  const [isOpen] = useRoute('/settings')
  return isOpen
}

/** Goes to the settings page, scrolled to the given group of settings if there is one. */
export function openSettings(page?: SettingsPage): ThunkAction {
  return () => {
    push(page ? urlPath`/settings?page=${page}` : '/settings')
  }
}

/** Leaves the settings page for wherever it was opened from. */
export function closeSettings(): ThunkAction {
  return () => {
    if (location.pathname === '/settings') {
      history.back()
    }
  }
}

export function mergeLocalSettings(
  settings: Partial<LocalSettings>,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    try {
      await ipcRenderer.invoke('settingsLocalMerge', settings)
    } catch (err) {
      externalShowSnackbar(
        i18n.t('settings.errors.save', 'There was an issue saving the settings.'),
        { tone: 'error' },
      )
    }
  })
}

export function mergeScrSettings(
  settings: Partial<ScrSettings>,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    try {
      await ipcRenderer.invoke('settingsScrMerge', settings)
    } catch (err) {
      externalShowSnackbar(
        i18n.t('settings.errors.save', 'There was an issue saving the settings.'),
        { tone: 'error' },
      )
    }
  })
}

/**
 * The local settings for watching replays, which Reset to defaults puts back along with every one
 * of the game's own settings. Where the game window goes isn't one of them.
 */
const REPLAY_VIEWING_LOCAL_KEYS = [
  'useCustomCursorSize',
  'customCursorSize',
  'legacyCursorSizing',
  'grabPanSensitivityOn',
  'grabPanSensitivity',
  'grabPanInverted',
  'startingFog',
  'minimapColorMode',
  'teamColorPreset',
  'teamColorUsage',
  'teamSelfColor',
  'ffaColorPreset',
  'ffaSelfColor',
  'shuffleColors',
  'customTeamColors',
  'customFfaColors',
] as const satisfies ReadonlyArray<keyof LocalSettings>

/** Asks, then puts every setting for watching replays back to how GG Stats starts. */
export function confirmResetReplayViewing(): ThunkAction {
  return dispatch => {
    dispatch(
      openDialog({
        type: DialogType.Confirm,
        initData: {
          confirmTitle: i18n.t('settings.replayViewing.resetTitle', 'Reset to defaults?'),
          confirmBody: i18n.t(
            'settings.replayViewing.resetBody',
            'Every setting for watching replays goes back to how GG Stats starts.',
          ),
          confirmLabel: i18n.t('settings.replayViewing.resetConfirm', 'Reset'),
          onConfirm: () => {
            const local = Object.fromEntries(
              REPLAY_VIEWING_LOCAL_KEYS.map(key => [
                key,
                structuredClone(DEFAULT_LOCAL_SETTINGS[key]),
              ]),
            ) as Partial<LocalSettings>
            const spec = { onSuccess: () => {}, onError: () => {} }
            dispatch(mergeLocalSettings(local, spec))
            dispatch(mergeScrSettings(structuredClone(DEFAULT_SCR_SETTINGS) as ScrSettings, spec))
          },
        },
      }),
    )
  }
}
