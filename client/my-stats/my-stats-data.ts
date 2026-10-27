import { atom, useAtomValue } from 'jotai'
import { debounce } from 'lodash-es'
import { createContext, useContext, useEffect, useState } from 'react'
import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  computeMyStatsSummary,
  MyStatsQuery,
  MyStatsResult,
  MyStatsSummary,
  RANGE_MS,
} from '../../common/my-stats/my-stats'
import { ReplayLibraryFilters } from '../../common/replays-library'
import logger from '../logging/logger'
import { getDemoGames, useDemoPlayer } from './demo-player'

const ipcRenderer = new TypedIpcRenderer()

/** How long to wait after a change to the saved stats or the library before asking again. */
const REFRESH_DELAY_MS = 500

export type MyStatsFilters = Omit<MyStatsQuery, 'names'>

/** Set while My stats shows another player's games, so its words say them rather than you. */
export const OtherPlayerContext = createContext(false)

export function useShowsOtherPlayer() {
  return useContext(OtherPlayerContext)
}

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
  /** Their eSkill and latest 1v1 ladder rank, whatever the filters. */
  eSkill: MyStatsSummary['eSkill']
  ladder: MyStatsSummary['ladder']
}

async function fetchMyStats(names: string[], filters: MyStatsFilters): Promise<MyStatsData> {
  const [summary, library] = await Promise.all([
    ipcRenderer.invoke('myStatsQuery', { names, ...filters }),
    // Leaves out short games, the same as the analyzed count next to this one.
    ipcRenderer.invoke('replayLibraryQuery', { ...getLibraryFilters(names, filters), limit: 1 }),
  ])
  if (!summary || !library) {
    throw new Error("My stats couldn't be loaded")
  }
  return toMyStatsData(summary, library.total)
}

function toMyStatsData(summary: MyStatsSummary, libraryTotal: number): MyStatsData {
  return {
    stats: summary.stats,
    analyzedGames: summary.analyzedGames,
    scope: {
      analyzed: summary.scopedGames,
      total: Math.max(libraryTotal, summary.scopedGames),
    },
    eSkill: summary.eSkill,
    ladder: summary.ladder,
  }
}

/** The made up player's stats, worked out here since the app doesn't have their games. */
function computeDemoStats(names: string[], filters: MyStatsFilters): MyStatsData {
  const summary = computeMyStatsSummary(getDemoGames(), { names, ...filters }, Date.now())
  return toMyStatsData(summary, summary.scopedGames)
}

export interface MyStatsLoad {
  /** The latest stats, which may be for filters picked before the current ones. */
  data?: MyStatsData
  /** Whether `data` is for the filters picked now. */
  current: boolean
  /** Set when the latest try to load failed. */
  failed: boolean
  retry: () => void
}

/**
 * Sums up the games of whoever goes by `names` for the picked filters, again whenever games are
 * analyzed or the library changes. Another player's are never the made up player's.
 */
export function useMyStats(names: ReadonlyArray<string> | undefined, other = false): MyStatsLoad {
  const filters = useAtomValue(myStatsFiltersAtom)
  const demo = useDemoPlayer() && !other
  const namesKey = names?.join('\n') ?? ''
  const [loaded, setLoaded] = useState<{
    data: MyStatsData
    filters: MyStatsFilters
    namesKey: string
  }>()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!namesKey) {
      return undefined
    }
    const names = namesKey.split('\n')
    let current = true
    const load = () => {
      Promise.resolve()
        .then(() => (demo ? computeDemoStats(names, filters) : fetchMyStats(names, filters)))
        .then(result => {
          if (current) {
            setLoaded({ data: result, filters, namesKey })
            setFailed(false)
          }
        })
        .catch(err => {
          logger.error(`Error loading My stats: ${getErrorStack(err)}`)
          if (current) {
            setFailed(true)
          }
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
  }, [namesKey, filters, demo, attempt])

  // Someone else's stats are never shown in place of these, not even while these load.
  const ours = loaded?.namesKey === namesKey ? loaded : undefined
  return {
    data: ours?.data,
    current: ours?.filters === filters,
    failed,
    retry: () => {
      setFailed(false)
      setAttempt(a => a + 1)
    },
  }
}
