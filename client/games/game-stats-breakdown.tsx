import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GamePlayerStats } from '../../common/games/game-stats'
import { buttonReset } from '../material/button-reset'
import { RaceTag } from '../material/race-tag'
import { PlayerNameButton } from '../players/player-card'
import { bodyMedium, labelLarge, labelMedium, singleLine } from '../styles/typography'
import { PlayerBuildOrder } from './game-stats-build-orders'
import { Side, toUnitEntries, UnitEntry } from './game-stats-model'
import {
  PlayerSwatch,
  raceColor,
  Section,
  SectionErrorBoundary,
  SectionNote,
  SectionTitle,
  StatsPanel,
  useStatFormat,
} from './game-stats-shared'

const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;

  & > ${SectionTitle} {
    flex: 1 1 auto;
  }
`

const Picker = styled.div`
  padding: 4px;

  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 10px;
  background: var(--theme-container-low);
`

const PickerButton = styled.button<{ $on: boolean }>`
  ${buttonReset};
  ${labelLarge};
  height: 30px;
  padding: 0 12px 0 10px;

  display: inline-flex;
  align-items: center;
  gap: 6px;

  border-radius: 6px;
  background: ${props => (props.$on ? 'var(--theme-container-highest)' : 'transparent')};
  color: ${props => (props.$on ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)')};
  font-weight: 600;
  cursor: pointer;

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

/** How many players fit side by side before the rest wrap onto another row. */
const PLAYERS_PER_ROW = 3

const PanelRows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

/**
 * One column per player, with everyone's units in the first row and build orders in the second,
 * so each player's build order starts on the same line and steps can be compared across.
 */
const PanelsGrid = styled.div<{ $count: number }>`
  display: grid;
  grid-template-columns: repeat(${props => props.$count}, minmax(0, 1fr));
  grid-template-rows: auto auto;
  grid-auto-flow: column;
  gap: 12px;
`

/** The tabs drop below the name when a long one wouldn't leave them room. */
const UnitsHeader = styled.div`
  min-height: 56px;
  padding: 10px 12px 10px 18px;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;

  background: var(--theme-container);
`

const UnitsPlayer = styled.h3`
  ${bodyMedium};
  flex: 1 1 140px;
  min-width: 0;
  margin: 0;

  display: flex;
  align-items: center;
  gap: 8px;

  font-weight: 600;
`

const UnitsPlayerName = styled.span`
  ${singleLine};
`

const Tabs = styled.div`
  padding: 3px;
  flex-shrink: 0;

  display: inline-flex;
  gap: 2px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-full);
  background: var(--theme-surface);
`

const Tab = styled.button<{ $on: boolean }>`
  ${buttonReset};
  ${labelMedium};
  height: 26px;
  padding: 0 12px;

  border-radius: var(--radius-full);
  background: ${props => (props.$on ? 'var(--theme-container-highest)' : 'transparent')};
  color: ${props => (props.$on ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)')};
  font-weight: 600;
  cursor: pointer;

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const UnitList = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
`

const UnitRow = styled.li<{ $none: boolean }>`
  ${bodyMedium};
  height: 40px;
  padding: 0 18px;

  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) 56px;
  align-items: center;
  gap: 12px;

  border-top: 1px solid var(--theme-outline-variant);
  color: ${props => (props.$none ? 'var(--theme-on-surface-variant)' : 'var(--theme-on-surface)')};
`

const UnitBarTrack = styled.span`
  height: 6px;
  display: flex;
  border-radius: var(--radius-full);
  background: var(--theme-container-highest);
  overflow: hidden;
`

const UnitBar = styled.span<{ $fraction: number; $color: string }>`
  width: ${props => props.$fraction * 100}%;
  background: ${props => props.$color};
`

const UnitName = styled.span`
  ${singleLine};
`

const UnitCount = styled.span`
  text-align: right;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`

const EmptyUnits = styled.div`
  ${bodyMedium};
  padding: 12px 18px;
  border-top: 1px solid var(--theme-outline-variant);
  color: var(--theme-on-surface-variant);
`

type UnitView = 'produced' | 'killed' | 'lost'

const UNIT_VIEWS: ReadonlyArray<UnitView> = ['produced', 'killed', 'lost']

/**
 * The units a player made, the enemy units they killed or the units they lost, most first.
 * Buildings are left out, since the build order lists them. Lost also lists the units that were
 * made but never died, at zero.
 */
function getUnitRows(
  player: GamePlayerStats,
  view: UnitView,
  t: Parameters<typeof toUnitEntries>[1],
): UnitEntry[] | undefined {
  const units = (counts: GamePlayerStats['produced']) =>
    counts && toUnitEntries(counts, t).filter(entry => !entry.isBuilding)
  let rows: UnitEntry[] | undefined
  if (view === 'produced') {
    rows = units(player.produced)
  } else if (view === 'killed') {
    rows = units(player.kills)
  } else {
    const lost = units(player.deaths)
    const produced = units(player.produced) ?? []
    rows = lost && [
      ...lost,
      ...produced
        .filter(entry => !lost.some(l => l.name === entry.name))
        .map(entry => ({ ...entry, count: 0 })),
    ]
  }
  return rows?.toSorted((a, b) => b.count - a.count)
}

function PlayerUnits({ player, color }: { player: GamePlayerStats; color: string }) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const [view, setView] = useState<UnitView>('produced')
  const rows = getUnitRows(player, view, t)
  const max = Math.max(1, ...(rows ?? []).map(row => row.count))
  const labels: Record<UnitView, string> = {
    produced: t('gameStats.produced', 'Produced'),
    killed: t('gameStats.killed', 'Killed'),
    lost: t('gameStats.lost', 'Lost'),
  }

  let content: React.ReactNode
  if (!rows) {
    content = <EmptyUnits>{t('gameStats.unavailable', 'Not available for this game')}</EmptyUnits>
  } else if (!rows.length) {
    content = <EmptyUnits>{t('gameStats.none', 'None')}</EmptyUnits>
  } else {
    content = (
      <UnitList>
        {rows.map(row => (
          <UnitRow key={row.name} $none={row.count === 0}>
            <UnitBarTrack aria-hidden={true}>
              <UnitBar $fraction={row.count / max} $color={raceColor(row.race)} />
            </UnitBarTrack>
            <UnitName>{row.name}</UnitName>
            <UnitCount>{format.format(row.count)}</UnitCount>
          </UnitRow>
        ))}
      </UnitList>
    )
  }

  return (
    <StatsPanel>
      <UnitsHeader>
        <UnitsPlayer>
          <PlayerSwatch $color={color} />
          {player.race ? <RaceTag race={player.race} /> : null}
          <UnitsPlayerName>
            <PlayerNameButton name={player.name} race={player.race}>
              {player.name}
            </PlayerNameButton>
          </UnitsPlayerName>
        </UnitsPlayer>
        <Tabs role='tablist' aria-label={t('gameStats.units', 'Units')}>
          {UNIT_VIEWS.map(unitView => (
            <Tab
              key={unitView}
              type='button'
              role='tab'
              aria-selected={view === unitView}
              $on={view === unitView}
              onClick={() => setView(unitView)}>
              {labels[unitView]}
            </Tab>
          ))}
        </Tabs>
      </UnitsHeader>
      <div role='tabpanel' aria-label={labels[view]}>
        {content}
      </div>
    </StatsPanel>
  )
}

