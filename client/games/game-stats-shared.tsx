import { TFunction } from 'i18next'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { getErrorStack } from '../../common/errors'
import { getGameDurationString } from '../../common/games/game-duration'
import { GamePlayerStats, GameStatsResult } from '../../common/games/game-stats'
import { RaceChar } from '../../common/races'
import { numberFormat, useFormat } from '../i18n/locale-formats'
import logger from '../logging/logger'
import { buttonReset } from '../material/button-reset'
import { panelSurface } from '../material/panel'
import { RaceTag } from '../material/race-tag'
import { PlayerNameButton } from '../players/player-card'
import { getRaceColor } from '../styles/colors'
import {
  bodyMedium,
  bodySmall,
  labelLarge,
  labelMedium,
  labelSmall,
  singleLine,
  titleMedium,
} from '../styles/typography'
import { Side } from './game-stats-model'

export const MINERALS_COLOR = 'var(--theme-data-minerals)'
export const GAS_COLOR = 'var(--theme-data-gas)'

export const RESULT_COLORS: Record<GameStatsResult, string> = {
  win: 'var(--theme-positive)',
  loss: 'var(--theme-negative)',
  unknown: 'var(--theme-outline-variant)',
}

export function raceColor(race: RaceChar | undefined) {
  return race ? getRaceColor(race) : 'var(--theme-on-surface-variant)'
}

/**
 * Each player's color, in the order players are listed. Race colors can't tell apart players of the
 * same race, and the colors players had in the game depend on each viewer's settings, so players
 * get colors of their own, in hues the races don't use.
 */
const PLAYER_COLORS = [
  'var(--theme-player-1)',
  'var(--theme-player-2)',
  'var(--theme-player-3)',
  'var(--theme-player-4)',
  'var(--theme-player-5)',
  'var(--theme-player-6)',
  'var(--theme-player-7)',
  'var(--theme-player-8)',
]

/** A color for every player, which marks them the same way everywhere on the page. */
export function getPlayerColors(sides: ReadonlyArray<Side>): ReadonlyMap<number, string> {
  return new Map(
    sides
      .flatMap(side => side.players)
      .map((player, i) => [player.id, PLAYER_COLORS[i % PLAYER_COLORS.length]]),
  )
}

/** A short upright bar in a player's color, to match them up with their lines in the charts. */
export const PlayerSwatch = styled.span<{ $color: string }>`
  width: 4px;
  height: 18px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: ${props => props.$color};
`

/** A stats panel, lit from the top like the rest of the app's panels. */
export const StatsPanel = styled.div`
  ${panelSurface};
  overflow: hidden;
`

const wholeNumber = numberFormat({ maximumFractionDigits: 0 })

/** Formats stat values for the app's language. */
export function useStatFormat() {
  return useFormat(wholeNumber)
}

const compactNumber = numberFormat({ notation: 'compact', maximumFractionDigits: 1 })

/** Formats stat values in as few characters as reads right, like 12K, for a chart's axis. */
export function useCompactStatFormat() {
  return useFormat(compactNumber)
}

export const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
`

export const SectionTitle = styled.h2`
  ${titleMedium};
  margin: 0;
  font-size: 18px;
  font-weight: 700;
`

/** A muted note under a section, saying how to read it. */
export const SectionNote = styled.p`
  ${bodySmall};
  margin: 0;
  color: var(--theme-on-surface-variant);
`

/** Text for screen readers only. */
export const VisuallyHidden = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
`

const UnavailableText = styled.span`
  color: var(--theme-on-surface-variant);
`

/** Stands in for a stat the game couldn't track. */
export function Unavailable() {
  const { t } = useTranslation()
  const label = t('gameStats.unavailable', 'Not available for this game')
  return (
    <UnavailableText title={label}>
      <span aria-hidden={true}>-</span>
      <VisuallyHidden>{label}</VisuallyHidden>
    </UnavailableText>
  )
}

const PlayerNameRoot = styled.span`
  ${labelLarge};
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 600;
`

export const PlayerNameText = styled.span`
  ${singleLine};
`

const LeftNoteText = styled.span`
  ${bodySmall};
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
  white-space: nowrap;
`

/**
 * Whether a player left before the game ended. Players on the side that loses leave as it ends,
 * which isn't leaving early.
 */
export function leftEarly(player: GamePlayerStats, durationMs: number) {
  return player.leftAtMs !== undefined && player.leftAtMs < durationMs
}

/** When a player left the game, for players who left before it ended. */
export function LeftNote({ player, durationMs }: { player: GamePlayerStats; durationMs: number }) {
  const { t } = useTranslation()
  return player.leftAtMs !== undefined && leftEarly(player, durationMs) ? (
    <LeftNoteText>
      {t('gameStats.leftAt', 'Left at {{time}}', { time: getGameDurationString(player.leftAtMs) })}
    </LeftNoteText>
  ) : null
}

