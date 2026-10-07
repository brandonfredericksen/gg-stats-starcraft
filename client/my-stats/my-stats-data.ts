import { atom, useAtomValue } from 'jotai'
import { debounce } from 'lodash-es'
import { useEffect, useState } from 'react'
import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  computeMyStats,
  MyStatsQuery,
  MyStatsResult,
  RANGE_MS,
} from '../../common/my-stats/my-stats'
import { ReplayLibraryFilters } from '../../common/replays-library'
import logger from '../logging/logger'
import { getDemoGames, useDemoPlayer, useStatsPlayerNames } from './demo-player'

const ipcRenderer = new TypedIpcRenderer()

/** How long to wait after a change to the saved stats or the library before asking again. */
const REFRESH_DELAY_MS = 500

export type MyStatsFilters = Omit<MyStatsQuery, 'names'>

/** The filters picked on My stats, kept while the user looks at other pages. */
export const myStatsFiltersAtom = atom<MyStatsFilters>({ range: 'all' })

/**
 * The library filters for the user's games that My stats' filters pick. The library can't tell the
 * user's race from the opponent's, so race filters are left out.
 */
export function getLibraryFilters(names: ReadonlyArray<string>, filters: MyStatsFilters) {
  const result: ReplayLibraryFilters = { whose: { names: [...names], match: 'mine' } }
  switch (filters.shape) {
    case '1v1':
    case '2v2':
    case 'ffa':
      result.teams = filters.shape
      break
    case '3v3':
    case '4v4':
      result.format = filters.shape
      break
    case undefined:
      break
    default:
      filters.shape satisfies never
  }
  const rangeMs = RANGE_MS[filters.range]
  if (rangeMs !== undefined) {
    result.gameTimeFrom = Date.now() - rangeMs
  }
  return result
}

export interface MyStatsData {
  /** The user's analyzed games that match the filters, summed up. */
  stats: MyStatsResult
  /** The user's analyzed games, whatever the filters. */
  analyzedGames: number
  /**
   * The user's games of the picked game type and time range, analyzed and in all. Race filters
   * are left out, since the library can't tell the user's race from an opponent's.
   */
  scope: { analyzed: number; total: number }
}

async function fetchMyStats(names: string[], filters: MyStatsFilters): Promise<MyStatsData> {
  const [stats, all, scoped, library] = await Promise.all([
    ipcRenderer.invoke('myStatsQuery', { names, ...filters }),
    ipcRenderer.invoke('myStatsQuery', { names, range: 'all' }),
    ipcRenderer.invoke('myStatsQuery', { names, range: filters.range, shape: filters.shape }),
    ipcRenderer.invoke('replayLibraryQuery', { ...getLibraryFilters(names, filters), limit: 1 }),
  ])
  if (!stats || !all || !scoped || !library) {
    throw new Error("My stats couldn't be loaded")
  }
  return {
    stats,
    analyzedGames: all.games,
    scope: { analyzed: scoped.games, total: Math.max(library.total, scoped.games) },
  }
}

/** The made up player's stats, worked out here since the app doesn't have their games. */
function computeDemoStats(names: string[], filters: MyStatsFilters): MyStatsData {
  const games = getDemoGames()
  const now = Date.now()
  const stats = computeMyStats(games, { names, ...filters }, now)
  const scoped = computeMyStats(games, { names, range: filters.range, shape: filters.shape }, now)
  return {
    stats,
    analyzedGames: computeMyStats(games, { names, range: 'all' }, now).games,
    scope: { analyzed: scoped.games, total: scoped.games },
  }
}

/**
 * Sums up the user's games for the picked filters, again whenever games are analyzed or the
 * library changes.
 */
export function useMyStats(): MyStatsData | undefined {
  const names = useStatsPlayerNames()
  const filters = useAtomValue(myStatsFiltersAtom)
  const demo = useDemoPlayer()
  const [data, setData] = useState<MyStatsData>()

  useEffect(() => {
    if (!names?.length) {
      return undefined
    }
    let current = true
    const load = () => {
      Promise.resolve()
        .then(() =>
          demo ? computeDemoStats([...names], filters) : fetchMyStats([...names], filters),
        )
        .then(result => {
          if (current) {
            setData(result)
          }
        })
        .catch(err => {
          logger.error(`Error loading My stats: ${getErrorStack(err)}`)
        })
    }
    load()

    const refresh = debounce(load, REFRESH_DELAY_MS)
    ipcRenderer.on('activeGameStats', refresh)
    ipcRenderer.on('replayLibraryChanged', refresh)
    ipcRenderer.on('myStatsChanged', refresh)
    return () => {
      current = false
      refresh.cancel()
      ipcRenderer.removeListener('activeGameStats', refresh)
      ipcRenderer.removeListener('replayLibraryChanged', refresh)
      ipcRenderer.removeListener('myStatsChanged', refresh)
    }
  }, [names, filters, demo])

  return data
}
