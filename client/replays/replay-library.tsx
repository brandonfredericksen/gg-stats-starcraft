import { debounce } from 'lodash-es'
import * as React from 'react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GroupedVirtuoso, GroupedVirtuosoHandle, Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import styled from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getErrorStack } from '../../common/errors'
import {
  ALL_GAME_FORMATS,
  EncodedMatchupString,
  GameDurationFilter,
  GameFormat,
  GameSortOption,
} from '../../common/games/game-filters'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  ReplayBackfillProgress,
  ReplayLibraryEntry,
  ReplayLibraryFilters,
  ReplayLibraryStatus,
  ReplayTeamsFilter,
} from '../../common/replays-library'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { useContextMenu } from '../dom/use-context-menu'
import { DatePreset, getDatePresetStartMs, parseDatePreset } from '../games/date-range'
import { parseMatchup } from '../games/game-filter-url'
import { useMyPlayerNames } from '../games/my-player-names'
import { useReplaySummaries } from '../games/replay-stats-status'
import { useRememberedFilters } from '../games/use-remembered-filters'
import { useFormatLocale } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import logger from '../logging/logger'
import { TextButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover } from '../material/popover'
import { getTeamSlotWidth } from '../material/team-line'
import { useHistoryEntryKey, useLocationSearchParam } from '../navigation/router-hooks'
import { push } from '../navigation/routing'
import { createViewStateStore } from '../navigation/view-state-store'
import { useVirtuosoScrollMemory } from '../navigation/virtuoso-scroll-memory'
import { useRefreshToken } from '../network/refresh-token'
import { LoadingIndicatorArea } from '../progress/loading-indicator'
import { PageLoadingIndicator } from '../progress/page-loading'
import { useCurrentMinuteMs } from '../react/date-hooks'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { useAppDispatch } from '../redux-hooks'
import { openSettings } from '../settings/action-creators'
import { AppSettingsPage } from '../settings/settings-page'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../styles/centered-container'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { bodyLarge, bodyMedium, titleLarge } from '../styles/typography'
import { analyzeReplay, startReplay } from './action-creators'
import { analyzeEntries, AnalyzeLatestButton } from './analyze-latest'
import { BackfillProgressBar } from './backfill-progress'
import { GameRow, GroupHeader } from './game-row'
import { LibraryFilterRow } from './library-filter-row'
import { AnalysisFilter, LibraryToolbar, WhoseFilter } from './library-toolbar'
import { NamesPrompt } from './names-prompt'
import { getDaySummary, getDayTitle, groupReplaysByDay } from './replay-days'
import { encodeViewPathname, LibraryView } from './replay-library-helpers'
import {
  collapseSelection,
  findNeighborOutside,
  getSelectedIds,
  LibrarySelection,
  selectOnly,
  selectRangeTo,
  toggleInSelection,
} from './replay-library-selection'
import { getBulkReplayActionMenuItems, getReplayActionMenuItems } from './replay-menu-items'
import { SelectionBar } from './selection-bar'

const ipcRenderer = new TypedIpcRenderer()

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

/** Number of replay entries fetched per infinite-scroll chunk. */
const LOAD_CHUNK_SIZE = 100

// TTL must match useVirtuosoScrollMemory's: the saved scroll state and the saved entry window
// restore together, and a scroll restored into a missing window would clamp against a single
// fresh page. Both are stamped when the user leaves the page.
const WINDOW_MAX_AGE_MS = 30 * 60 * 1000

interface ReplayListWindow {
  entries: ReadonlyArray<ReplayLibraryEntry>
  total: number | undefined
}

const windowCache = createViewStateStore<ReplayListWindow>('replay-library', {
  maxAgeMs: WINDOW_MAX_AGE_MS,
})

const focusedIdCache = createViewStateStore<number>('replay-library-selection', {
  maxAgeMs: WINDOW_MAX_AGE_MS,
})

function parseDuration(value: string): GameDurationFilter {
  return Object.values(GameDurationFilter).includes(value as GameDurationFilter)
    ? (value as GameDurationFilter)
    : GameDurationFilter.All
}

function parseSort(value: string): GameSortOption {
  return Object.values(GameSortOption).includes(value as GameSortOption)
    ? (value as GameSortOption)
    : GameSortOption.LatestFirst
}

function parseFormat(value: string): GameFormat | undefined {
  return ALL_GAME_FORMATS.includes(value as GameFormat) ? (value as GameFormat) : undefined
}

const TEAMS_FILTERS: ReadonlyArray<ReplayTeamsFilter> = ['1v1', '2v2', 'bigTeams', 'ffa']

function parseTeams(value: string): ReplayTeamsFilter | undefined {
  return TEAMS_FILTERS.includes(value as ReplayTeamsFilter)
    ? (value as ReplayTeamsFilter)
    : undefined
}

function parseAnalysis(value: string): AnalysisFilter {
  return value === 'analyzed' || value === 'notAnalyzed' ? value : 'any'
}

function parseWhose(value: string): WhoseFilter {
  return value === 'mine' || value === 'others' ? value : 'all'
}

interface BuildFiltersParams {
  view: LibraryView
  sort: GameSortOption
  mapName: string
  duration: GameDurationFilter
  format: GameFormat | undefined
  matchup: EncodedMatchupString | undefined
  date: DatePreset | undefined
  includeShort: boolean
  teams: ReplayTeamsFilter | undefined
  analysis: AnalysisFilter
  search: string
  whose: WhoseFilter
  myNames: ReadonlyArray<string> | undefined
}

