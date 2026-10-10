import { useAtom } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { LadderRank } from '../../common/games/ladder'
import { MapFamily } from '../../common/games/map-family'
import { RankMmr } from '../../common/my-stats/coach'
import { DEFAULT_EAPM_FLOOR, EAPM_FLOORS } from '../../common/my-stats/coach'
import { MyStatsRange, MyStatsShape, RACE_PAIRS, RacePair } from '../../common/my-stats/my-stats'
import { splitsByMap } from '../../common/my-stats/player-games'
import { AssignedRaceChar } from '../../common/races'
import { useFitLevel } from '../dom/use-fit-level'
import { Segmented, SegmentMenu, SegmentOption } from '../material/segmented'
import { labelMedium } from '../styles/typography'
import { myStatsFiltersAtom } from './my-stats-data'
import { RankMenu } from './rank-menu'

/**
 * How the filter bar gives up room in a narrow window, so it always stays one row. Each level
 * keeps the ones before it.
 */
const FitLevel = {
  Full: 0,
  /** The map turns into a menu. */
  MapMenu: 1,
  /** The race filters turn into menus. */
  RaceMenus: 2,
  /** The game type turns into a menu too. */
  GameTypeMenu: 3,
} as const

/** Stays in view while the page scrolls, so the filters never need a trip back to the top. */
const Root = styled.div`
  position: sticky;
  top: 0;
  z-index: 3;
  margin: -10px 0;
  padding: 10px 0;

  display: flex;
  align-items: flex-end;
  gap: 12px;

  background-color: var(--theme-container-lowest);
`

const FieldRoot = styled.div`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const Caption = styled.span`
  ${labelMedium};
  padding-left: 2px;
  color: var(--theme-on-surface-variant);
  font-weight: 600;