/** A player's race and name, and when they left if they left before the game ended. */
export function PlayerName({
  player,
  durationMs,
}: {
  player: GamePlayerStats
  durationMs: number
}) {
  return (
    <PlayerNameRoot title={player.name}>
      {player.race ? <RaceTag race={player.race} /> : null}
      <PlayerNameText>
        <PlayerNameButton name={player.name} race={player.race}>
          {player.name}
        </PlayerNameButton>
      </PlayerNameText>
      <LeftNote player={player} durationMs={durationMs} />
    </PlayerNameRoot>
  )
}

export function getStatsResultLabel(result: GameStatsResult, t: TFunction) {
  switch (result) {
    case 'win':
      return t('gameStats.victory', 'Victory')
    case 'loss':
      return t('gameStats.defeat', 'Defeat')
    case 'unknown':
      return t('gameStats.noResult', 'No result')
    default:
      return assertUnreachable(result)
  }
}

/** A result label: a neutral chip with the label and a small dot in the result's color. */
export const ResultChip = styled.span<{ $result: GameStatsResult }>`
  ${labelMedium};

  height: 24px;
  padding: 0 10px 0 8px;

  display: inline-flex;
  align-items: center;
  gap: 6px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-full);
  background: var(--theme-container);
  color: ${props =>
    props.$result === 'unknown' ? 'var(--theme-on-surface-variant)' : RESULT_COLORS[props.$result]};
  font-weight: 700;

  &::before {
    content: '';
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: var(--radius-full);
    background: currentColor;
  }
`

const TeamChipRoot = styled.span<{ $result: GameStatsResult }>`
  ${labelSmall};
  height: 20px;
  padding: 0 6px;
  flex-shrink: 0;

  display: inline-flex;
  align-items: center;

  border: 1px solid var(--theme-outline-strong);
  border-radius: 6px;
  color: ${props =>
    props.$result === 'unknown' ? 'var(--theme-on-surface-variant)' : RESULT_COLORS[props.$result]};
  font-weight: 700;
`

/** Marks which team a player was on, in games that had teams. */
export function TeamChip({ team }: { team: Side }) {
  const { t } = useTranslation()
  return (
    <TeamChipRoot
      $result={team.result}
      title={t('gameStats.teamName', 'Team {{number}}', { number: team.number })}>
      {t('gameStats.teamShort', 'T{{number}}', { number: team.number })}
    </TeamChipRoot>
  )
}

const SectionFallback = styled.div`
  ${bodyMedium};
  padding: var(--space-4);
  color: var(--theme-on-surface-variant);
`

function SectionFallbackMessage() {
  const { t } = useTranslation()
  return (
    <SectionFallback>
      {t('gameStats.sectionFailed', "Couldn't show this part of the stats.")}
    </SectionFallback>
  )
}

/**
 * Keeps a problem displaying one part of the stats from taking down the rest of the page, which
 * still has everything else worth seeing.
 */
export class SectionErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: Error) {
    logger.error(`Error showing part of the game stats: ${getErrorStack(error)}`)
  }

  override render() {
    return this.state.failed ? <SectionFallbackMessage /> : this.props.children
  }
}

/** A row of buttons that each turn something on or off, like a player to show. */
export const Picker = styled.div`
  padding: var(--space-1);

  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 10px;
  background: var(--theme-container-low);
`

export const PickerButton = styled.button<{ $on: boolean }>`
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

/**
 * The background of the row at the moment picked on the minimap's timeline or a chart, like the
 * build step a player had reached.
 */
export const CURRENT_ROW_BACKGROUND = 'rgb(from var(--theme-amber) r g b / 0.14)'

/**
 * How visible rows are that come after the moment picked, like what nobody had said yet, so the
 * list reads as it was at that moment.
 */
export const FUTURE_ROW_OPACITY = 0.4

/** Scrolls `list`, but not the page, to show `row` if it's out of view. */
export function keepInView(list: HTMLElement, row: HTMLElement) {
  const top = row.offsetTop - list.offsetTop
  if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTop = top - (list.clientHeight - row.offsetHeight) / 2
  }
}

/** The last of `items` at or before the moment picked, or -1 if none or nothing is picked. */
export function findCurrentIndex(
  items: ReadonlyArray<{ timeMs: number }>,
  timeMs: number | undefined,
) {
  return timeMs === undefined ? -1 : items.findLastIndex(item => item.timeMs <= timeMs)
}

/**
 * A player in a legend, which picks them out to make them easier to follow, like their lines in
 * every chart.
 */
export const LegendButton = styled.button<{ $dimmed: boolean }>`
  ${buttonReset};
  ${labelLarge};
  height: 28px;
  padding: 0 var(--space-1);

  display: inline-flex;
  align-items: center;
  gap: 6px;

  border-radius: var(--radius-sm);
  color: var(--theme-on-surface);
  font-size: 13px;
  font-weight: 600;
  opacity: ${props => (props.$dimmed ? 0.45 : 1)};
  cursor: pointer;

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`
