import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import {
  EncodedMatchupString,
  GameDurationFilter,
  GameSortOption,
  makeEncodedMatchupString,
} from '../../common/games/game-filters'
import { formatMatchup } from '../../common/games/game-labels'
import { TypedIpcRenderer } from '../../common/ipc'
import { filterColorCodes } from '../../common/maps'
import { DatePreset } from '../games/date-range'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from '../material/button-reset'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { labelLarge } from '../styles/typography'

const ipcRenderer = new TypedIpcRenderer()

const Root = styled.div`
  padding: 10px 12px;

  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 12px;
  background-color: var(--theme-container-low);
`

const Chip = styled.button<{ $set: boolean }>`
  ${buttonReset};
  ${labelLarge};
  height: 32px;
  padding: 0 10px 0 12px;

  display: inline-flex;
  align-items: center;
  gap: 6px;

  border: 1px solid
    ${props => (props.$set ? 'var(--theme-outline)' : 'var(--theme-outline-variant)')};
  border-radius: 8px;
  background-color: ${props => (props.$set ? 'var(--theme-container-highest)' : 'transparent')};
  color: var(--theme-on-surface);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const ChipLabel = styled.span`
  color: var(--theme-on-surface-variant);
  font-weight: 500;
`

const Chevron = styled(MaterialIcon).attrs({ icon: 'expand_more', size: 16 })`
  color: var(--theme-on-surface-variant);
`

const Spacer = styled.span`
  flex: 1 1 0;
