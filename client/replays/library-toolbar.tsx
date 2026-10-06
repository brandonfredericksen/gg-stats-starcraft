import { debounce } from 'lodash-es'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReplayPlaylist, ReplayTeamsFilter } from '../../common/replays-library'
import { useFitLevel } from '../dom/use-fit-level'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from '../material/button-reset'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { Segmented, SegmentMenu, SegmentOption } from '../material/segmented'
import { Tooltip } from '../material/tooltip'
import { useStableCallback } from '../react/state-hooks'
import { bodyMedium, labelLarge, singleLine } from '../styles/typography'
import { LibraryView } from './replay-library-helpers'

export type AnalysisFilter = 'any' | 'analyzed' | 'notAnalyzed'

/** Whose games to show: everyone's, the user's own, or only other people's. */
export type WhoseFilter = 'all' | 'mine' | 'others'

/**
 * How the toolbar gives up room as it narrows, one step at a time, so it always stays one row.
 * Each level keeps the ones before it.
 */
const FitLevel = {
  /** Everything, with labels. */
  Full: 0,
  /** The Show button drops its "Show" prefix. */
  NoShowPrefix: 1,
  /** Buttons with an icon show only the icon, with their label in a tooltip. */
  IconOnly: 2,
  /** The analysis filter turns into a menu, and the Show label can end in an ellipsis. */
  AnalysisMenu: 3,
  /** The game type filter turns into a menu too. */
  GameTypeMenu: 4,
} as const

const Root = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

/** A toolbar button. Pressed ones get a filled background and a stronger border. */
export const ToolbarButton = styled.button<{ $pressed?: boolean }>`
  ${buttonReset};
  ${labelLarge};
  flex-shrink: 0;
  height: 40px;
  padding: 0 12px;

  display: inline-flex;
  align-items: center;
  gap: 8px;

  border: 1px solid
    ${props => (props.$pressed ? 'var(--theme-outline)' : 'var(--theme-outline-variant)')};
  border-radius: var(--radius-md);
  background-color: ${props =>
    props.$pressed ? 'var(--theme-container-highest)' : 'var(--theme-container-low)'};
  color: var(--theme-on-surface);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

/** Keeps a tooltip's wrapper the size of its button, so a narrow toolbar can't squeeze it. */
export const ToolbarTooltip = styled(Tooltip)`
  flex-shrink: 0;
`

const IconToggle = styled(ToolbarButton)`
  width: 40px;
  padding: 0;
  justify-content: center;
`

/** At the last fit level, gives way before search does, so a long playlist name ends in "...". */
const ShowButton = styled(ToolbarButton)<{ $shrink: boolean }>`
  flex-shrink: ${props => (props.$shrink ? 1 : 0)};
  min-width: 96px;
  padding: 0 10px 0 12px;
`

const ShowPrefix = styled.span`
  color: var(--theme-on-surface-variant);
  font-weight: 500;
`

const ShowLabel = styled.span`
  ${singleLine};
  min-width: 0;
  max-width: 180px;
`

const Chevron = styled(MaterialIcon).attrs({ icon: 'expand_more', size: 18 })`
  color: var(--theme-on-surface-variant);
`

const Badge = styled.span`
  min-width: 18px;
  height: 18px;
  padding: 0 5px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: var(--radius-full);
  background-color: var(--theme-on-surface);
  color: var(--theme-surface);
  font-size: 11px;
  font-weight: 700;
`

const Search = styled.label`
  flex: 1 1 0;
  /* Room for its whole placeholder. */
  min-width: 220px;
  height: 40px;
  padding: 0 14px;

  display: flex;
  align-items: center;
  gap: 8px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-md);
  background-color: var(--theme-container-low);
  color: var(--theme-on-surface-variant);

  &:focus-within {
    border-color: var(--theme-outline);
  }
`

const SearchInput = styled.input`
  ${bodyMedium};
  flex: 1 1 auto;
  min-width: 0;

  border: none;
  outline: none;
  background: transparent;
  color: var(--theme-on-surface);

  &::placeholder {
    color: var(--theme-on-surface-variant);
  }