`

/** One filter with its name above it, so every control in the bar lines up on one row. */
function Field({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <FieldRoot>
      <Caption aria-hidden={true}>{caption}</Caption>
      {children}
    </FieldRoot>
  )
}

/**
 * A filter shown as segments when there's room, or as a menu of the same options when there isn't.
 */
function Choice<T>({
  label,
  options,
  value,
  onChange,
  asMenu,
}: {
  label: string
  options: ReadonlyArray<SegmentOption<T>>
  value: T
  onChange: (value: T) => void
  asMenu: boolean
}) {
  return asMenu ? (
    <SegmentMenu
      label={label}
      showLabel={false}
      options={options}
      value={value}
      onChange={onChange}
    />
  ) : (
    <Segmented label={label} options={options} value={value} onChange={onChange} />
  )
}

/**
 * Every My stats filter, in one row: the kind of game first, then what that kind of game divides
 * by (the map in 3v3 and 4v4, the opponents' races in 1v1 and 2v2), the user's race, when, and the EAPM
 * (and in 1v1, the ladder rank) other players need to be compared with. The last ones rarely
 * change, so they're menus. `autoRank` is the rank picked until the user picks one, and `rankMmr`
 * the MMRs each covers. `autoMapFamily` is likewise the map family picked until the user picks one.
 */
export function FilterBar({
  autoRank,
  rankMmr,
  autoMapFamily,
}: {
  autoRank?: LadderRank
  rankMmr?: RankMmr
  autoMapFamily?: MapFamily
}) {
  const { t } = useTranslation()
  const [filters, setFilters] = useAtom(myStatsFiltersAtom)
  const floor = filters.eapmFloor ?? DEFAULT_EAPM_FLOOR
  const [rootRef, fitLevel] = useFitLevel<HTMLDivElement>(
    FitLevel.GameTypeMenu,
    [
      filters.shape,
      filters.race,
      filters.opponentRace,
      filters.opponentPair,
      filters.mapFamily,
      filters.range,
      floor,
      filters.rank,
      autoRank,
      autoMapFamily,
    ].join('|'),
  )

  const shapes: Array<SegmentOption<MyStatsShape | undefined>> = [
    { value: undefined, label: t('myStats.filters.allTypes', 'All') },
    { value: '1v1', label: '1v1' },
    { value: '2v2', label: '2v2' },
    { value: '3v3', label: '3v3' },
    { value: '4v4', label: '4v4' },
    { value: 'ffa', label: t('myStats.ffa', 'FFA') },
  ]
  const races: Array<SegmentOption<AssignedRaceChar | undefined>> = [
    { value: undefined, label: t('myStats.filters.any', 'Any') },
    { value: 'p', label: 'P', title: t('myStats.filters.protoss', 'Protoss') },
    { value: 't', label: 'T', title: t('myStats.filters.terran', 'Terran') },
    { value: 'z', label: 'Z', title: t('myStats.filters.zerg', 'Zerg') },
  ]
  // No option for any map: each family plays like a different game, so they're never summed up
  // together.
  const maps: Array<SegmentOption<MapFamily | undefined>> = [
    { value: 'bgh', label: 'BGH', title: t('myStats.filters.bgh', 'Big Game Hunters') },
    { value: 'fastest', label: t('myStats.filters.fastest', 'Fastest') },
    {
      value: 'standard',
      label: t('myStats.filters.otherMaps', 'Other'),
      title: t('myStats.filters.otherMapsTitle', 'Maps other than Fastest and Big Game Hunters'),
    },
  ]
  const pairs: Array<SegmentOption<RacePair | undefined>> = [
    { value: undefined, label: t('myStats.filters.any', 'Any') },
    ...RACE_PAIRS.map(pair => ({ value: pair, label: pair.toUpperCase() })),
  ]
  const ranges: Array<SegmentOption<MyStatsRange>> = [
    { value: '7d', label: t('myStats.filters.lastWeek', 'Last 7 days') },
    { value: '30d', label: t('myStats.filters.lastMonth', 'Last 30 days') },
    { value: 'all', label: t('myStats.filters.allTime', 'All time') },
  ]
  const floors: Array<SegmentOption<number>> = EAPM_FLOORS.map(value => ({
    value,
    label: t('myStats.filters.floorOption', '{{floor}}+ EAPM', { floor: value }),
  }))

  const gameTypeLabel = t('myStats.filters.gameType', 'Game type')
  const mapLabel = t('myStats.filters.map', 'Map')
  const raceLabel = t('myStats.filters.you', 'You')
  const opponentLabel = t('myStats.filters.vs', 'Against')
  const rangeLabel = t('myStats.filters.range', 'Time')
  const floorLabel = t('myStats.filters.floor', 'Compared with')
  const rankLabel = t('myStats.filters.rank', 'Their rank')

  return (
    <Root ref={rootRef}>
      <Field caption={gameTypeLabel}>
        <Choice
          label={gameTypeLabel}
          options={shapes}
          value={filters.shape}
          asMenu={fitLevel >= FitLevel.GameTypeMenu}
          onChange={shape =>
            setFilters(f => ({
              ...f,
              shape,
              opponentRace: shape === '1v1' ? f.opponentRace : undefined,
              opponentPair: shape === '2v2' ? f.opponentPair : undefined,
              mapFamily: splitsByMap(shape) ? f.mapFamily : undefined,
            }))
          }
        />
      </Field>
      {splitsByMap(filters.shape) ? (
        <Field caption={mapLabel}>
          <Choice
            label={mapLabel}
            options={maps}
            value={filters.mapFamily ?? autoMapFamily}
            asMenu={fitLevel >= FitLevel.MapMenu}
            onChange={mapFamily => setFilters(f => ({ ...f, mapFamily }))}
          />
        </Field>
      ) : null}
      <Field caption={raceLabel}>
        <Choice
          label={raceLabel}
          options={races}
          value={filters.race}
          asMenu={fitLevel >= FitLevel.RaceMenus}
          onChange={race => setFilters(f => ({ ...f, race }))}
        />
      </Field>
      {filters.shape === '1v1' ? (
        <Field caption={opponentLabel}>
          <Choice
            label={opponentLabel}
            options={races}
            value={filters.opponentRace}
            asMenu={fitLevel >= FitLevel.RaceMenus}
            onChange={opponentRace => setFilters(f => ({ ...f, opponentRace }))}
          />
        </Field>
      ) : null}
      {filters.shape === '2v2' ? (
        <Field caption={opponentLabel}>
          <Choice
            label={opponentLabel}
            options={pairs}
            value={filters.opponentPair}
            asMenu={fitLevel >= FitLevel.RaceMenus}
            onChange={opponentPair => setFilters(f => ({ ...f, opponentPair }))}
          />
        </Field>
      ) : null}
      <Field caption={rangeLabel}>
        <SegmentMenu
          label={rangeLabel}
          showLabel={false}
          options={ranges}
          value={filters.range}
          onChange={range => setFilters(f => ({ ...f, range }))}
        />
      </Field>
      <Field caption={floorLabel}>
        <SegmentMenu
          label={floorLabel}
          showLabel={false}
          options={floors}
          value={floor}
          onChange={eapmFloor => setFilters(f => ({ ...f, eapmFloor }))}
        />
      </Field>
      {filters.shape === '1v1' ? (
        <Field caption={rankLabel}>
          <RankMenu autoRank={autoRank} rankMmr={rankMmr} label={rankLabel} showLabel={false} />
        </Field>
      ) : null}
    </Root>
  )
}
