import { atom, useAtomValue } from 'jotai'
import { debounce } from 'lodash-es'
import { useEffect, useState } from 'react'
import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import { CoachResult, CoachScope, DEFAULT_EAPM_FLOOR } from '../../common/my-stats/coach'
import { useMyPlayerNames } from '../games/my-player-names'
import logger from '../logging/logger'
import { myStatsFiltersAtom } from '../my-stats/my-stats-data'

const ipcRenderer = new TypedIpcRenderer()

/** How long to wait after a change to the saved stats or the library before asking again. */
const REFRESH_DELAY_MS = 500

/**
 * The kind of game picked on the Coach page, kept while the user looks at other pages. Until one is
 * picked, the coach looks at the one they play most.
 */
export const coachScopeAtom = atom<Omit<CoachScope, 'games'> | undefined>(undefined)

/**
 * The EAPM other players need to count. My stats compares with the same players, so both pages
 * share it.
 */
export function useEapmFloor() {
  return useAtomValue(myStatsFiltersAtom).eapmFloor ?? DEFAULT_EAPM_FLOOR
}

/** The coach's look at the picked kind of game, again whenever games are analyzed. */
export function useCoach(): CoachResult | undefined {
  const names = useMyPlayerNames()
  const scope = useAtomValue(coachScopeAtom)
  const eapmFloor = useEapmFloor()
  const [data, setData] = useState<CoachResult>()

  useEffect(() => {
    if (!names?.length) {
      return undefined
    }
    let current = true
    const load = () => {
      Promise.resolve(ipcRenderer.invoke('coachQuery', { names: [...names], ...scope, eapmFloor }))
        .then(result => {
          if (current && result) {
            setData(result)
          }
        })
        .catch(err => {
          logger.error(`Error loading the coach: ${getErrorStack(err)}`)
        })
    }
    load()

    const refresh = debounce(load, REFRESH_DELAY_MS)
    ipcRenderer.on('activeGameStats', refresh)
    ipcRenderer.on('myStatsChanged', refresh)
    return () => {
      current = false
      refresh.cancel()
      ipcRenderer.removeListener('activeGameStats', refresh)
      ipcRenderer.removeListener('myStatsChanged', refresh)
    }
  }, [names, scope, eapmFloor])

  return data
}
