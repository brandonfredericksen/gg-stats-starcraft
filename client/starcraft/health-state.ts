import { atom } from 'jotai'

export const starcraftPathValid = atom(false)
/** Whether StarCraft's path has been checked yet, so nothing claims it's missing before then. */
export const starcraftChecked = atom(false)

/** Whether StarCraft can be used, as far as is known: until it's been checked, it's assumed it can. */
export const starcraftHealthy = atom(get => !get(starcraftChecked) || get(starcraftPathValid))

export interface GgStatsFileStatus {
  init: boolean
  main: boolean
  init64: boolean
  main64: boolean
}

/** Which of GG Stats' own files are there, or undefined until they've been checked. */
export const ggStatsFilesState = atom<GgStatsFileStatus | undefined>(undefined)

/** Whether GG Stats' files are all there, as far as is known: until checked, it's assumed they are. */
export const ggStatsHealthy = atom(get => {
  const statuses = get(ggStatsFilesState)
  return !statuses || Object.values(statuses).every(status => status)
})
