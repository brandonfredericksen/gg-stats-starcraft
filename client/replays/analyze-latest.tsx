import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { GameSortOption } from '../../common/games/game-filters'
import { ReplayToAnalyze, TypedIpcRenderer } from '../../common/ipc'
import { ReplayLibraryEntry, ReplayLibraryFilters } from '../../common/replays-library'
import { autoCaptureStatusAtom } from '../games/replay-stats-status'
import { MaterialIcon } from '../icons/material/material-icon'
import { jotaiStore } from '../jotai-store'
import { Divider } from '../material/menu/divider'
import { DestructiveMenuItem, MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { labelMedium } from '../styles/typography'
import { ToolbarButton, ToolbarTooltip } from './library-toolbar'
import { getLayoutMatchup, getReplayDisplayTeams } from './replay-library-helpers'

const ipcRenderer = new TypedIpcRenderer()

/** How many of the newest games the menu offers to analyze at once. */
const BATCH_SIZES = [10, 25, 50, 100] as const

export function toReplayToAnalyze(entry: ReplayLibraryEntry): ReplayToAnalyze {
  return {
    path: entry.path,
    name: entry.fileName,
    linkedGameId: entry.linkedGameId,
    gameTime: entry.gameTime,
    mapName: entry.mapName,
    matchup: getLayoutMatchup(getReplayDisplayTeams(entry.players)),
  }
}

/** Analyzes these replays one after another in the background, skipping unreadable ones. */
export function analyzeEntries(entries: ReadonlyArray<ReplayLibraryEntry>) {
  const replays = entries.filter(e => !e.parseError).map(toReplayToAnalyze)
  ipcRenderer.invoke('autoCaptureAnalyzeReplays', replays)?.catch(swallowNonBuiltins)
}

/** Paths of the replays being analyzed or waiting for it. */
function getPendingPaths(): string[] {
  const { queued, running } = jotaiStore.get(autoCaptureStatusAtom)
  return running ? [...queued, running] : [...queued]
}

/** Counts the replays matching `filters` that aren't analyzed, waiting or being analyzed. */
export async function countNotAnalyzed(filters: ReplayLibraryFilters): Promise<number> {
  const result = await ipcRenderer.invoke('replayLibraryQuery', {
    ...filters,
    analysis: 'notAnalyzed',
    excludePaths: getPendingPaths(),
    offset: 0,
    limit: 1,
  })
  return result?.total ?? 0
}

/**
 * Analyzes the newest `count` replays matching `filters` that aren't analyzed yet, leaving out
 * ones already waiting. Resolves to how many it added.
 */
export async function analyzeLatest(filters: ReplayLibraryFilters, count: number) {
  const result = await ipcRenderer.invoke('replayLibraryQuery', {
    ...filters,
    analysis: 'notAnalyzed',
    excludePaths: getPendingPaths(),
    sort: GameSortOption.LatestFirst,
    offset: 0,
    limit: count,
  })
  const entries = (result?.entries ?? []).filter(e => !e.parseError)
  if (entries.length) {
    await ipcRenderer.invoke('autoCaptureAnalyzeReplays', entries.map(toReplayToAnalyze))
  }
  return entries.length
}

/** Drops every replay waiting to be analyzed. The one being analyzed now still finishes. */
export function clearWaitingAnalyses() {
  ipcRenderer.invoke('autoCaptureClearWaiting')?.catch(swallowNonBuiltins)
}

/** Pauses analyzing, letting the game being analyzed finish, or resumes it. */
export function setAnalysisPaused(paused: boolean) {
  ipcRenderer.invoke('autoCaptureSetPaused', paused)?.catch(swallowNonBuiltins)
}

const Overline = styled.div`
  ${labelMedium};
  padding: 8px 12px 4px;
  color: var(--theme-on-surface-variant);
`

/**
 * A toolbar button that analyzes the newest games matching the library's filters that aren't
 * analyzed yet, and stops the ones waiting.
 */
export function AnalyzeLatestButton({
  filters,
  iconOnly = false,
}: {
  filters: ReplayLibraryFilters
  /** Shows only the icon, with the label in a tooltip, for a narrow toolbar. */
  iconOnly?: boolean
}) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const { queued, pausedByUser } = useAtomValue(autoCaptureStatusAtom)
  const [anchor, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('left', 'bottom')
  const [open, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })
  const [available, setAvailable] = useState<number>()

  const onOpen = (event: React.MouseEvent) => {
    if (!openMenu(event)) {
      return
    }
    setAvailable(undefined)
    countNotAnalyzed(filters)
      .then(setAvailable)
      .catch(err => {
        setAvailable(0)
        swallowNonBuiltins(err)
      })
  }

  const onAnalyze = (count: number) => {
    closeMenu()
    analyzeLatest(filters, count)
      .then(added => {
        snackbarController.showSnackbar(
          added
            ? t('replays.analyzeLatest.added', {
                defaultValue: 'Analyzing {{count}} games in the background',
                defaultValue_one: 'Analyzing {{count}} game in the background',
                count: added,
              })
            : t('replays.analyzeLatest.none', 'Every game here is analyzed already'),
        )
      })
      .catch(swallowNonBuiltins)
  }

  const sizes = BATCH_SIZES.filter(size => available === undefined || size < available)
  const showAll = available !== undefined && available > 0 && available <= BATCH_SIZES.at(-1)!

  let overline = t('replays.analyzeLatest.counting', 'Counting games...')
  if (available === 0) {
    overline = t('replays.analyzeLatest.noneLeft', 'Every game here is analyzed')
  } else if (available !== undefined) {
    overline = t('replays.analyzeLatest.available', {
      defaultValue: '{{count}} games here are not analyzed',
      defaultValue_one: '{{count}} game here is not analyzed',
      count: available,
    })
  }

  return (
    <>
      <ToolbarTooltip
        text={t('replays.analyzeLatest.button', 'Analyze')}
        disabled={!iconOnly}
        tabIndex={-1}>
        <ToolbarButton
          ref={anchor}
          type='button'
          aria-label={t('replays.analyzeLatest.button', 'Analyze')}
          onClick={onOpen}>
          <MaterialIcon icon='bolt' size={18} />
          {iconOnly ? null : t('replays.analyzeLatest.button', 'Analyze')}
        </ToolbarButton>
      </ToolbarTooltip>
      <Popover
        open={open}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='left'
        originY='top'>
        <MenuList dense={true}>
          <Overline>{overline}</Overline>
          {available === 0
            ? null
            : sizes.map(size => (
                <MenuItem
                  key={size}
                  disabled={available === undefined}
                  text={t('replays.analyzeLatest.latest', 'Newest {{count}}', { count: size })}
                  onClick={() => onAnalyze(size)}
                />
              ))}
          {showAll ? (
            <MenuItem
              text={t('replays.analyzeLatest.all', {
                defaultValue: 'All {{count}}',
                count: available,
              })}
              onClick={() => onAnalyze(available)}
            />
          ) : null}
          <Divider $dense={true} />
          <MenuItem
            icon={<MaterialIcon icon={pausedByUser ? 'play_arrow' : 'pause'} />}
            text={
              pausedByUser
                ? t('autoCapture.menu.resume', 'Resume analyzing')
                : t('autoCapture.menu.pause', 'Pause analyzing')
            }
            onClick={() => {
              closeMenu()
              setAnalysisPaused(!pausedByUser)
            }}
          />
          {queued.length ? (
            <DestructiveMenuItem
              icon={<MaterialIcon icon='stop_circle' />}
              text={t('replays.analyzeLatest.clear', {
                defaultValue: 'Stop the {{count}} waiting',
                count: queued.length,
              })}
              onClick={() => {
                closeMenu()
                clearWaitingAnalyses()
              }}
            />
          ) : null}
        </MenuList>
      </Popover>
    </>
  )
}