/** Assembles the query filters (everything but paging) from the current view and filter/sort values. */
function buildFilters({
  view,
  sort,
  mapName,
  duration,
  format,
  matchup,
  date,
  includeShort,
  teams,
  analysis,
  search,
  whose,
  myNames,
}: BuildFiltersParams): ReplayLibraryFilters {
  const filters: ReplayLibraryFilters = {}
  if (view.kind === 'bookmarked') {
    filters.bookmarked = true
  }
  filters.sort = sort
  if (mapName) filters.mapName = mapName
  if (duration !== GameDurationFilter.All) filters.duration = duration
  if (format !== undefined) {
    filters.format = format
    if (matchup) filters.matchup = matchup
  }
  if (date) filters.gameTimeFrom = getDatePresetStartMs(date, Date.now())
  if (includeShort) filters.includeShort = true
  if (teams) filters.teams = teams
  if (analysis !== 'any') filters.analysis = analysis
  if (search) filters.search = search
  if (whose !== 'all' && myNames?.length) {
    filters.whose = { names: [...myNames], match: whose }
  }
  return filters
}

// ---- Layout ----------------------------------------------------------------------------------

const PageColumn = styled.div`
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  min-height: 100%;
  padding: 28px 32px 64px;

  display: flex;
  flex-direction: column;
  gap: 22px;
`

const ListColumn = styled.div`
  min-width: 0;

  /* Named container so rows can adapt to the width they actually get. */
  container: game-list-rows / inline-size;
`

/** The top of the single panel a list sorted by something other than time sits in. */
function FlatListHeader({ context }: { context?: { title: string; summary: string } }) {
  return context ? <GroupHeader title={context.title} summary={context.summary} /> : null
}

// ---- Empty / loading states ------------------------------------------------------------------

const CenteredState = styled.div`
  ${bodyLarge};

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;

  min-height: 320px;
  padding: 32px;
  text-align: center;

  color: var(--theme-on-surface-variant);
`

const ShortGamesNote = styled.div`
  ${bodyMedium};
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: -8px;
  color: var(--theme-on-surface-variant);
`

const EmptyStateTitle = styled.div`
  ${titleLarge};
  color: var(--theme-on-surface);
`

const EmptyStatePath = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
  word-break: break-all;
`

const UnavailableIcon = styledWithAttrs(MaterialIcon, { icon: 'error', size: 40 })`
  color: var(--theme-error);
