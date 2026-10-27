import { useEffect, useState } from 'react'
import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import { SeenPlayerRanks } from '../../common/player-ranks'
import logger from '../logging/logger'

const ipcRenderer = new TypedIpcRenderer()

/**
 * The ranks the app has seen in the profiles of whoever goes by any of `accounts`, again whenever
 * another profile is seen. Undefined while they load.
 */
export function usePlayerRanks(accounts: ReadonlyArray<string>): SeenPlayerRanks[] | undefined {
  const key = accounts.join('\n')
  const [loaded, setLoaded] = useState<{ key: string; ranks: SeenPlayerRanks[] }>()

  useEffect(() => {
    let current = true
    const load = () => {
      Promise.resolve(ipcRenderer.invoke('playerRanksGet', key.split('\n')))
        .then(ranks => {
          if (current) {
            setLoaded({ key, ranks: ranks ?? [] })
          }
        })
        .catch(err => {
          logger.error(`Error loading player ranks: ${getErrorStack(err)}`)
          if (current) {
            setLoaded({ key, ranks: [] })
          }
        })
    }
    load()
    ipcRenderer.on('playerRanksChanged', load)
    return () => {
      current = false
      ipcRenderer.removeListener('playerRanksChanged', load)
    }
  }, [key])

  return loaded?.key === key ? loaded.ranks : undefined
}
