import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { GgStatsFile } from '../../common/gg-stats-file'
import { TypedIpcRenderer } from '../../common/ipc'
import { jotaiStore } from '../jotai-store'
import { ggStatsFilesState } from './health-state'

const ipcRenderer = new TypedIpcRenderer()

export function checkGgStatsFiles() {
  ipcRenderer
    .invoke('ggStatsCheckFiles')
    ?.then(fileResults => {
      const filesMap = new Map(fileResults)
      jotaiStore.set(ggStatsFilesState, {
        init: filesMap.get(GgStatsFile.Init) ?? false,
        main: filesMap.get(GgStatsFile.Main) ?? false,
        init64: filesMap.get(GgStatsFile.Init64) ?? false,
        main64: filesMap.get(GgStatsFile.Main64) ?? false,
      })
    })
    .catch(swallowNonBuiltins)
}