`

const ClearButton = styled.button`
  ${buttonReset};
  ${labelLarge};
  height: 32px;
  padding: 0 10px;

  border-radius: 8px;
  color: var(--theme-on-surface-variant);
  font-weight: 600;
  cursor: pointer;

  &:hover {
    color: var(--theme-on-surface);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

interface ChipOption<T> {
  value: T
  label: string
}

/** A filter shown as "Label: value" that opens a menu of its choices. */
function DropdownChip<T>({
  label,
  options,
  value,
  isSet,
  onChange,
}: {
  label: string
  options: ReadonlyArray<ChipOption<T>>
  value: T
  /** Whether the filter differs from its default, which fills the chip. */
  isSet: boolean
  onChange: (value: T) => void
}) {
  const [anchor, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('left', 'bottom')
  const [open, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })
  const current = options.find(o => o.value === value)

  return (
    <>
      <Chip ref={anchor} type='button' $set={isSet} onClick={openMenu}>
        <ChipLabel>{label}</ChipLabel>
        {current?.label ?? String(value)}
        <Chevron />
      </Chip>
      <Popover
        open={open}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='left'
        originY='top'>
        <MenuList dense={true}>
          {options.map(option => (
            <MenuItem
              key={option.label}
              icon={option.value === value ? <MaterialIcon icon='check' /> : undefined}
              text={option.label}
              onClick={() => {
                closeMenu()
                onChange(option.value)
              }}
            />
          ))}
        </MenuList>
      </Popover>
    </>
  )
}

const ONE_V_ONE_MATCHUPS = ['p-p', 'p-t', 'p-z', 't-t', 't-z', 'z-z']

export interface LibraryFilterRowProps {
  date: DatePreset | undefined
  onDateChange: (date: DatePreset | undefined) => void
  duration: GameDurationFilter
  onDurationChange: (duration: GameDurationFilter) => void
  /** A 1v1 matchup like `p-z`, or undefined for any. */
  matchup: EncodedMatchupString | undefined
  showMatchup: boolean
  onMatchupChange: (matchup: EncodedMatchupString | undefined) => void
  mapName: string
  onMapNameChange: (mapName: string) => void
  sort: GameSortOption
  /** False while results are hidden, since a game's length gives its result away. */
  canSortByLength: boolean
  onSortChange: (sort: GameSortOption) => void
  onClear: () => void
}

/** The filters under the library's toolbar: date, length, matchup, map and sort. */
export function LibraryFilterRow({
  date,
  onDateChange,
  duration,
  onDurationChange,
  matchup,
  showMatchup,
  onMatchupChange,
  mapName,
  onMapNameChange,
  sort,
  canSortByLength,
  onSortChange,
  onClear,
}: LibraryFilterRowProps) {
  const { t } = useTranslation()
  const [maps, setMaps] = useState<string[]>([])

  useEffect(() => {
    ipcRenderer
      .invoke('replayLibraryGetFrequentMaps')
      ?.then(result => setMaps(result ?? []))
      .catch(swallowNonBuiltins)
  }, [])

  const dateOptions: Array<ChipOption<DatePreset | undefined>> = [
    { value: undefined, label: t('replays.filters.anyTime', 'Any time') },
    { value: 'today', label: t('replays.filters.today', 'Today') },
    { value: 'week', label: t('replays.filters.last7Days', 'Last 7 days') },
    { value: 'month', label: t('replays.filters.last30Days', 'Last 30 days') },
    { value: 'year', label: t('replays.filters.thisYear', 'This year') },
  ]

  const durationOptions: Array<ChipOption<GameDurationFilter>> = [
    { value: GameDurationFilter.All, label: t('replays.filters.anyLength', 'Any') },
    { value: GameDurationFilter.Under10, label: t('replays.filters.under10', 'Under 10 min') },
    { value: GameDurationFilter.From10To20, label: t('replays.filters.10to20', '10 to 20 min') },
    { value: GameDurationFilter.From20To30, label: t('replays.filters.20to30', '20 to 30 min') },
    { value: GameDurationFilter.Over30, label: t('replays.filters.over30', 'Over 30 min') },
  ]

  const matchupOptions: Array<ChipOption<string>> = [
    { value: '', label: t('replays.filters.anyMatchup', 'Any') },
    ...ONE_V_ONE_MATCHUPS.map(m => ({
      value: m,
      label: formatMatchup(
        m.split('-').map(r => [r]),
        t,
      ),
    })),
  ]

  const mapOptions: Array<ChipOption<string>> = [
    { value: '', label: t('replays.filters.anyMap', 'Any') },
    ...maps.map(m => ({ value: m, label: filterColorCodes(m) })),
  ]
  if (mapName && !maps.includes(mapName)) {
    mapOptions.push({ value: mapName, label: filterColorCodes(mapName) })
  }

  const sortOptions: Array<ChipOption<GameSortOption>> = [
    { value: GameSortOption.LatestFirst, label: t('replays.filters.latestFirst', 'Latest first') },
    { value: GameSortOption.OldestFirst, label: t('replays.filters.oldestFirst', 'Oldest first') },
  ]
  if (canSortByLength) {
    sortOptions.push(
      {
        value: GameSortOption.LongestFirst,
        label: t('replays.filters.longestFirst', 'Longest first'),
      },
      {
        value: GameSortOption.ShortestFirst,
        label: t('replays.filters.shortestFirst', 'Shortest first'),
      },
    )
  }

  return (
    <Root>
      <DropdownChip
        label={t('replays.filters.date', 'Date:')}
        options={dateOptions}
        value={date}
        isSet={date !== undefined}
        onChange={onDateChange}
      />
      <DropdownChip
        label={t('replays.filters.length', 'Length:')}
        options={durationOptions}
        value={duration}
        isSet={duration !== GameDurationFilter.All}
        onChange={onDurationChange}
      />
      {showMatchup ? (
        <DropdownChip
          label={t('replays.filters.matchup', 'Matchup:')}
          options={matchupOptions}
          value={matchup ?? ''}
          isSet={!!matchup}
          onChange={m => onMatchupChange(m ? makeEncodedMatchupString(m) : undefined)}
        />
      ) : null}
      <DropdownChip
        label={t('replays.filters.map', 'Map:')}
        options={mapOptions}
        value={mapName}
        isSet={!!mapName}
        onChange={onMapNameChange}
      />
      <DropdownChip
        label={t('replays.filters.sort', 'Sort:')}
        options={sortOptions}
        value={sort}
        isSet={sort !== GameSortOption.LatestFirst}
        onChange={onSortChange}
      />
      <Spacer />
      <ClearButton type='button' onClick={onClear}>
        {t('replays.filters.clear', 'Clear filters')}
      </ClearButton>
    </Root>
  )
}
