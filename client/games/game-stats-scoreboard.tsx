import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { getGameDurationString } from '../../common/games/game-duration'
import { ArmyWorth, GamePlayerStats } from '../../common/games/game-stats'
import { Tooltip } from '../material/tooltip'
import { bodyMedium, bodySmall, labelMedium } from '../styles/typography'
import { Side } from './game-stats-model'
import {
  GAS_COLOR,
  leftEarly,
  MINERALS_COLOR,
  PlayerName,
  raceColor,
  StatsPanel,
  TeamChip,
  Unavailable,
  useStatFormat,
  VisuallyHidden,
} from './game-stats-shared'

export interface ScoreColumn {
  id: string
  label: string
  /** Undefined when the game couldn't track this stat for the player. */
  get: (player: GamePlayerStats) => number | undefined
  color?: string
  /** The column the rest are about, which stands out in bold. */
  primary?: boolean
  /** Whether less is better, so the lowest stands out as the best rather than the highest. */
  lowerIsBetter?: boolean
  /** Whether no value is better than another, like a way of playing, so none stands out. */
  neutral?: boolean
  /** Shows a value some other way than as a number, like a length of time. */
  format?: (value: number) => string
  /** Whether this is the first of a group of columns that measure the same kind of thing. */
  startsGroup?: boolean
  /** The minerals and gas behind a value, shown under it. */
  split?: (player: GamePlayerStats) => ArmyWorth | undefined
  /** Says what the column's values mean, on hover. */
  description?: string
  /** The value a full bar stands for, if not the column's highest. */
  max?: number
}

const ScoreboardPanel = styled(StatsPanel)`
  overflow-x: auto;
`

/**
 * Stat columns share the room left over equally, but never get narrower than their widest value or
 * title, so every column's numbers line up and none of the titles wrap.
 */
const ScoreGrid = styled.div<{ $columns: number; $showRank: boolean; $minWidth?: number }>`
  min-width: ${props => (props.$minWidth ? `${props.$minWidth}px` : 'auto')};
  display: grid;
  grid-template-columns: ${props =>
    [
      props.$showRank ? '40px' : '',
      'minmax(160px, max-content)',
      `repeat(${props.$columns}, minmax(max-content, 1fr))`,
    ].join(' ')};
`

const GridRow = styled.div`
  display: contents;
`

const groupStart = css<{ $startsGroup?: boolean }>`
  border-left: 1px solid
    ${props => (props.$startsGroup ? 'var(--theme-outline-variant)' : 'transparent')};
`

const HeaderCell = styled.div<{
  $primary?: boolean
  $startsGroup?: boolean
  $alignStart?: boolean
}>`
  ${labelMedium};
  ${groupStart};
  padding: 12px 10px 10px;

  display: flex;
  align-items: flex-end;
  justify-content: ${props => (props.$alignStart ? 'flex-start' : 'flex-end')};

  border-bottom: 1px solid var(--theme-outline-variant);
  color: ${props => (props.$primary ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)')};
  font-weight: 600;
  white-space: nowrap;
`

/** Rows are one fixed height, with every cell's content centered top to bottom in it. */
const ROW_HEIGHT = 68
const VALUE_HEIGHT = 22
const BAR_GAP = 4
const BAR_HEIGHT = 4

const BodyCell = styled.div<{ $first: boolean }>`
  height: ${ROW_HEIGHT}px;
  min-width: 0;
  padding: 0 10px;

  display: flex;
  align-items: center;

  border-top: 1px solid ${props => (props.$first ? 'transparent' : 'var(--theme-outline-variant)')};
`

const RankCell = styled(BodyCell)<{ $rank: number }>`
  ${bodyMedium};
  color: ${props =>
    props.$rank === 1 ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)'};
  font-weight: 700;
`

const PlayerCell = styled(BodyCell)`
  ${bodyMedium};
  gap: var(--space-2);
`

const ScoreCell = styled(BodyCell)<{ $startsGroup?: boolean }>`
  ${groupStart};

  flex-direction: column;
  justify-content: center;
  align-items: flex-end;
`

const ScoreValue = styled.span<{ $leader: boolean; $primary: boolean }>`
  ${bodyMedium};
  height: ${VALUE_HEIGHT}px;

  /*
   * The best value stands on a soft pill rather than in a color of its own, so it can't be taken
   * for a race, minerals or gas. The pill ends where the bar under it does.
   */
  display: flex;
  align-items: center;
  padding: 0 ${props => (props.$leader ? 4 : 0)}px;
  border-radius: 5px;
  background: ${props =>
    props.$leader ? 'rgb(from var(--theme-on-surface) r g b / 0.12)' : 'transparent'};
  color: var(--theme-on-surface);
  font-weight: ${props => (props.$leader || props.$primary ? 700 : 400)};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const SplitText = styled.span`
  ${bodySmall};
  margin-top: 3px;
  line-height: 14px;

  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const ScoreBarTrack = styled.span`
  align-self: stretch;
  height: ${BAR_HEIGHT}px;
  margin-top: ${BAR_GAP}px;

  display: flex;
  justify-content: flex-end;

  border-radius: var(--radius-full);
  background: var(--theme-container-highest);
  overflow: hidden;
`

