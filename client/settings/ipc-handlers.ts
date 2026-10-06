import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { TypedIpcRenderer } from '../../common/ipc'
import { LocalSettings } from '../../common/settings/local-settings'
import { dispatch } from '../dispatch-registry'
import { jotaiStore } from '../jotai-store'
import { checkGgStatsFiles } from '../starcraft/check-gg-stats-files-ipc'
import {
  starcraftChecked,
  starcraftPathValid,
  starcraftVersionValid,
} from '../starcraft/health-state'

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  let lastPath = ''
  let lastPathWasValid = false
  const afterLocalSettingsChange = (settings: Partial<LocalSettings>) => {
    if (settings.starcraftPath === lastPath && lastPathWasValid) {
      return
    }

    lastPath = settings.starcraftPath ?? ''
    lastPathWasValid = false
    ipcRenderer
      .invoke('settingsCheckStarcraftPath', lastPath)
      ?.then(result => {
        lastPathWasValid = result.path && result.version
        jotaiStore.set(starcraftPathValid, result.path)
        jotaiStore.set(starcraftVersionValid, result.version)
        jotaiStore.set(starcraftChecked, true)
      })
      .catch(swallowNonBuiltins)
  }

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

  checkGgStatsFiles()
}