`

export interface LibraryToolbarProps {
  teams: ReplayTeamsFilter | undefined
  onTeamsChange: (teams: ReplayTeamsFilter | undefined) => void
  analysis: AnalysisFilter
  onAnalysisChange: (analysis: AnalysisFilter) => void
  hideResults: boolean
  onHideResultsChange: (hide: boolean) => void
  search: string
  onSearchChange: (search: string) => void
  view: LibraryView
  playlists: ReadonlyArray<ReplayPlaylist>
  onViewChange: (view: LibraryView) => void
  whose: WhoseFilter
  /** Undefined until the user has said which names are theirs. */
  onWhoseChange: ((whose: WhoseFilter) => void) | undefined
  filtersOpen: boolean
  /** How many of the filters in the filter row are set. */
  filtersCount: number
  onFiltersToggle: () => void
  /** More buttons, after Filters. `iconOnly` is true when there's only room for their icons. */
  actions?: (iconOnly: boolean) => React.ReactNode
}

/** The library's toolbar: game type, analysis, Hide results, which replays, filters, search. */
export function LibraryToolbar({
  teams,
  onTeamsChange,
  analysis,
  onAnalysisChange,
  hideResults,
  onHideResultsChange,
  search,
  onSearchChange,
  view,
  playlists,
  onViewChange,
  whose,
  onWhoseChange,
  filtersOpen,
  filtersCount,
  onFiltersToggle,
  actions,
}: LibraryToolbarProps) {
  const { t } = useTranslation()
  const [anchor, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('left', 'bottom')
  const [showOpen, openShow, closeShow] = usePopoverController({ refreshAnchorPos })

  // The field answers right away while the query waits for a pause in typing.
  const [searchText, setSearchText] = useState(search)
  const stableSearchChange = useStableCallback(onSearchChange)
  const [debouncedSearch] = useState(() =>
    debounce((value: string) => stableSearchChange(value), 250),
  )
  useEffect(() => () => debouncedSearch.cancel(), [debouncedSearch])

  const teamOptions: Array<SegmentOption<ReplayTeamsFilter | undefined>> = [
    { value: undefined, label: t('replays.toolbar.allTypes', 'All') },
    { value: '1v1', label: '1v1' },
    { value: '2v2', label: '2v2' },
    { value: 'bigTeams', label: '3v3+' },
    { value: 'ffa', label: 'FFA' },
  ]
  const analysisOptions: Array<SegmentOption<AnalysisFilter>> = [
    { value: 'any', label: t('replays.toolbar.anyAnalysis', 'Any') },
    { value: 'analyzed', label: t('replays.toolbar.analyzed', 'Analyzed') },
    { value: 'notAnalyzed', label: t('replays.toolbar.notAnalyzed', 'Not yet') },
  ]

  let showLabel = t('replays.toolbar.showAll', 'All replays')
  if (view.kind === 'all' && whose === 'mine') {
    showLabel = t('replays.toolbar.showMine', 'My games')
  } else if (view.kind === 'all' && whose === 'others') {
    showLabel = t('replays.toolbar.showOthers', "Other players' replays")
  } else if (view.kind === 'bookmarked') {
    showLabel = t('replays.toolbar.showBookmarked', 'Bookmarked')
  } else if (view.kind === 'playlist') {
    showLabel = playlists.find(p => p.id === view.id)?.name ?? showLabel
  }
  const chooseView = (next: LibraryView, nextWhose: WhoseFilter = 'all') => {
    closeShow()
    onWhoseChange?.(nextWhose)
    onViewChange(next)
  }

  const [rootRef, fitLevel] = useFitLevel<HTMLDivElement>(
    FitLevel.GameTypeMenu,
    [showLabel, filtersCount, analysis, teams, hideResults].join('|'),
  )
  const iconOnly = fitLevel >= FitLevel.IconOnly

  const hideLabel = hideResults
    ? t('replays.toolbar.showResults', 'Show results')
    : t('replays.toolbar.hideResults', 'Hide results')

  return (
    <Root ref={rootRef}>
      {fitLevel >= FitLevel.GameTypeMenu ? (
        <SegmentMenu
          label={t('replays.toolbar.gameType', 'Game type')}
          options={teamOptions}
          value={teams}
          onChange={onTeamsChange}
        />
      ) : (
        <Segmented
          label={t('replays.toolbar.gameType', 'Game type')}
          options={teamOptions}
          value={teams}
          onChange={onTeamsChange}
        />
      )}
      {fitLevel >= FitLevel.AnalysisMenu ? (
        <SegmentMenu
          label={t('replays.toolbar.analysis', 'Analysis')}
          options={analysisOptions}
          value={analysis}
          onChange={onAnalysisChange}
        />
      ) : (
        <Segmented
          label={t('replays.toolbar.analysis', 'Analysis')}
          options={analysisOptions}
          value={analysis}
          onChange={onAnalysisChange}
        />
      )}
      <ToolbarTooltip text={hideLabel} tabIndex={-1}>
        <IconToggle
          type='button'
          $pressed={hideResults}
          aria-pressed={hideResults}
          aria-label={hideLabel}
          onClick={() => onHideResultsChange(!hideResults)}>
          <MaterialIcon icon={hideResults ? 'visibility_off' : 'visibility'} size={18} />
        </IconToggle>
      </ToolbarTooltip>

      <ShowButton
        ref={anchor}
        type='button'
        $shrink={fitLevel >= FitLevel.AnalysisMenu}
        onClick={openShow}>
        {fitLevel < FitLevel.NoShowPrefix ? (
          <ShowPrefix>{t('replays.toolbar.show', 'Show')}</ShowPrefix>
        ) : null}
        <ShowLabel>{showLabel}</ShowLabel>
        <Chevron />
      </ShowButton>
      <Popover
        open={showOpen}
        onDismiss={closeShow}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='left'
        originY='top'>
        <MenuList dense={true}>
          <MenuItem
            icon={<MaterialIcon icon='movie' />}
            text={t('replays.toolbar.showAll', 'All replays')}
            onClick={() => chooseView({ kind: 'all' })}
          />
          {onWhoseChange ? (
            <MenuItem
              icon={<MaterialIcon icon='person' />}
              text={t('replays.toolbar.showMine', 'My games')}
              onClick={() => chooseView({ kind: 'all' }, 'mine')}
            />
          ) : null}
          {onWhoseChange ? (
            <MenuItem
              icon={<MaterialIcon icon='group' />}
              text={t('replays.toolbar.showOthers', "Other players' replays")}
              onClick={() => chooseView({ kind: 'all' }, 'others')}
            />
          ) : null}
          <MenuItem
            icon={<MaterialIcon icon='bookmark' />}
            text={t('replays.toolbar.showBookmarked', 'Bookmarked')}
            onClick={() => chooseView({ kind: 'bookmarked' })}
          />
          {playlists.map(p => (
            <MenuItem
              key={p.id}
              icon={<MaterialIcon icon='queue_music' />}
              text={p.name}
              onClick={() => chooseView({ kind: 'playlist', id: p.id })}
            />
          ))}
        </MenuList>
      </Popover>

      <ToolbarTooltip
        text={t('replays.toolbar.filters', 'Filters')}
        disabled={!iconOnly}
        tabIndex={-1}>
        <ToolbarButton
          type='button'
          $pressed={filtersOpen}
          aria-pressed={filtersOpen}
          aria-label={t('replays.toolbar.filters', 'Filters')}
          onClick={onFiltersToggle}>
          <MaterialIcon icon='filter_list' size={18} />
          {iconOnly ? null : t('replays.toolbar.filters', 'Filters')}
          {filtersCount > 0 ? <Badge>{filtersCount}</Badge> : null}
        </ToolbarButton>
      </ToolbarTooltip>
      {actions?.(iconOnly)}

      <Search>
        <MaterialIcon icon='search' size={18} />
        <SearchInput
          type='search'
          value={searchText}
          placeholder={t('replays.toolbar.search', 'Find a player or map')}
          onChange={event => {
            setSearchText(event.target.value)
            debouncedSearch(event.target.value)
          }}
        />
      </Search>
    </Root>
  )
}
