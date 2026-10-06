import { atom } from 'jotai'

export const starcraftPathValid = atom(false)
export const starcraftVersionValid = atom(false)
/** Whether StarCraft's path has been checked yet, so nothing claims it's missing before then. */
export const starcraftChecked = atom(false)

export const starcraftHealthy = atom(get => get(starcraftPathValid) && get(starcraftVersionValid))

export interface GgStatsFileStatus {
  init: boolean
  main: boolean
  init64: boolean
  main64: boolean
}

export const ggStatsFilesState = atom<GgStatsFileStatus>({
  init: false,
  main: false,
  init64: false,
  main64: false,
})

export const ggStatsHealthy = atom(get => {
  const statuses = get(ggStatsFilesState)
  return Object.values(statuses).every(status => status)
})
