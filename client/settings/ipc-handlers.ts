import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { TypedIpcRenderer } from '../../common/ipc'
import { LocalSettings } from '../../common/settings/local-settings'
import { dispatch } from '../dispatch-registry'
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

  ipcRenderer
    .on('settingsLocalChanged', (event, settings) => {
      dispatch({
        type: '@settings/updateLocalSettings',
        payload: settings,
      })

      afterLocalSettingsChange(settings)
    })
    .on('settingsScrChanged', (event, settings) => {
      dispatch({
        type: '@settings/updateScrSettings',
        payload: settings,
      })
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
  ipcRenderer
    .invoke('settingsScrGet')
    ?.then(settings => {
      dispatch({
        type: '@settings/updateScrSettings',
        payload: settings,
      })
    })
    .catch(swallowNonBuiltins)

  checkGgStatsFiles().catch(swallowNonBuiltins)
}
