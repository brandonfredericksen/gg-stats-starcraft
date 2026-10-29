import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { TypedIpcRenderer } from '../../common/ipc'
import { LocalSettings } from '../../common/settings/local-settings'
import { dispatch } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import { getAppLanguage } from '../i18n/language-detector'
import { jotaiStore } from '../jotai-store'
import { checkGgStatsFiles } from '../starcraft/check-gg-stats-files-ipc'
import { ggStatsHealthy, starcraftChecked, starcraftPathValid } from '../starcraft/health-state'

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  let lastPath = ''
  let lastPathWasValid = false
  const checkStarcraftPath = (starcraftPath: string) => {
    lastPath = starcraftPath
    lastPathWasValid = false
    ipcRenderer
      .invoke('settingsCheckStarcraftPath', starcraftPath)
      ?.then(result => {
        lastPathWasValid = result.path
        jotaiStore.set(starcraftPathValid, result.path)
        jotaiStore.set(starcraftChecked, true)
      })
      .catch(swallowNonBuiltins)
  }
  const afterLocalSettingsChange = (settings: Partial<LocalSettings>) => {
    // Until i18next is initialized it's still being set up with the chosen language, read from the
    // same settings.
    if (i18n.isInitialized) {
      const language = getAppLanguage(settings.language)
      if (i18n.language !== language) {
        i18n.changeLanguage(language).catch(swallowNonBuiltins)
      }
    }
    if (settings.starcraftPath !== lastPath || !lastPathWasValid) {
      checkStarcraftPath(settings.starcraftPath ?? '')
    }
  }

  // Coming back to the window is when a problem may have been fixed elsewhere, like StarCraft
  // installed or files restored from quarantine, so anything wrong is checked again then.
  window.addEventListener('focus', () => {
    if (!lastPathWasValid) {
      checkStarcraftPath(lastPath)
    }
    if (!jotaiStore.get(ggStatsHealthy)) {
      checkGgStatsFiles().catch(swallowNonBuiltins)
    }
  })

  ipcRenderer.on('settingsLocalChanged', (event, settings) => {
    dispatch({
      type: '@settings/updateLocalSettings',
      payload: settings,
    })

    afterLocalSettingsChange(settings)
  })

  // Trigger an initial update for the settings
  ipcRenderer
    .invoke('settingsLocalGet')
    ?.then(settings => {
      dispatch({
        type: '@settings/updateLocalSettings',
        payload: settings,
      })

      afterLocalSettingsChange(settings)
    })
    .catch(swallowNonBuiltins)

  checkGgStatsFiles().catch(swallowNonBuiltins)
}
