import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { getGameDurationString } from '../../common/games/game-duration'
import { GamePlayerStats } from '../../common/games/game-stats'
import { buildKey } from '../../common/games/player-metrics'
import { bodyMedium, labelMedium, singleLine } from '../styles/typography'
import { GameIcon } from './game-icon'
import { BuildOrderRow, toBuildOrderRows } from './game-stats-model'
import { raceColor, StatsPanel, VisuallyHidden } from './game-stats-shared'

const stepColumns = css`
  display: grid;
  grid-template-columns: 52px 52px minmax(0, 1fr);
  column-gap: 8px;
`

const StepHeader = styled.div`
  ${labelMedium};
  ${stepColumns};
  padding: 12px 18px;
  background: var(--theme-container);
  color: var(--theme-on-surface-variant);
  font-weight: 600;
`

/** Long games make long build orders, so they scroll rather than stretch the page. */
const StepList = styled.ol`
  max-height: 560px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
`

const StepRow = styled.li`
  ${bodyMedium};
  ${stepColumns};
  height: 34px;
  padding: 0 18px;
  align-items: center;
  border-top: 1px solid var(--theme-outline-variant);
`

const StepNumber = styled.span`
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

/** A step's icon and name. */
const StepNameCell = styled.span`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
`

/** Names stay on one line, so every step is the same height and lines up across players. */
const StepName = styled.span<{ $cancelled: boolean; $buildingColor?: string }>`
  ${singleLine};
  min-width: 0;
  color: ${props => {
    if (props.$cancelled) {
      return 'var(--theme-on-surface-variant)'
    }
    return props.$buildingColor ?? 'var(--theme-on-surface)'
  }};
  font-weight: ${props => (props.$buildingColor ? 600 : 400)};
  text-decoration: ${props => (props.$cancelled ? 'line-through' : 'none')};
`

const NoSteps = styled.div`
  ${bodyMedium};
  padding: 12px 18px;
  border-top: 1px solid var(--theme-outline-variant);
  color: var(--theme-on-surface-variant);
`

function BuildStepRow({ row, buildingColor }: { row: BuildOrderRow; buildingColor: string }) {
  const { t } = useTranslation()
  const name =
    row.count > 1
      ? t('gameStats.buildStepCount', '{{name}} ×{{count}}', { name: row.name, count: row.count })
      : row.name
  return (
    <StepRow>
      <StepNumber>{getGameDurationString(row.timeMs)}</StepNumber>
      <StepNumber>{row.supply ?? '-'}</StepNumber>
      <StepNameCell>
        <GameIcon
          buildKey={buildKey({ kind: row.kind, id: row.id })}
          size={26}
          color={row.cancelled ? 'var(--theme-on-surface-variant)' : undefined}
        />
        <StepName
          $cancelled={row.cancelled}
          $buildingColor={row.isBuilding ? buildingColor : undefined}>
          {row.cancelled
            ? t('gameStats.buildStepCanceledName', '{{name}} (canceled)', { name })
            : name}
        </StepName>
      </StepNameCell>
    </StepRow>
  )
}

/** Scrolls every list in `group` to where `source` is scrolled. */
function scrollWith(source: HTMLElement, group: ReadonlySet<HTMLElement>) {
  for (const other of group) {
    if (other !== source && other.scrollTop !== source.scrollTop) {
      other.scrollTop = source.scrollTop
    }
  }
}

/**
 * What a player started making, researching and upgrading, in order. Buildings stand out in the
 * player's race color, and units made one after another are counted together.
 */
export function PlayerBuildOrder({
  player,
  scrollGroup,
}: {
  player: GamePlayerStats
  /**
   * Build orders shown side by side, which scroll together so their steps stay lined up. Each one
   * adds its list while it's shown.
   */
  scrollGroup?: Set<HTMLOListElement>
}) {
  const { t } = useTranslation()
  const rows = player.buildOrder ? toBuildOrderRows(player.buildOrder, t) : undefined

  let content: React.ReactNode
  if (!rows) {
    content = <NoSteps>{t('gameStats.unavailable', 'Not available for this game')}</NoSteps>
  } else if (!rows.length) {
    content = <NoSteps>{t('gameStats.none', 'None')}</NoSteps>
  } else {
    content = (
      <StepList
        ref={list => {
          if (!list || !scrollGroup) {
            return undefined
          }
          scrollGroup.add(list)
          return () => {
            scrollGroup.delete(list)
          }
        }}
        onScroll={event => {
          if (scrollGroup) {
            scrollWith(event.currentTarget, scrollGroup)
          }
        }}>
        {rows.map((row, i) => (
          <BuildStepRow key={i} row={row} buildingColor={raceColor(player.race)} />
        ))}
      </StepList>
    )
  }

  return (
    <StatsPanel>
      <VisuallyHidden as='h3'>
        {t('gameStats.playerBuildOrder', "{{name}}'s build order", { name: player.name })}
      </VisuallyHidden>
      <StepHeader aria-hidden={true}>
        <span>{t('gameStats.buildStepTime', 'Time')}</span>
        <span>{t('gameStats.buildStepSupply', 'Supply')}</span>
        <span>{t('gameStats.buildOrder', 'Build order')}</span>
      </StepHeader>
      {content}
    </StatsPanel>
  )
}
