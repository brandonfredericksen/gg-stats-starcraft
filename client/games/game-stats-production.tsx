import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GamePlayerStats } from '../../common/games/game-stats'
import { buildKey } from '../../common/games/player-metrics'
import { Segmented } from '../material/segmented'
import { Tooltip } from '../material/tooltip'
import { bodyMedium, labelMedium, singleLine } from '../styles/typography'
import { GameIcon } from './game-icon'
import {
  findSnapshotIndex,
  getProduction,
  getResources,
  ProductionItem,
  toProductionSteps,
} from './game-stats-production-model'
import { gameScrubAtom } from './game-stats-scrub'
import { PlayerSwatch, Section, SectionTitle, StatsPanel, useStatFormat } from './game-stats-shared'

const ICON_SIZE = 24
const TILE_SIZE = 34

const Header = styled.div`
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`

/** A player: their name, then tiles of what they have, as compact as the game's own tab. */
const PlayerRow = styled.div`
  min-height: ${TILE_SIZE}px;
  padding: 6px 12px;
  display: grid;
  grid-template-columns: minmax(0, 96px) minmax(0, 1fr);
  column-gap: 10px;
  align-items: start;
  box-sizing: content-box;

  & + & {
    border-top: 1px solid var(--theme-outline-variant);
  }
`

const PlayerName = styled.span`
  ${labelMedium};
  min-width: 0;
  height: ${TILE_SIZE}px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
`

const PlayerNameText = styled.span`
  ${singleLine};
`

const Cells = styled.ul`
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  list-style: none;
`

/** An icon with its count in the corner and, for what's in production, its progress along the bottom. */
const Cell = styled.li`
  position: relative;
  width: ${TILE_SIZE}px;
  height: ${TILE_SIZE}px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
  background: var(--theme-container);
`

const CellIcon = styled.span`
  display: flex;
`

const CellCount = styled.span`
  ${labelMedium};
  position: absolute;
  right: 3px;
  bottom: 3px;
  font-size: 11px;
  line-height: 12px;
  font-weight: 700;
  text-shadow:
    0 0 3px var(--theme-surface),
    0 0 3px var(--theme-surface);
  font-variant-numeric: tabular-nums;
`

const ProgressTrack = styled.span`
  position: absolute;
  inset: auto 0 0;
  height: 3px;
  background: var(--theme-outline-variant);
`

const ProgressFill = styled.span.attrs<{ $progress: number }>(props => ({
  style: { width: `${props.$progress * 100}%` },
}))`
  display: block;
  height: 100%;
  background: var(--theme-amber);
`

/** The last column is wider, since it holds a total and how fast it's going up. */
const RESOURCE_COLUMNS = 'minmax(0, 88px) repeat(5, minmax(0, 1fr)) minmax(0, 1.9fr)'

const ResourceHeader = styled.div`
  ${labelMedium};
  padding: 8px 12px 4px;
  display: grid;
  grid-template-columns: ${RESOURCE_COLUMNS};
  column-gap: 8px;
  color: var(--theme-on-surface-variant);
  text-align: right;
`

const ResourceRow = styled.div`
  ${bodyMedium};
  padding: 4px 12px;
  display: grid;
  grid-template-columns: ${RESOURCE_COLUMNS};
  column-gap: 8px;
  align-items: center;
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
`

const ResourceRowName = styled.span`
  ${labelMedium};
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  text-align: left;
`

/** The tooltip's wrapper copies its parent's display, which would make it a grid cell here. */
const RateTooltip = styled(Tooltip)`
  display: inline-block;
`

const ResourceRate = styled.span`
  ${labelMedium};
  white-space: nowrap;
  margin-left: 4px;
  color: var(--theme-on-surface-variant);
`

const TilesDivider = styled.div`
  border-top: 1px solid var(--theme-outline-variant);
`