`

/**
 * Shown when the main-process replay library service isn't answering (its IPC handlers never
 * registered, e.g. because the SQLite module failed to load), so there's nothing to query.
 */
export function ReplayLibraryUnavailable() {
  const { t } = useTranslation()
  return (
    <CenteredState>
      <UnavailableIcon />
      <EmptyStateTitle>
        {t('replays.library.unavailable', 'Replay library unavailable')}
      </EmptyStateTitle>
      <div>
        {t(
          'replays.library.unavailableBody',
          "Your replays couldn't be loaded right now. Restarting GG Stats usually fixes this.",
        )}
      </div>
    </CenteredState>
  )
}

// ---- Main component --------------------------------------------------------------------------

export interface ReplayLibraryProps {
  view: LibraryView
}

export function ReplayLibrary({ view }: ReplayLibraryProps) {
  const { t } = useTranslation()
  const locale = useFormatLocale()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()

  const entryKey = useHistoryEntryKey()
  // Read once per mount: the store contract allows a lazy initializer since it runs at most once
  // and so never re-reads on a re-render.
  const [initialWindow] = useState(() =>
    entryKey !== undefined ? windowCache.get(entryKey) : undefined,
  )

  const [entries, setEntries] = useState<ReadonlyArray<ReplayLibraryEntry> | undefined>(
    initialWindow?.entries,
  )
  const [total, setTotal] = useState<number | undefined>(initialWindow?.total)
  const [isLoadingNext, setIsLoadingNext] = useState(false)
  const [hiddenShort, setHiddenShort] = useState(0)
  const [status, setStatus] = useState<ReplayLibraryStatus>()
  const [backfill, setBackfill] = useState<ReplayBackfillProgress>()
  // Set when the status query rejects, which in practice means the main-process replay library
  // service failed to start (e.g. the SQLite module couldn't load) and none of its IPC handlers are
  // registered — so every query would hang. We surface that instead of spinning forever.
  const [unavailable, setUnavailable] = useState(false)
  const [observerToken, restartObserver] = useRefreshToken()

  // Only the focused row persists across visits; a multi-selection is dropped on leaving.
  const [selection, setSelection] = useState<LibrarySelection>(() =>
    selectOnly(entryKey !== undefined ? focusedIdCache.get(entryKey) : undefined),
  )
  const focusedId = selection.focusedId
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null)
  const groupedRef = useRef<GroupedVirtuosoHandle>(null)
  const flatRef = useRef<VirtuosoHandle>(null)

  // Only one of the two lists is mounted at a time (see `useFlatList`), so state capture reads
  // whichever handle is live.
  const [virtuosoStateRef] = useState(() => ({
    get current(): GroupedVirtuosoHandle | VirtuosoHandle | null {
      return groupedRef.current ?? flatRef.current
    },
  }))
  const restoredSnapshot = useVirtuosoScrollMemory(scrollParent, virtuosoStateRef)
  // A filter/sort change replaces the URL in place, keeping the same visit key, so the snapshot
  // captured for this entry no longer matches the list contents once any reset happens — after
  // that it must not re-apply when the (remounting) list comes back with new data. View changes
  // don't hit this: they push a new pathname and remount the component under a new visit.
  const [snapshotInvalidated, setSnapshotInvalidated] = useState(false)
  const restoreStateFrom = snapshotInvalidated ? undefined : restoredSnapshot
  // The list fills in its rows a few frames after it mounts, once it has measured them. Until then
  // it renders one row to measure, or none while it restores where it was scrolled to.
  const [rowsMeasured, setRowsMeasured] = useState(false)
  const onItemsRendered = (items: ReadonlyArray<{ size: number }>) => {
    if (items.some(item => item.size)) {
      setRowsMeasured(true)
    }
  }

  // Right-click on a row selects it and opens this menu at the cursor.
  const { onContextMenu: openRowContextMenu, contextMenuPopoverProps } = useContextMenu()

  // Guards against IPC responses for a query that's since been superseded by a `reset()` (e.g. the
  // user changed filters while a request was in flight).
  const queryEpochRef = useRef(0)

  const [durationParam, setDurationParam] = useLocationSearchParam('duration')
  const [sortParam, setSortParam] = useLocationSearchParam('sort')
  const [mapName, setMapNameParam] = useLocationSearchParam('mapName')
  const [formatParam, setFormatParam] = useLocationSearchParam('format')
  const [matchupParam, setMatchupParam] = useLocationSearchParam('matchup')
  const [dateParam, setDateParam] = useLocationSearchParam('date')
  const [includeShortParam, setIncludeShortParam] = useLocationSearchParam('includeShort')
  const [teamsParam, setTeamsParam] = useLocationSearchParam('teams')
  const [analysisParam, setAnalysisParam] = useLocationSearchParam('analysis')
  const [search, setSearchParam] = useLocationSearchParam('q')
  const [whoseParam, setWhoseParam] = useLocationSearchParam('whose')
  const whose = parseWhose(whoseParam)
  const teams = parseTeams(teamsParam)
  const analysis = parseAnalysis(analysisParam)
  const myNames = useMyPlayerNames()

  // The library's mode-like filters are remembered per user across visits, with both views (the
  // whole library and bookmarks) sharing one saved set. Each view names only the params it
  // actually uses, so a preference a view can't express is neither seeded into its URL nor counted
  // as "the URL specifies the filters" there (saved entries outside a view's params survive its
  // saves untouched).
  const rememberedUrlValues: Record<string, string> = {
    duration: durationParam,
    sort: sortParam,
  }
  if (view.kind === 'all') {
    rememberedUrlValues.includeShort = includeShortParam
  }
  const { values: filterValues, save: saveFilterPrefs } = useRememberedFilters(
    'replays',
    rememberedUrlValues,
  )

  // Remembered per user: hides who won and how long each game took.
  const [spoilerFree, setSpoilerFree] = useUserLocalStorageValue('gamesSpoilerFree', false)

  const duration = parseDuration(filterValues.duration)
  const chosenSort = parseSort(filterValues.sort)
  const isDurationSort =
    chosenSort === GameSortOption.ShortestFirst || chosenSort === GameSortOption.LongestFirst
  // Sorting by length would give results away as much as showing it, so it waits while results
  // are hidden.
  const sort = spoilerFree && isDurationSort ? GameSortOption.LatestFirst : chosenSort
  const format = parseFormat(formatParam)
  const matchup = parseMatchup(matchupParam, format)
  const date = parseDatePreset(dateParam)
  // The minimum-length floor never applies to the Bookmarked view (see `buildReplaySqlQuery`), so
  // `includeShort` is only read, seeded and saved in the whole library.
  const includeShort = view.kind === 'all' && filterValues.includeShort === 'true'

  const computerLabel = t('game.playerName.computer', 'Computer')

  const [filtersOpen, setFiltersOpen] = useState(false)

  // The view is navigation rather than a filter: it isn't included here, and clearing filters
  // leaves it alone.
  // How many of the filter row's filters are set, for the badge on the Filters button.
  const filtersCount = [!!date, duration !== GameDurationFilter.All, !!matchup, !!mapName].filter(
    Boolean,
  ).length
  const hasActiveFilters =
    !!teams ||
    analysis !== 'any' ||
    whose !== 'all' ||
    !!search ||
    duration !== GameDurationFilter.All ||
    !!mapName ||
    !!format ||
    !!matchup ||
    !!date

  // A list sorted by length has no days to split into.
  const useFlatList = sort === GameSortOption.ShortestFirst || sort === GameSortOption.LongestFirst

  const currentFilters = buildFilters({
    view,
    sort,
    mapName,
    duration,
    format,
    matchup,
    date,
    includeShort,
    teams,
    analysis,
    search,
    whose,
    myNames,
  })

  const reset = () => {
    queryEpochRef.current += 1
    setEntries(undefined)
    setTotal(undefined)
    setIsLoadingNext(false)
    setSnapshotInvalidated(true)
    restartObserver()
    // The selected rows may not match the new filters, and the list reloads from the top anyway.
    setSelection(collapseSelection)
  }

  // Fetches the index status. Called once on mount and again (debounced) on every index change.
  const fetchStatus = useEffectEvent(() => {
    ipcRenderer
      .invoke('replayLibraryStatus')
      ?.then(result => {
        if (result) {
          setStatus(result)
          setBackfill(result.backfill)
          setUnavailable(false)
        }
      })
      .catch(() => {
        // A rejection here means the service isn't answering (see `unavailable`); mark it so the UI
        // can explain the failure rather than loading indefinitely.
        setUnavailable(true)
      })
  })

  // Re-queries just the currently-loaded window of entries (offset 0, enough to cover what's
  // already been loaded) and replaces it wholesale. Used to pick up backfill progress and
  // added/removed files without collapsing the user's scroll position.
  const refreshLoadedWindow = useEffectEvent(() => {
    // Invalidate any in-flight next-page load: it computed its offset against the pre-refresh
    // entries, so letting it append after the wholesale replacement would leave a gap in the
    // loaded window (which the id-dedupe in `onLoadNextData` can then never fill). Clearing
    // `isLoadingNext` here is required for the same reason — the invalidated load's `finally`
    // deliberately won't touch it once its epoch is stale.
    queryEpochRef.current += 1
    setIsLoadingNext(false)
    const epoch = queryEpochRef.current
    const limit = Math.max(LOAD_CHUNK_SIZE, entries?.length ?? 0)

    ipcRenderer
      .invoke('replayLibraryQuery', {
        ...currentFilters,
        offset: 0,
        limit,
      })
      ?.then(result => {
        if (epoch !== queryEpochRef.current || !result) return
        setEntries(result.entries)
        setTotal(result.total)
        setHiddenShort(result.hiddenShort)
      })
      .catch(swallowNonBuiltins)
  })

  // Re-runs everything the `replayLibraryChanged` listener below refreshes: the loaded window and
  // status/backfill.
  const refreshAfterChange = useEffectEvent(() => {
    refreshLoadedWindow()
    fetchStatus()
  })

  // Lets a plain event handler (not an Effect) ask for the same refresh `refreshAfterChange`
  // performs, to correct an optimistic update that turned out to be wrong -- e.g. a failed trash
  // attempt -- without hand-rolling a manual revert. Effect Events may only be called from Effects,
  // so the handler bumps this token instead of calling `refreshAfterChange` itself; the effect
  // below does the actual call. The first run (mount) is skipped since the other effects here
  // already fetch everything fresh on mount.
  const [correctionToken, triggerCorrection] = useRefreshToken()
  const skipInitialCorrectionRef = useRef(true)
  useEffect(() => {
    if (skipInitialCorrectionRef.current) {
      skipInitialCorrectionRef.current = false
      return
    }
    refreshAfterChange()
  }, [correctionToken])

  // Listen for index change + backfill events only while mounted.
  useEffect(() => {
    fetchStatus()
    if (initialWindow !== undefined) {
      // The index can change while the page is unmounted (files added/removed, backfill progress)
      // with nothing listening for the change events, so a restored window is re-queried
      // immediately; the wholesale replacement keeps the restored scroll position.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time refresh of a restored window on mount
      refreshLoadedWindow()
    }

    // A scan sends a change every second while it indexes, and each refresh queries every loaded
    // row again, so refreshes wait for a pause but no longer than a few seconds.
    const handleChanged = debounce(
      () => {
        refreshAfterChange()
      },
      500,
      { maxWait: 3000 },
    )
    const handleProgress = (_event: unknown, progress: ReplayBackfillProgress | undefined) => {
      setBackfill(progress)
    }
    ipcRenderer.on('replayLibraryChanged', handleChanged)
    ipcRenderer.on('replayLibraryBackfillProgress', handleProgress)

    return () => {
      handleChanged.cancel()
      // Other pages listen for changes too, so only this page's handlers are removed.
      ipcRenderer.removeListener('replayLibraryChanged', handleChanged)
      ipcRenderer.removeListener('replayLibraryBackfillProgress', handleProgress)
    }
  }, [initialWindow])

  useEffect(() => {
    if (entryKey === undefined) {
      return undefined
    }

    // Written at cleanup time (unmount), not as `entries`/`total` change: the store stamps its TTL
    // at write time, and this needs to match when the scroll state is saved — also at unmount — so
    // the two entries expire together.
    return () => {
      if (entries !== undefined) {
        windowCache.set(entryKey, { entries, total })
      } else {
        // `reset()` (a filter/sort/view change) clears `entries` while replacing the URL in place
        // under the same visit key. If the user leaves before the first page under the new filters
        // arrives, the old filters' entry must not survive to be restored against the new URL.
        windowCache.delete(entryKey)
      }
    }
  }, [entryKey, entries, total])

  useEffect(() => {
    if (entryKey === undefined) {
      return undefined
    }

    // Cleanup-time write, matching the window save's timing: a selection is never un-made (a
    // restored id absent from the current list just falls back to the first row), so unlike the
    // entry window there's nothing to delete here.
    return () => {
      if (focusedId !== undefined) {
        focusedIdCache.set(entryKey, focusedId)
      }
    }
  }, [entryKey, focusedId])

  const loadedEntries = entries ?? []
  useReplaySummaries(loadedEntries.filter(e => !e.parseError).map(e => e.path))
  // The row the user put the keyboard on, by clicking or with the arrow keys. Until they do, the
  // first row stands in for what the menus and selection act on, but Enter doesn't open it.
  const pickedEntry = loadedEntries.find(e => e.id === focusedId)
  const focusedEntry = pickedEntry ?? loadedEntries[0]
  const focusedIndex = focusedEntry ? loadedEntries.findIndex(e => e.id === focusedEntry.id) : -1
  const orderedIds = loadedEntries.map(e => e.id)
  const selectedIds = new Set(getSelectedIds(selection, orderedIds, focusedEntry?.id))
  const isMultiSelection = selectedIds.size > 1
  // What the row context menu, Delete and the selection summary act on: every selected row, which
  // for a single selection is just the focused one.
  const selectedEntries = loadedEntries.filter(e => selectedIds.has(e.id))

  const watchEntry = (entry: ReplayLibraryEntry) => {
    dispatch(startReplay({ path: entry.path, name: entry.fileName }))
  }
  const analyzeEntry = (entry: ReplayLibraryEntry) => {
    dispatch(
      analyzeReplay({ path: entry.path, name: entry.fileName, linkedGameId: entry.linkedGameId }),
    )
  }
  /** Shows a replay's stats, analyzing it first if it hasn't been. */
  const openEntry = analyzeEntry
  const revealEntry = (entry: ReplayLibraryEntry) => {
    ipcRenderer.invoke('pathsShowItemInFolder', entry.path)?.catch(swallowNonBuiltins)
  }

  // Hands focus to a neighboring row before `targets` leave the list -- otherwise the stale
  // `focusedId` would make the focused-entry fallback jump the selection to the first row. Any multi-selection is dropped either way, since its rows are the ones leaving.
  const moveSelectionOffOf = (targets: ReadonlyArray<ReplayLibraryEntry>) => {
    const targetIds = new Set(targets.map(e => e.id))
    if (focusedEntry && targetIds.has(focusedEntry.id)) {
      setSelection(selectOnly(findNeighborOutside(orderedIds, targetIds)))
    } else {
      setSelection(collapseSelection)
    }
  }

  const trashEntries = (targets: ReadonlyArray<ReplayLibraryEntry>) => {
    if (targets.length === 0) return
    const isBulk = targets.length > 1
    const targetIds = new Set(targets.map(e => e.id))
    moveSelectionOffOf(targets)
    // Update optimistically, same as `setBookmarked`: the watcher notices the files' removal on
    // its own and its resulting index-changed event will confirm this shortly. Anything that
    // didn't actually leave the disk is corrected via the same refresh that event uses.
    setEntries(prev => prev?.filter(e => !targetIds.has(e.id)))
    setTotal(prev => (prev !== undefined ? Math.max(0, prev - targets.length) : prev))

    const showError = () => {
      snackbarController.showSnackbar(
        t('replays.library.moveToRecycleBinError', 'Something went wrong removing the replay'),
        { tone: 'error' },
      )
    }

    ipcRenderer
      .invoke(
        'replayLibraryTrashReplays',
        targets.map(e => e.path),
      )
      ?.then(results => {
        if (!results) return
        // A `missing` file was already gone, which the optimistic removal above already reflects
        // correctly -- only `trashed` counts as moved, and only `failed` needs correcting.
        const moved = results.filter(r => r.outcome === 'trashed').length
        const failed = results.some(r => r.outcome === 'failed')
        if (failed) {
          triggerCorrection()
        }

        if (!isBulk) {
          if (failed) {
            showError()
          } else if (moved > 0) {
            snackbarController.showSnackbar(
              t('replays.library.movedToRecycleBin', 'Replay moved to Recycle Bin'),
              { tone: 'success' },
            )
          }
        } else if (failed) {
          snackbarController.showSnackbar(
            t('replays.library.bulk.movedToRecycleBinPartial', {
              defaultValue_one: 'Moved {{moved}} of {{count}} replay to Recycle Bin',
              defaultValue_other: 'Moved {{moved}} of {{count}} replays to Recycle Bin',
              count: targets.length,
              moved,
            }),
            { tone: 'error' },
          )
        } else if (moved > 0) {
          snackbarController.showSnackbar(
            t('replays.library.bulk.movedToRecycleBin', {
              defaultValue_one: 'Moved {{count}} replay to Recycle Bin',
              defaultValue_other: 'Moved {{count}} replays to Recycle Bin',
              count: moved,
            }),
            { tone: 'success' },
          )
        }
      })
      .catch(err => {
        logger.error(`Error moving replays to Recycle Bin: ${getErrorStack(err)}`)
        showError()
        triggerCorrection()
      })
  }

  /** Moves several replays to the Recycle Bin once the user says so. One goes right away. */
  const confirmTrashEntries = (targets: ReadonlyArray<ReplayLibraryEntry>) => {
    if (targets.length <= 1) {
      trashEntries(targets)
      return
    }
    dispatch(
      openDialog({
        type: DialogType.Confirm,
        initData: {
          confirmTitle: t('replays.library.bulk.confirmRecycleTitle', {
            defaultValue_one: 'Move {{count}} replay to the Recycle Bin?',
            defaultValue_other: 'Move {{count}} replays to the Recycle Bin?',
            count: targets.length,
          }),
          confirmBody: t(
            'replays.library.bulk.confirmRecycleBody',
            'You can restore them from the Recycle Bin.',
          ),
          confirmLabel: t('replays.library.moveToRecycleBin', 'Move to Recycle Bin'),
          onConfirm: () => trashEntries(targets),
        },
      }),
    )
  }

  const handleRowSelect = (id: number, event: React.MouseEvent) => {
    const toggle = event.ctrlKey || event.metaKey
    if (event.shiftKey) {
      setSelection(selectRangeTo(selection, orderedIds, focusedEntry?.id, id, toggle))
    } else if (toggle) {
      setSelection(toggleInSelection(selection, orderedIds, focusedEntry?.id, id))
    } else {
      setSelection(selectOnly(id))
    }
  }

  const handleRowContextMenu = (entry: ReplayLibraryEntry, event: React.MouseEvent) => {
    // Right-clicking inside a multi-selection acts on all of it; anywhere else it starts over from
    // the clicked row alone.
    if (!isMultiSelection || !selectedIds.has(entry.id)) {
      setSelection(selectOnly(entry.id))
    }
    openRowContextMenu(event)
  }

  const setBookmarked = (targets: ReadonlyArray<ReplayLibraryEntry>, bookmarked: boolean) => {
    const isBulk = targets.length > 1
    // Unreadable replays aren't bookmarkable, and rows already in the requested state stay put.
    const changing = targets.filter(
      e => !e.parseError && (e.bookmarkedAt !== undefined) !== bookmarked,
    )
    if (changing.length === 0) return
    const changingIds = new Set(changing.map(e => e.id))
    // Update optimistically; the resulting index-changed event will confirm (or correct) shortly.
    setEntries(prev => {
      const now = Date.now()
      return prev?.map(e =>
        changingIds.has(e.id) ? { ...e, bookmarkedAt: bookmarked ? now : undefined } : e,
      )
    })
    ipcRenderer
      .invoke('replayLibrarySetBookmarked', [...changingIds], bookmarked)
      ?.then(changed => {
        if (!isBulk || !changed) return
        snackbarController.showSnackbar(
          bookmarked
            ? t('replays.library.bulk.bookmarked', {
                defaultValue_one: 'Bookmarked {{count}} replay',
                defaultValue_other: 'Bookmarked {{count}} replays',
                count: changed.length,
              })
            : t('replays.library.bulk.removedBookmark', {
                defaultValue_one: 'Removed the bookmark from {{count}} replay',
                defaultValue_other: 'Removed the bookmark from {{count}} replays',
                count: changed.length,
              }),
          { tone: 'success' },
        )
      })
      .catch(swallowNonBuiltins)
  }

  const toggleBookmark = (entry: ReplayLibraryEntry) => {
    setBookmarked([entry], entry.bookmarkedAt === undefined)
  }

  const scrollToIndex = (index: number) => {
    // Only one of these lists is mounted at a time, so the other ref is null.
    groupedRef.current?.scrollIntoView({ index })
    flatRef.current?.scrollIntoView({ index })
  }
  const focusIndex = (index: number) => {
    if (index < 0 || index >= loadedEntries.length) return
    setSelection(selectOnly(loadedEntries[index].id))
    scrollToIndex(index)
  }
  const getIndexAfterMove = (delta: number) => {
    const base = focusedIndex < 0 ? 0 : focusedIndex
    return Math.min(Math.max(base + delta, 0), loadedEntries.length - 1)
  }
  const moveFocus = (delta: number) => {
    if (loadedEntries.length === 0) return
    // The first key press puts the keyboard on the first row rather than past it.
    focusIndex(pickedEntry ? getIndexAfterMove(delta) : 0)
  }
  // Shift+Up/Down: moves focus while selecting everything between it and the range anchor.
  const extendSelection = (delta: number) => {
    if (loadedEntries.length === 0) return
    const next = getIndexAfterMove(delta)
    setSelection(selectRangeTo(selection, orderedIds, focusedEntry?.id, loadedEntries[next].id))
    scrollToIndex(next)
  }

  const onLoadNextData = () => {
    setIsLoadingNext(true)
    const epoch = queryEpochRef.current
    const offset = entries?.length ?? 0

    ipcRenderer
      .invoke('replayLibraryQuery', {
        ...currentFilters,
        offset,
        limit: LOAD_CHUNK_SIZE,
      })
      ?.then(result => {
        if (epoch !== queryEpochRef.current || !result) return
        // The index can change between fetches (files added/removed), so the same offset can
        // re-serve entries we've already loaded; dedupe on append to avoid duplicate React keys.
        setEntries(prev => {
          const existingIds = new Set((prev ?? []).map(e => e.id))
          return (prev ?? []).concat(result.entries.filter(e => !existingIds.has(e.id)))
        })
        setTotal(result.total)
        if (offset === 0) {
          setHiddenShort(result.hiddenShort)
        }
      })
      .catch(swallowNonBuiltins)
      .finally(() => {
        if (epoch === queryEpochRef.current) {
          setIsLoadingNext(false)
        }
      })
  }

  const hasNextData = entries === undefined || (total !== undefined && entries.length < total)

  const clearAllFilters = () => {
    setDurationParam('')
    setMapNameParam('')
    setFormatParam('')
    setMatchupParam('')
    setDateParam('')
    setTeamsParam('')
    setAnalysisParam('')
    setSearchParam('')
    setWhoseParam('')
    saveFilterPrefs()
    reset()
    // `sort` is a view option (not a filter), so it's intentionally left untouched — including in
    // the remembered set, which `saveFilterPrefs` rewrites from the params that remain.
  }

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      // Every key here acts on the replay list, but this page's key listener boundary is shared
      // with other UI whose keydowns bubble to the document, like the search field. While a
      // text-entry element has focus, the keystroke belongs to it: without this, pressing Enter
      // while typing would open a replay.
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return false
      }

      switch (event.code) {
        case 'ArrowUp':
          if (event.shiftKey) {
            extendSelection(-1)
          } else {
            moveFocus(-1)
          }
          return true
        case 'ArrowDown':
          if (event.shiftKey) {
            extendSelection(1)
          } else {
            moveFocus(1)
          }
          return true
        case 'PageUp':
          moveFocus(-10)
          return true
        case 'PageDown':
          moveFocus(10)
          return true
        case 'Home':
          focusIndex(0)
          return true
        case 'End':
          focusIndex(loadedEntries.length - 1)
          return true
        case ENTER:
        case ENTER_NUMPAD: {
          const active = document.activeElement
          // If the user is on an interactive control (e.g. a focused button), let it handle Enter.
          if (
            active instanceof HTMLElement &&
            (active.tagName === 'BUTTON' || active.tagName === 'A')
          ) {
            return false
          }
          if (!pickedEntry || pickedEntry.parseError) {
            return false
          }
          openEntry(pickedEntry)
          return true
        }
      }

      return false
    },
  })

  const sessions = groupReplaysByDay(loadedEntries)
  const groupCounts = sessions.map(g => g.entries.length)
  // The last row of each session closes its panel.
  const lastIndexes = new Set<number>()
  let sessionEnd = -1
  for (const count of groupCounts) {
    sessionEnd += count
    lastIndexes.add(sessionEnd)
  }
  const nowMs = useCurrentMinuteMs()
  const getFlatListTitle = () => {
    return sort === GameSortOption.ShortestFirst
      ? t('replays.filters.shortestFirst', 'Shortest first')
      : t('replays.filters.longestFirst', 'Longest first')
  }

  const slotWidth = getTeamSlotWidth(loadedEntries.flatMap(e => e.players.map(p => p.name)))
  const renderRow = (index: number) => {
    const entry = loadedEntries[index]
    if (!entry) return null
    const isLast = useFlatList ? index === loadedEntries.length - 1 : lastIndexes.has(index)
    return (
      <GameRow
        entry={entry}
        slotWidth={slotWidth}
        edge={isLast ? 'last' : 'middle'}
        // Only a selection of several games is marked, since that's what the selection bar acts on.
        selected={isMultiSelection && selectedIds.has(entry.id)}
        focused={entry.id === pickedEntry?.id}
        showDate={useFlatList}
        hideResults={spoilerFree}
        myNames={myNames}
        computerLabel={computerLabel}
        onSelect={handleRowSelect}
        onOpen={openEntry}
        onAnalyze={entry => analyzeEntries([entry])}
        onWatch={watchEntry}
        onContextMenu={handleRowContextMenu}
      />
    )
  }

  // The list's first load in a visit is part of the page opening, so the page waits for its rows. A
  // reload after the filters change loads in the list, and waits so a quick one doesn't flash it.
  const pageLoading =
    !snapshotInvalidated && (entries === undefined || (entries.length > 0 && !rowsMeasured))
  let listContent: React.ReactNode = null
  if (entries === undefined) {
    listContent = snapshotInvalidated ? <LoadingIndicatorArea /> : null
  } else if (entries.length === 0) {
    if (hasActiveFilters) {
      listContent = (
        <CenteredState>
          <EmptyStateTitle>{t('replays.library.noMatches', 'No replays match')}</EmptyStateTitle>
          <TextButton
            label={t('replays.library.clearFilters', 'Clear filters')}
            iconStart={<MaterialIcon icon='close' />}
            onClick={clearAllFilters}
          />
        </CenteredState>
      )
    } else if (view.kind === 'bookmarked') {
      listContent = (
        <CenteredState>
          <EmptyStateTitle>
            {t('replays.library.bookmarkedEmpty', 'No bookmarked replays')}
          </EmptyStateTitle>
          <div>
            {t('replays.library.bookmarkedEmptyBody', 'Bookmark replays to keep them handy here.')}
          </div>
        </CenteredState>
      )
    } else if (
      status &&
      (status.watchedFolders.length === 0 ||
        status.missingFolders.length === status.watchedFolders.length)
    ) {
      listContent = (
        <CenteredState>
          {status.watchedFolders.length === 0 ? (
            <EmptyStateTitle>{t('replays.library.noFolders', 'No replay folders')}</EmptyStateTitle>
          ) : (
            <>
              <EmptyStateTitle>
                {t('replays.library.foldersMissing', {
                  defaultValue_one: "Your replay folder can't be found",
                  defaultValue_other: "Your replay folders can't be found",
                  count: status.watchedFolders.length,
                })}
              </EmptyStateTitle>
              {status.missingFolders.map(folder => (
                <EmptyStatePath key={folder}>{folder}</EmptyStatePath>
              ))}
            </>
          )}
          <TextButton
            label={t('replays.library.replayFolders', 'Replay folders')}
            iconStart={<MaterialIcon icon='folder' />}
            onClick={() => dispatch(openSettings(AppSettingsPage.Replays))}
          />
        </CenteredState>
      )
    } else if (backfill) {
      // A backfill is still populating the index (progress shows in the bar above, so the page
      // shows); don't claim there are no replays while it's just getting started.
      listContent = <LoadingIndicatorArea showImmediately={true} />
    } else {
      listContent = (
        <CenteredState>
          <EmptyStateTitle>{t('replays.library.empty', 'No replays yet')}</EmptyStateTitle>
          <div>{t('replays.library.emptyBody', 'Games you play show up here on their own.')}</div>
          {status?.watchedFolders.map(folder => (
            <EmptyStatePath key={folder}>{folder}</EmptyStatePath>
          ))}
        </CenteredState>
      )
    }
  } else if (scrollParent) {
    // NOTE: `Virtuoso` and `GroupedVirtuoso` share the same underlying component type, so
    // switching between them reconciles as a prop update and leaves stale group state behind.
    // Distinct keys force a full remount when the list mode changes.
    listContent = useFlatList ? (
      <Virtuoso
        key='flat'
        ref={flatRef}
        customScrollParent={scrollParent}
        restoreStateFrom={restoreStateFrom}
        totalCount={loadedEntries.length}
        components={{ Header: FlatListHeader }}
        context={{
          title: getFlatListTitle(),
          summary: t('replays.sessions.games', {
            defaultValue_one: '{{count}} game',
            defaultValue_other: '{{count}} games',
            count: total ?? 0,
          }),
          selectedIds,
          slotWidth,
        }}
        itemContent={renderRow}
        itemsRendered={onItemsRendered}
      />
    ) : (
      <GroupedVirtuoso
        key='grouped'
        ref={groupedRef}
        customScrollParent={scrollParent}
        restoreStateFrom={restoreStateFrom}
        groupCounts={groupCounts}
        groupContent={index => (
          <GroupHeader
            title={getDayTitle(sessions[index], nowMs, locale, t)}
            // The last day loaded may go on past what's loaded, so its count would only be a part.
            summary={
              index === sessions.length - 1 && hasNextData ? '' : getDaySummary(sessions[index], t)
            }
          />
        )}
        // Rows only render again when the context changes, so it carries what they show that
        // isn't in the entries themselves.
        context={{ selectedIds, slotWidth }}
        itemContent={renderRow}
        itemsRendered={onItemsRendered}
      />
    )
  }

  // The scanning phase (total unknown) is only surfaced while the list is still empty: an
  // already-populated library re-scans on every startup with no work to do, and a flashing
  // "Scanning…" there would just be noise.
  const visibleBackfill =
    backfill && (backfill.phase === 'indexing' || loadedEntries.length === 0) ? backfill : undefined

  let rowMenu: React.ReactNode = null
  if (isMultiSelection) {
    rowMenu = (
      <MenuList dense={true}>
        {getBulkReplayActionMenuItems({
          entries: selectedEntries,
          closeMenu: contextMenuPopoverProps.onDismiss,
          onSetBookmarked: bookmarked => setBookmarked(selectedEntries, bookmarked),
          onMoveToRecycleBin: () => confirmTrashEntries(selectedEntries),
          t,
        })}
      </MenuList>
    )
  } else if (focusedEntry) {
    // An unreadable replay can't be watched or bookmarked.
    const readable = !focusedEntry.parseError
    rowMenu = (
      <MenuList dense={true}>
        {readable ? (
          <MenuItem
            icon={<MaterialIcon icon='play_arrow' />}
            text={t('replays.library.watchReplay', 'Watch replay')}
            onClick={() => {
              contextMenuPopoverProps.onDismiss()
              watchEntry(focusedEntry)
            }}
          />
        ) : null}
        {readable ? (
          <MenuItem
            icon={<MaterialIcon icon='bookmark' filled={focusedEntry.bookmarkedAt !== undefined} />}
            text={
              focusedEntry.bookmarkedAt !== undefined
                ? t('replays.library.removeBookmark', 'Remove bookmark')
                : t('replays.library.bookmark', 'Bookmark')
            }
            onClick={() => {
              contextMenuPopoverProps.onDismiss()
              toggleBookmark(focusedEntry)
            }}
          />
        ) : null}
        {getReplayActionMenuItems({
          entry: focusedEntry,
          closeMenu: contextMenuPopoverProps.onDismiss,
          onReveal: revealEntry,
          onAnalyze: analyzeEntry,
          onMoveToRecycleBin: entry => trashEntries([entry]),
          t,
        })}
      </MenuList>
    )
  }

  if (unavailable) {
    // The whole feature depends on the main-process service, so when it's down there's nothing to
    // filter or browse — replace the page with a plain explanation rather than dead chrome.
    return (
      <CenteredContentContainer $targetWidth={1280}>
        <PageColumn>
          <ReplayLibraryUnavailable />
        </PageColumn>
      </CenteredContentContainer>
    )
  }

  return (
    <CenteredContentContainer ref={setScrollParent} $fullWidth={true} data-content-fullbleed=''>
      <PageColumn>
        <LibraryToolbar
          teams={teams}
          onTeamsChange={v => {
            setTeamsParam(v ?? '')
            // A matchup is only for 1v1s, so it goes with any other game type.
            if (v !== undefined && v !== '1v1') {
              setFormatParam('')
              setMatchupParam('')
            }
            reset()
          }}
          analysis={analysis}
          onAnalysisChange={v => {
            setAnalysisParam(v === 'any' ? '' : v)
            reset()
          }}
          hideResults={spoilerFree}
          onHideResultsChange={setSpoilerFree}
          search={search}
          onSearchChange={v => {
            setSearchParam(v)
            reset()
          }}
          view={view}
          onViewChange={v => {
            const pathname = encodeViewPathname(v)
            if (pathname === encodeViewPathname(view)) {
              return
            }
            // A view change is a navigation to a new place: the parent remounts this component
            // keyed on the view pathname, so the new visit starts clean. The current filters ride
            // along in the search string.
            push(pathname + window.location.search)
          }}
          whose={whose}
          onWhoseChange={
            myNames?.length
              ? v => {
                  if (v !== whose) {
                    setWhoseParam(v === 'all' ? '' : v)
                    reset()
                  }
                }
              : undefined
          }
          filtersOpen={filtersOpen}
          filtersCount={filtersCount}
          onFiltersToggle={() => setFiltersOpen(open => !open)}
          actions={iconOnly => <AnalyzeLatestButton iconOnly={iconOnly} filters={currentFilters} />}
        />

        {myNames === undefined ? <NamesPrompt /> : null}

        {filtersOpen ? (
          <LibraryFilterRow
            date={date}
            onDateChange={v => {
              setDateParam(v ?? '')
              reset()
            }}
            duration={duration}
            onDurationChange={v => {
              setDurationParam(v === GameDurationFilter.All ? '' : v)
              saveFilterPrefs()
              reset()
            }}
            matchup={format === '1v1' ? matchup : undefined}
            // The matchups are 1v1s, so they're offered with the game types that have them.
            showMatchup={teams === undefined || teams === '1v1'}
            onMatchupChange={v => {
              // A matchup only applies with its game's format, and picks that game type too.
              setFormatParam(v ? '1v1' : '')
              setMatchupParam(v ?? '')
              if (v) {
                setTeamsParam('1v1')
              }
              reset()
            }}
            mapName={mapName}
            onMapNameChange={v => {
              setMapNameParam(v)
              reset()
            }}
            sort={sort}
            canSortByLength={!spoilerFree}
            onSortChange={v => {
              setSortParam(v === GameSortOption.LatestFirst ? '' : v)
              saveFilterPrefs()
              reset()
            }}
            onClear={() => {
              setSortParam('')
              clearAllFilters()
            }}
          />
        ) : null}

        {visibleBackfill ? <BackfillProgressBar backfill={visibleBackfill} /> : null}

        {isMultiSelection ? (
          <SelectionBar
            count={selectedEntries.length}
            allBookmarked={selectedEntries.every(e => e.bookmarkedAt !== undefined)}
            onBookmark={bookmarked => setBookmarked(selectedEntries, bookmarked)}
            onAnalyze={() => analyzeEntries(selectedEntries)}
            onMoveToRecycleBin={() => confirmTrashEntries(selectedEntries)}
            onClear={() => setSelection(selectOnly(focusedEntry?.id))}
          />
        ) : null}

        <ListColumn>
          <InfiniteScrollList
            nextLoadingEnabled={true}
            isLoadingNext={isLoadingNext}
            hasNextData={hasNextData}
            refreshToken={observerToken}
            onLoadNextData={onLoadNextData}>
            {listContent}
          </InfiniteScrollList>
          {entries !== undefined && !hasNextData && (hiddenShort > 0 || includeShort) ? (
            <ShortGamesNote>
              {includeShort
                ? t('replays.library.showingShortGames', 'Games under 2 minutes are shown.')
                : t('replays.library.shortGamesHidden', {
                    defaultValue_one: '{{count}} game under 2 minutes is hidden.',
                    defaultValue_other: '{{count}} games under 2 minutes are hidden.',
                    count: hiddenShort,
                  })}
              <TextButton
                label={
                  includeShort
                    ? t('replays.library.hideShortGames', 'Hide them')
                    : t('replays.library.showShortGames', 'Show them')
                }
                onClick={() => {
                  setIncludeShortParam(includeShort ? '' : 'true')
                  saveFilterPrefs()
                  reset()
                }}
              />
            </ShortGamesNote>
          ) : null}
          {pageLoading ? <PageLoadingIndicator /> : null}
        </ListColumn>

        <Popover {...contextMenuPopoverProps}>{rowMenu}</Popover>
      </PageColumn>
    </CenteredContentContainer>
  )
}
