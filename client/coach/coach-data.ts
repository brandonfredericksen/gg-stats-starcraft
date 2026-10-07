import { atom, useAtomValue } from 'jotai'
import { debounce } from 'lodash-es'
import { useEffect, useState } from 'react'
import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  CoachQuery,
  CoachResult,
  CoachScope,
  CoachWindow,
  computeCoach,
  DEFAULT_EAPM_FLOOR,
} from '../../common/my-stats/coach'
import { MyStatsRange, MyStatsShape, RANGE_MS } from '../../common/my-stats/my-stats'
import { ReplayLibraryFilters } from '../../common/replays-library'
import { autoCaptureStatusAtom } from '../games/replay-stats-status'
import logger from '../logging/logger'
import { getDemoGames, useDemoPlayer, useStatsPlayerNames } from '../my-stats/demo-player'
import { getLibraryFilters, MyStatsFilters, myStatsFiltersAtom } from '../my-stats/my-stats-data'
import { countNotAnalyzed } from '../replays/analyze-latest'

const ipcRenderer = new TypedIpcRenderer()

/** How long to wait after a change to the saved stats or the library before asking again. */
const REFRESH_DELAY_MS = 500

/**
 * The kind of game picked on the Coach page, kept while the user looks at other pages. Until one is
 * picked, the coach looks at the one they play most.
 */
export const coachScopeAtom = atom<Omit<CoachScope, 'games'> | undefined>(undefined)

/**
 * One map to coach, in a game type that doesn't split by map, see `getMapKey`. Picking another
 * game type clears it.
 */
export const coachMapAtom = atom<string | undefined>(undefined)

/** Which of the user's games the coach looks at, kept while the user looks at other pages. */
export const coachWindowAtom = atom<CoachWindow>('auto')

/**
 * A game type with no analyzed games to coach yet, picked to see how many of its replays are
 * analyzed. Picking a kind of game to coach clears it.
 */
export const coachLockedShapeAtom = atom<MyStatsShape | undefined>(undefined)

const ALL_SHAPES: ReadonlyArray<MyStatsShape> = ['1v1', '2v2', '3v3', '4v4', 'ffa']

/** How many of the user's replays of a game type are analyzed. */
export interface ShapeCount {
  shape: MyStatsShape
  /** The user's replays of this type that are analyzed, waiting or being analyzed. */
  analyzed: number
  /** The user's replays of this type. */
  total: number
}

async function countReplays(filters: ReplayLibraryFilters) {
  const result = await ipcRenderer.invoke('replayLibraryQuery', { ...filters, offset: 0, limit: 1 })
  return result?.total ?? 0
}

/** The made up player's games of each type, every one of them analyzed. */
function countDemoShapes(): ShapeCount[] {
  const games = getDemoGames()
  return ALL_SHAPES.flatMap(shape => {
    const total = games.filter(game => game.shape === shape).length
    return total ? [{ shape, analyzed: total, total }] : []
  })
}

/**
 * Every game type in the user's replays, with how many of each are analyzed. The library can't
 * tell the user's race, so these are only split by game type.
 */
export function useShapeCounts(): ShapeCount[] {
  const names = useStatsPlayerNames()
  const demo = useDemoPlayer()
  const status = useAtomValue(autoCaptureStatusAtom)
  const [data, setData] = useState<ShapeCount[]>([])

  // Counted again whenever the waiting list changes, since waiting games count as analyzed.
  const pendingKey = status.queued.length + (status.running ?? '')

  useEffect(() => {
    if (!names?.length) {
      return undefined
    }
    let current = true
    const counting = demo
      ? Promise.resolve(countDemoShapes())
      : Promise.all(
          ALL_SHAPES.map(async shape => {
            const filters = getLibraryFilters(names, { range: 'all', shape })
            const [total, notAnalyzed] = await Promise.all([
              countReplays(filters),
              countNotAnalyzed(filters),
            ])
            return { shape, analyzed: total - notAnalyzed, total }
          }),
        )
    counting
      .then(result => {
        if (current) {
          setData(result.filter(count => count.total > 0))
        }
      })
      .catch(err => {
        logger.error(`Error counting replays for the coach: ${getErrorStack(err)}`)
      })
    return () => {
      current = false
    }
  }, [names, pendingKey, demo])

  return data
}

/**
 * The coach's look at a kind of game, again whenever games are analyzed, or `error` when it
 * couldn't be worked out. Nothing is asked without a query. `retry` asks again.
 */
function useCoachResult(query: Omit<CoachQuery, 'names'> | undefined, range?: MyStatsRange) {
  const names = useStatsPlayerNames()
  const demo = useDemoPlayer()
  const [data, setData] = useState<CoachResult | 'error'>()
  const [attempt, setAttempt] = useState(0)
  // By value, so a query built anew each render doesn't ask again.
  const queryKey = query ? JSON.stringify(query) : undefined

  useEffect(() => {
    if (!names?.length || queryKey === undefined) {
      return undefined
    }
    let current = true
    const load = () => {
      // Worked out on each load, so the range keeps up with the clock.
      const rangeMs = range ? RANGE_MS[range] : undefined
      const full: CoachQuery = {
        names: [...names],
        ...JSON.parse(queryKey),
        fromMs: rangeMs === undefined ? undefined : Date.now() - rangeMs,
      }
      Promise.resolve()
        .then(() =>
          demo ? computeCoach(getDemoGames(), full) : ipcRenderer.invoke('coachQuery', full),
        )
        .then(result => {
          if (current && result) {
            setData(result)
          }
        })
        .catch(err => {
          logger.error(`Error loading the coach: ${getErrorStack(err)}`)
          if (current) {
            setData('error')
          }
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
  }, [names, queryKey, range, demo, attempt])

  return { coach: queryKey === undefined ? undefined : data, retry: () => setAttempt(a => a + 1) }
}

/**
 * The coach's look at the picked kind of game, again whenever games are analyzed, or `error` when
 * it couldn't be worked out. `retry` asks again.
 */
export function useCoach(): { coach: CoachResult | 'error' | undefined; retry: () => void } {
  const scope = useAtomValue(coachScopeAtom)
  const window = useAtomValue(coachWindowAtom)
  const mapKey = useAtomValue(coachMapAtom)
  // Only a floor the user picked; otherwise the coach picks one from how fast they play.
  const eapmFloor = useAtomValue(myStatsFiltersAtom).eapmFloor
  return useCoachResult({ ...scope, mapKey, eapmFloor, window })
}

/**
 * Whether My stats' filters pick one kind of game, which the coach's numbers need: a game type,
 * the user's race, and in 1v1, the opponent's.
 */
export function picksOneKind(filters: MyStatsFilters) {
  return !!filters.shape && !!filters.race && (filters.shape !== '1v1' || !!filters.opponentRace)
}

/**
 * The coach's numbers for the games My stats' filters pick, every one of them in the time range,
 * against other players at the floor the filters show. Undefined until the filters pick one kind
 * of game, see `picksOneKind`.
 */
export function useFilteredCoach() {
  const filters = useAtomValue(myStatsFiltersAtom)
  const { shape, race, opponentRace, mapFamily, range } = filters
  return useCoachResult(
    picksOneKind(filters)
      ? {
          shape,
          race,
          opponentRace,
          mapFamily,
          eapmFloor: filters.eapmFloor ?? DEFAULT_EAPM_FLOOR,
          window: 'all',
        }
      : undefined,
    range,
  )
}