function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/**
 * The units and build orders of the players picked, side by side. One from each of the first two
 * sides is shown to start with, and any others can be added.
 */
export function UnitsAndBuildOrders({
  sides,
  playerColors,
}: {
  sides: ReadonlyArray<Side>
  playerColors: ReadonlyMap<number, string>
}) {
  const { t } = useTranslation()
  const players = sides.flatMap(side => side.players)
  const [buildOrderScrollGroup] = useState(() => new Set<HTMLOListElement>())
  const [shownIds, setShownIds] = useState<ReadonlyArray<number>>(() =>
    sides
      .slice(0, 2)
      .map(side => side.players[0]?.id)
      .filter(id => id !== undefined),
  )
  // Players stay in the order they're listed in, and at least one is always shown.
  const toggle = (id: number) => {
    if (!shownIds.includes(id)) {
      setShownIds([...shownIds, id])
    } else if (shownIds.length > 1) {
      setShownIds(shownIds.filter(shownId => shownId !== id))
    }
  }
  const shown = players.filter(player => shownIds.includes(player.id))

  return (
    <Section>
      <Header>
        <SectionTitle>{t('gameStats.unitsAndBuildOrders', 'Units and build orders')}</SectionTitle>
        {players.length > 1 ? (
          <Picker role='group' aria-label={t('gameStats.shownPlayers', 'Players shown')}>
            {players.map(player => (
              <PickerButton
                key={player.id}
                type='button'
                aria-pressed={shownIds.includes(player.id)}
                $on={shownIds.includes(player.id)}
                onClick={() => toggle(player.id)}>
                <PlayerSwatch $color={playerColors.get(player.id) ?? 'transparent'} />
                {player.race ? <RaceTag race={player.race} /> : null}
                {player.name}
              </PickerButton>
            ))}
          </Picker>
        ) : null}
      </Header>
      <PanelRows>
        {chunk(shown, PLAYERS_PER_ROW).map(row => (
          <PanelsGrid key={row[0].id} $count={Math.min(shown.length, PLAYERS_PER_ROW)}>
            {row.map(player => [
              <SectionErrorBoundary key={`units-${player.id}`}>
                <PlayerUnits player={player} color={playerColors.get(player.id) ?? 'transparent'} />
              </SectionErrorBoundary>,
              <SectionErrorBoundary key={`build-${player.id}`}>
                <PlayerBuildOrder player={player} scrollGroup={buildOrderScrollGroup} />
              </SectionErrorBoundary>,
            ])}
          </PanelsGrid>
        ))}
      </PanelRows>
      <SectionNote>
        {t(
          'gameStats.buildOrderStepsNote',
          'Each step shows when it started. Workers are left out, since the supply counts them. ' +
            "Buildings are in the player's race color, and canceled steps are struck through.",
        )}
      </SectionNote>
    </Section>
  )
}
