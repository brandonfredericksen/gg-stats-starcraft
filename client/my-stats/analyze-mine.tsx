import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { autoCaptureStatusAtom } from '../games/replay-stats-status'
import { MaterialIcon } from '../icons/material/material-icon'
import { OutlinedButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { analyzeLatest, countNotAnalyzed } from '../replays/analyze-latest'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { labelLarge } from '../styles/typography'
import { getLibraryFilters, MyStatsFilters } from './my-stats-data'

/** How many games one click analyzes. */
const BATCH_SIZE = 25

/** A small pill that sits in a line of text without towering over it. */
const CompactButton = styled.button`
  ${buttonReset};
  ${labelLarge};
  height: 28px;
  padding: 0 12px 0 8px;

  display: inline-flex;
  align-items: center;
  gap: 4px;

  border-radius: var(--radius-full);
  background-color: var(--theme-container-high);
  color: var(--theme-on-surface);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background-color: var(--theme-container-highest);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

/**
 * A button that analyzes the user's newest games that aren't analyzed, of the kind My stats is
 * showing. Shows nothing once every one of them is analyzed or waiting.
 */
export function AnalyzeMine({
  names,
  filters,
  compact = false,
}: {
  names: ReadonlyArray<string>
  filters: MyStatsFilters
  /** A small button for a line of text, rather than a card's main action. */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const status = useAtomValue(autoCaptureStatusAtom)
  const [available, setAvailable] = useState(0)

  // Counted again whenever the waiting list changes, since waiting games don't count.
  const pendingKey = status.queued.length + (status.running ?? '')

  useEffect(() => {
    let current = true
    countNotAnalyzed(getLibraryFilters(names, filters))
      .then(count => {
        if (current) {
          setAvailable(count)
        }
      })
      .catch(swallowNonBuiltins)
    return () => {
      current = false
    }
  }, [names, filters, pendingKey])

  if (!available) {
    return null
  }
  const count = Math.min(BATCH_SIZE, available)
  const shape = filters.shape === 'ffa' ? 'FFA' : filters.shape
  const compactLabel = shape
    ? t('myStats.analyzeMine.moreShape', {
        defaultValue: 'Analyze {{count}} more {{shape}} games',
        defaultValue_one: 'Analyze {{count}} more {{shape}} game',
        count,
        shape,
      })
    : t('myStats.analyzeMine.more', {
        defaultValue: 'Analyze {{count}} more',
        count,
      })
  const label = filters.shape
    ? t('myStats.analyzeMine.buttonShape', {
        defaultValue: 'Analyze {{count}} newest unanalyzed {{shape}} replays',
        defaultValue_one: 'Analyze the newest unanalyzed {{shape}} replay',
        count,
        shape: filters.shape === 'ffa' ? 'FFA' : filters.shape,
      })
    : t('myStats.analyzeMine.button', {
        defaultValue: 'Analyze {{count}} newest unanalyzed replays',
        defaultValue_one: 'Analyze the newest unanalyzed replay',
        count,
      })
  const onClick = () => {
    analyzeLatest(getLibraryFilters(names, filters), count)
      .then(added => {
        snackbarController.showSnackbar(
          t('replays.analyzeLatest.added', {
            defaultValue: 'Analyzing {{count}} games in the background',
            defaultValue_one: 'Analyzing {{count}} game in the background',
            count: added,
          }),
        )
      })
      .catch(swallowNonBuiltins)
  }

  return compact ? (
    <CompactButton type='button' onClick={onClick}>
      <MaterialIcon icon='bolt' size={16} />
      {compactLabel}
    </CompactButton>
  ) : (
    <OutlinedButton
      label={label}
      iconStart={<MaterialIcon icon='bolt' size={18} />}
      onClick={onClick}
    />
  )
}