const Nothing = styled.span`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

function ResourceBar({
  players,
  playerColors,
  timesMs,
  scrubMs,
}: {
  players: ReadonlyArray<GamePlayerStats>
  playerColors: ReadonlyMap<number, string>
  timesMs: ReadonlyArray<number>
  scrubMs: number | undefined
}) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const index = findSnapshotIndex(timesMs, scrubMs)
  const number = (value: number | undefined) => (value === undefined ? '-' : format.format(value))
  return (
    <>
      <ResourceHeader aria-hidden={true}>
        <span />
        <span>{t('gameStats.resourceSupply', 'Supply')}</span>
        <span>{t('gameStats.resourceWorkers', 'Workers')}</span>
        <span>{t('gameStats.resourceBases', 'Bases')}</span>
        <span>{t('gameStats.resourceArmy', 'Army')}</span>
        <span>{t('gameStats.resourceUnspent', 'Unspent')}</span>
        <span>{t('gameStats.resourceMined', 'Mined')}</span>
      </ResourceHeader>
      {players.map(player => {
        const r = getResources(player, timesMs, index)
        return (
          <ResourceRow key={player.id}>
            <ResourceRowName title={player.name}>
              <PlayerSwatch $color={playerColors.get(player.id) ?? 'transparent'} />
              <PlayerNameText>{player.name}</PlayerNameText>
            </ResourceRowName>
            <span>{r ? `${number(r.supplyUsed)} / ${number(r.supplyAvailable)}` : '-'}</span>
            <span>{number(r?.workers)}</span>
            <span>{number(r?.bases)}</span>
            <span>{number(r?.army)}</span>
            <span>{number(r?.unspent)}</span>
            <span>
              {number(r?.mined)}
              {r?.minedPerMinute !== undefined ? (
                <RateTooltip
                  position='top'
                  text={t(
                    'gameStats.resourceRateTooltip',
                    'Minerals and gas mined per minute over the last minute',
                  )}>
                  <ResourceRate>+{format.format(r.minedPerMinute)}</ResourceRate>
                </RateTooltip>
              ) : null}
            </span>
          </ResourceRow>
        )
      })}
      <TilesDivider />
    </>
  )
}

type ProductionTab = 'production' | 'units' | 'structures' | 'upgrades'

function ItemCells({ items, tab }: { items: ReadonlyArray<ProductionItem>; tab: ProductionTab }) {
  return (
    <Cells>
      {items.map(item => (
        <Cell key={item.key} title={item.name}>
          <CellIcon>
            <GameIcon buildKey={buildKey({ kind: item.kind, id: item.id })} size={ICON_SIZE} />
          </CellIcon>
          {tab === 'production' ? (
            <ProgressTrack>
              <ProgressFill $progress={item.progress ?? 0} />
            </ProgressTrack>
          ) : null}
          {item.count ? (
            <CellCount>{tab === 'upgrades' ? `+${item.count}` : `×${item.count}`}</CellCount>
          ) : null}
        </Cell>
      ))}
    </Cells>
  )
}

function ProductionRow({
  player,
  color,
  tab,
  scrubMs,
}: {
  player: GamePlayerStats
  color: string
  tab: ProductionTab
  scrubMs: number | undefined
}) {
  const { t } = useTranslation()
  // Sorted out once, so each frame of playback only adds up the steps.
  const steps = toProductionSteps(player, t)
  const production = steps ? getProduction(steps, scrubMs) : undefined
  const items = production?.[tab === 'production' ? 'producing' : tab]
  return (
    <PlayerRow>
      <PlayerName title={player.name}>
        <PlayerSwatch $color={color} />
        <PlayerNameText>{player.name}</PlayerNameText>
      </PlayerName>
      {items ? (
        <ItemCells items={items} tab={tab} />
      ) : (
        <Nothing>{t('gameStats.unavailable', 'Not available for this game')}</Nothing>
      )}
    </PlayerRow>
  )
}

/**
 * What each player has in production, and has made, at the moment the minimap is at, a tab each
 * like the StarCraft II replay's. Before anyone plays or scrubs, what's been made is by the end of
 * the game, and nothing is in production.
 */
export function GameProduction({
  players,
  playerColors,
  snapshotTimesMs,
}: {
  players: ReadonlyArray<GamePlayerStats>
  playerColors: ReadonlyMap<number, string>
  snapshotTimesMs: ReadonlyArray<number>
}) {
  const { t } = useTranslation()
  const scrubMs = useAtomValue(gameScrubAtom)?.timeMs
  const [tab, setTab] = useState<ProductionTab>('production')
  return (
    <Section>
      <Header>
        <SectionTitle>{t('gameStats.production', 'Production')}</SectionTitle>
        <Segmented
          label={t('gameStats.productionTab', 'What to show')}
          options={[
            { value: 'production' as const, label: t('gameStats.productionTabNow', 'Producing') },
            { value: 'units' as const, label: t('gameStats.productionTabUnits', 'Units') },
            {
              value: 'structures' as const,
              label: t('gameStats.productionTabStructures', 'Structures'),
            },
            { value: 'upgrades' as const, label: t('gameStats.productionTabUpgrades', 'Upgrades') },
          ]}
          value={tab}
          onChange={setTab}
        />
      </Header>
      <StatsPanel>
        <ResourceBar
          players={players}
          playerColors={playerColors}
          timesMs={snapshotTimesMs}
          scrubMs={scrubMs}
        />
        {players.map(player => (
          <ProductionRow
            key={player.id}
            player={player}
            color={playerColors.get(player.id) ?? 'transparent'}
            tab={tab}
            scrubMs={scrubMs}
          />
        ))}
      </StatsPanel>
    </Section>
  )
}
