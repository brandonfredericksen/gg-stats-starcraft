import { GgStatsFile } from '../../common/gg-stats-file'
import { TypedIpcRenderer } from '../../common/ipc'
import { jotaiStore } from '../jotai-store'
import { ggStatsFilesState, ggStatsHealthy } from './health-state'

const ipcRenderer = new TypedIpcRenderer()

/** Checks that GG Stats' own files are there. Resolves to whether they all are. */
export async function checkGgStatsFiles(): Promise<boolean> {
  const fileResults = await ipcRenderer.invoke('ggStatsCheckFiles')
  if (fileResults) {
    const filesMap = new Map(fileResults)
    jotaiStore.set(ggStatsFilesState, {
      init: filesMap.get(GgStatsFile.Init) ?? false,
      main: filesMap.get(GgStatsFile.Main) ?? false,
      init64: filesMap.get(GgStatsFile.Init64) ?? false,
      main64: filesMap.get(GgStatsFile.Main64) ?? false,
    })
  }
  return jotaiStore.get(ggStatsHealthy)
}
