import { atom, useAtomValue } from 'jotai'
import { debounce } from 'lodash-es'
import { useEffect, useState } from 'react'
import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import { CoachResult, CoachScope, CoachWindow, computeCoach } from '../../common/my-stats/coach'
import { MyStatsShape } from '../../common/my-stats/my-stats'
import { ReplayLibraryFilters } from '../../common/replays-library'
import { autoCaptureStatusAtom } from '../games/replay-stats-status'
import logger from '../logging/logger'
import { getDemoGames, useDemoPlayer, useStatsPlayerNames } from '../my-stats/demo-player'
import { getLibraryFilters, myStatsFiltersAtom } from '../my-stats/my-stats-data'
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
 * The coach's look at the picked kind of game, again whenever games are analyzed, or `error` when
 * it couldn't be worked out. `retry` asks again.
 */
export function useCoach(): { coach: CoachResult | 'error' | undefined; retry: () => void } {
  const names = useStatsPlayerNames()
  const scope = useAtomValue(coachScopeAtom)
  const window = useAtomValue(coachWindowAtom)
  const mapKey = useAtomValue(coachMapAtom)
  // Only a floor the user picked; otherwise the coach picks one from how fast they play.
  const eapmFloor = useAtomValue(myStatsFiltersAtom).eapmFloor
  const demo = useDemoPlayer()
  const [data, setData] = useState<CoachResult | 'error'>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!names?.length) {
      return undefined
    }
    let current = true
    const load = () => {
      const query = { names: [...names], ...scope, mapKey, eapmFloor, window }
      Promise.resolve()
        .then(() =>
          demo ? computeCoach(getDemoGames(), query) : ipcRenderer.invoke('coachQuery', query),
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
  }, [names, scope, mapKey, eapmFloor, window, demo, attempt])

  return { coach: data, retry: () => setAttempt(a => a + 1) }
}