const ScoreBar = styled.span<{ $fraction: number; $color: string }>`
  width: ${props => props.$fraction * 100}%;
  height: 100%;
  border-radius: var(--radius-full);
  background: ${props => props.$color};
`

const MineralsText = styled.span`
  color: ${MINERALS_COLOR};
`

const GasText = styled.span`
  color: ${GAS_COLOR};
`

/** The minerals and gas behind a value. */
function ResourceSplit({ column, resources }: { column: ScoreColumn; resources?: ArmyWorth }) {
  const { t } = useTranslation()
  const format = useStatFormat()
  if (!column.split || !resources) {
    return null
  }
  return (
    <SplitText>
      <MineralsText>{format.format(resources.minerals)}</MineralsText>
      <VisuallyHidden> {t('gameStats.minerals', 'Minerals')}</VisuallyHidden>
      &nbsp;/&nbsp;
      <GasText>{format.format(resources.gas)}</GasText>
      <VisuallyHidden> {t('gameStats.gas', 'Gas')}</VisuallyHidden>
    </SplitText>
  )
}

/** Every player's main stats side by side, ranked by total score. */
export function Scoreboard({
  players,
  teamsByPlayer,
  durationMs,
}: {
  players: ReadonlyArray<GamePlayerStats>
  teamsByPlayer: ReadonlyMap<number, Side>
  durationMs: number
}) {
  const { t } = useTranslation()
  // Grouped by what they measure: the score, then units, the economy and speed.
  const columns: ScoreColumn[] = [
    {
      id: 'totalScore',
      label: t('gameStats.totalScore', 'Total score'),
      get: p => p.totalScore,
      primary: true,
      description: t(
        'gameStats.totalScoreDescription',
        "The score screen's units, buildings, kills and razings, plus resources mined.",
      ),
    },
    {
      id: 'armyProduced',
      label: t('gameStats.armyProduced', 'Army produced'),
      get: p => p.armyProduced?.score,
      split: p => p.armyProduced,
      description: t(
        'gameStats.armyProducedDescription',
        "StarCraft's score for the army units made, which counts gas and tech for more than " +
          'minerals. Below it, the minerals / gas they cost.',
      ),
      startsGroup: true,
    },
    {
      id: 'armyKilled',
      label: t('gameStats.armyKilled', 'Army killed'),
      get: p => p.armyKilled?.score,
      split: p => p.armyKilled,
      description: t(
        'gameStats.armyKilledDescription',
        "The same score for the enemy army units this player killed, and what they'd cost.",
      ),
    },
    {
      id: 'armyLost',
      label: t('gameStats.armyLost', 'Army lost'),
      get: p => p.armyLost?.score,
      split: p => p.armyLost,
      description: t(
        'gameStats.armyLostDescription',
        "The same score for this player's army units that died, and what they'd cost.",
      ),
      lowerIsBetter: true,
    },
    {
      id: 'minerals',
      label: t('gameStats.minerals', 'Minerals'),
      get: p => p.mineralsMined,
      color: MINERALS_COLOR,
      startsGroup: true,
    },
    { id: 'gas', label: t('gameStats.gas', 'Gas'), get: p => p.gasMined, color: GAS_COLOR },
    {
      id: 'averageUnspent',
      label: t('gameStats.averageUnspent', 'Avg. unspent'),
      get: p => p.averageUnspent,
      color: 'var(--theme-data-unspent)',
      lowerIsBetter: true,
      description: t(
        'gameStats.averageUnspentDescription',
        'Minerals and gas on hand, on average, while under 190 supply.',
      ),
    },
    {
      id: 'supplyBlocked',
      label: t('gameStats.supplyBlocked', 'Supply blocked'),
      get: p => p.supplyBlockedMs,
      color: 'var(--theme-data-supply-blocked)',
      lowerIsBetter: true,
      format: getGameDurationString,
      description: t(
        'gameStats.supplyBlockedDescription',
        'Time spent unable to make units for lack of supply, after the first 3 minutes.',
      ),
    },
    {
      id: 'apm',
      label: t('gameStats.apm', 'APM'),
      get: p => p.apm,
      startsGroup: true,
      description: t('gameStats.apmDescription', 'Actions per minute, every click and key.'),
    },
    {
      id: 'eapm',
      label: t('gameStats.eapm', 'EAPM'),
      get: p => p.eapm,
      description: t(
        'gameStats.eapmDescription',
        'Actions per minute that did something. Spam like repeated clicks, orders past a full ' +
          'queue and instant cancels is left out.',
      ),
    },
  ]
  return (
    <PlayerStatsGrid
      players={players}
      teamsByPlayer={teamsByPlayer}
      columns={columns}
      durationMs={durationMs}
      minWidth={1040}
    />
  )
}

