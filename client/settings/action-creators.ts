import { useRoute } from 'wouter'
import { TypedIpcRenderer } from '../../common/ipc'
import { LocalSettings, ScrSettings } from '../../common/settings/local-settings'
import { urlPath } from '../../common/urls'
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
      )
    }
  })
}