/**
 * Players' stats side by side, a row for each in the order given, with a bar under every value and
 * the best in each column picked out.
 */
export function PlayerStatsGrid({
  players,
  teamsByPlayer,
  columns,
  durationMs,
  showRank = true,
  minWidth,
}: {
  players: ReadonlyArray<GamePlayerStats>
  teamsByPlayer: ReadonlyMap<number, Side>
  columns: ReadonlyArray<ScoreColumn>
  durationMs: number
  /** Whether to number the rows, for players given in ranked order. */
  showRank?: boolean
  /** How narrow the grid can get before it scrolls instead, if not to fit its columns. */
  minWidth?: number
}) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const highests = columns.map(column => Math.max(0, ...players.map(p => column.get(p) ?? 0)))
  const maxes = columns.map((column, i) => column.max ?? highests[i])
  // A player who left early had less time to lose units or get supply blocked, so for the numbers
  // where less is better only the players who stayed until the end can be the best, unless nobody
  // did.
  const stayed = players.filter(p => !leftEarly(p, durationMs))
  const lowestFrom = stayed.length ? stayed : players
  const canBeBest = (column: ScoreColumn, player: GamePlayerStats) =>
    !column.lowerIsBetter || lowestFrom.includes(player)
  // The best value in each column, if anyone stands out. A column where everyone is the same, like
  // nobody being supply blocked, has nobody to pick out.
  const bests = columns.map((column, i) => {
    if (column.neutral) {
      return undefined
    }
    if (!column.lowerIsBetter) {
      return highests[i] > 0 ? highests[i] : undefined
    }
    const values = lowestFrom.map(p => column.get(p)).filter(value => value !== undefined)
    const lowest = Math.min(...values)
    return values.some(value => value !== lowest) ? lowest : undefined
  })

  return (
    <ScoreboardPanel>
      <ScoreGrid role='table' $columns={columns.length} $showRank={showRank} $minWidth={minWidth}>
        <GridRow role='row'>
          {showRank ? (
            <HeaderCell role='columnheader' $alignStart={true}>
              <span aria-hidden={true}>#</span>
              <VisuallyHidden>{t('gameStats.rank', 'Rank')}</VisuallyHidden>
            </HeaderCell>
          ) : null}
          <HeaderCell role='columnheader' $alignStart={true}>
            {t('gameStats.player', 'Player')}
          </HeaderCell>
          {columns.map(column => (
            <HeaderCell
              key={column.id}
              role='columnheader'
              $primary={column.primary}
              $startsGroup={column.startsGroup}>
              {column.description ? (
                <Tooltip text={column.description} position='top'>
                  {column.label}
                </Tooltip>
              ) : (
                column.label
              )}
            </HeaderCell>
          ))}
        </GridRow>
        {players.map((player, i) => {
          const team = teamsByPlayer.get(player.id)
          const first = i === 0
          return (
            <GridRow key={player.id} role='row'>
              {showRank ? (
                <RankCell role='cell' $first={first} $rank={i + 1}>
                  {i + 1}
                </RankCell>
              ) : null}
              <PlayerCell role='rowheader' $first={first}>
                <PlayerName player={player} durationMs={durationMs} />
                {team ? <TeamChip team={team} /> : null}
              </PlayerCell>
              {columns.map((column, j) => {
                const value = column.get(player)
                let shown: React.ReactNode
                if (value === undefined) {
                  shown = <Unavailable />
                } else {
                  shown = column.format ? column.format(value) : format.format(value)
                }
                return (
                  <ScoreCell
                    key={column.id}
                    role='cell'
                    $first={first}
                    $startsGroup={column.startsGroup}>
                    <ScoreValue
                      $leader={
                        value !== undefined && value === bests[j] && canBeBest(column, player)
                      }
                      $primary={!!column.primary}>
                      {shown}
                    </ScoreValue>
                    <ScoreBarTrack>
                      <ScoreBar
                        $fraction={value !== undefined && maxes[j] > 0 ? value / maxes[j] : 0}
                        $color={column.color ?? raceColor(player.race)}
                      />
                    </ScoreBarTrack>
                    <ResourceSplit column={column} resources={column.split?.(player)} />
                  </ScoreCell>
                )
              })}
            </GridRow>
          )
        })}
      </ScoreGrid>
    </ScoreboardPanel>
  )
}
