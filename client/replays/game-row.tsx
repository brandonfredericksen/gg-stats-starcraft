import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { withAssumedResults } from '../../common/games/assumed-results'
import { getGameDurationString } from '../../common/games/game-duration'
import { FASTEST_MS_PER_FRAME } from '../../common/games/game-stats'
import { isMyPlayerName } from '../../common/games/player-names'
import { filterColorCodes } from '../../common/maps'
import { ReplayLibraryEntry } from '../../common/replays-library'
import { MapArt, useMapArt } from '../games/map-art'
import { ReplayStatsStatus, useReplayStatsStatus } from '../games/replay-stats-status'
import { useFormatLocale } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { PLAY_BUTTON_SIZE, PlayButton } from '../material/play-button'
import { AnalysisStatus, STATUS_PILL_WIDTH, StatusPill } from '../material/status-pill'
import { TeamLine } from '../material/team-line'
import { PlayerNameButton } from '../players/player-name-button'
import {
  bahnschrift,
  bodyMedium,
  bodySmall,
  singleLine,
  titleMedium,
  titleSmall,
} from '../styles/typography'
import { GameMode, getGameMode, getGameModeLabel, getGameRowLines } from './game-row-lines'
import { getReplayDisplayTeams } from './replay-library-helpers'

/** Where a row sits in its session's panel, which decides which of the panel's edges it draws. */
export type PanelEdge = 'middle' | 'last'

/** The width of the row's buttons: watch, then stats. */
const ACTIONS_WIDTH = PLAY_BUTTON_SIZE + 8 + STATUS_PILL_WIDTH

/**
 * The sides and bottom of a session's panel, drawn by its rows since a virtualized list renders
 * the header and each row as separate items.
 */
const panelSides = css<{ $edge: PanelEdge }>`
  border-left: 1px solid var(--theme-outline-variant);
  border-right: 1px solid var(--theme-outline-variant);
  background-color: var(--theme-container-low);

  ${props =>
    props.$edge === 'last'
      ? css`
          margin-bottom: 22px;
          border-bottom: 1px solid var(--theme-outline-variant);
          border-radius: 0 0 var(--radius-lg) var(--radius-lg);
        `
      : ''}
`

const Root = styled.div<{ $edge: PanelEdge }>`
  ${panelSides};
  position: relative;
  /* The row's own hairline sits inside the panel's side borders. */
  background-clip: padding-box;
  overflow: hidden;
`

const RowGrid = styled.div<{
  $selected: boolean
  $focused: boolean
  $last: boolean
  $openable: boolean
}>`
  padding: var(--space-3) var(--space-5);

  display: grid;
  /* The map keeps room for its name, so the players give way first. */
  grid-template-columns: 72px minmax(0, 600px) minmax(150px, 1fr) 56px ${ACTIONS_WIDTH}px;
  align-items: center;
  gap: 18px;

  /* Keeps the map's terrain art above the panel's background. */
  isolation: isolate;
  border-top: 1px solid var(--theme-outline-variant);
  ${props => (props.$last ? 'border-radius: 0 0 var(--radius-lg) var(--radius-lg);' : '')}
  background-color: ${props =>
    props.$selected ? 'rgb(from var(--theme-on-surface) r g b / 0.05)' : 'transparent'};
  cursor: ${props => (props.$openable ? 'pointer' : 'default')};

  ${props =>
    props.$focused
      ? css`
          outline: 2px solid var(--theme-grey-blue);
          outline-offset: -2px;
        `
      : ''}

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: -3px;
  }

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.05);
  }

  @container game-list-rows (width < 900px) {
    /*
     * The game type leaves the grid, since the teams already show it. Its track goes too, or every
     * later cell would shift. The map and time stay: they're how a game is told apart.
     */
    grid-template-columns: minmax(0, 1fr) minmax(112px, 168px) 48px ${ACTIONS_WIDTH}px;
    gap: var(--space-3);

    & > :first-child {
      display: none;
    }
  }
`

const Mode = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--theme-on-surface-variant);
`

const ModeLabel = styled.span`
  ${titleMedium};
  ${bahnschrift};
  font-weight: 700;
  color: var(--theme-on-surface);
  white-space: nowrap;
`

const Lines = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const MapAndTime = styled.div<{ $art?: MapArt }>`
  position: relative;
  min-width: 0;
  /* As tall as the row, so the art below reaches its edges however tall the players make it. */
  align-self: stretch;
  display: flex;
  flex-direction: column;
  justify-content: center;

  /*
   * A faint picture of the map behind its name, out to the row's edges above and below, fading
   * out toward the players: the map itself, scaled to cover, or a piece of its tileset's terrain.
   */
  ${props =>
    props.$art
      ? css`
          &::before {
            content: '';
            position: absolute;
            inset: -13px -9px -12px -40px;
            z-index: -1;
            background: url('${props.$art.url}')
              ${props.$art.isMap ? 'center / cover' : 'var(--art-x) var(--art-y) / 560px'};
            opacity: 0.28;
            mask-image: linear-gradient(to right, transparent, black 40%, black 70%, transparent);
          }
        `
      : ''}
`

const MapName = styled.span`
  ${bodyMedium};
  ${singleLine};
`

const Time = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const Length = styled.span`
  ${bodyMedium};
  ${bahnschrift};
  font-size: 15px;
  font-variant-numeric: tabular-nums;
`

const Actions = styled.div`
  display: grid;
  grid-template-columns: ${PLAY_BUTTON_SIZE}px ${STATUS_PILL_WIDTH}px;
  align-items: center;
  justify-content: end;
  gap: var(--space-2);
`

const ErrorLine = styled.div`
  ${bodyMedium};
  ${singleLine};
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--theme-on-surface-variant);

  & > :first-child {
    flex-shrink: 0;
    color: var(--theme-error);
  }
`

/**
 * Where a row's tileset art is cut from, so rows of the same tileset don't all show the same patch.
 * Steady for a replay, from its id.
 */
function getArtPosition(id: number): React.CSSProperties {
  return {
    '--art-x': `${(id * 37) % 100}%`,
    '--art-y': `${(id * 61) % 100}%`,
  } as React.CSSProperties
}

function getModeIcon(mode: GameMode) {
  switch (mode) {
    case 'ffa':
      return 'grid_view'
    case 'oneOnOne':
      return 'person'
    default:
      return 'group'
  }
}

function toPillStatus(status: ReplayStatsStatus): AnalysisStatus {
  switch (status.kind) {
    case 'ready':
      return 'ready'
    case 'analyzing':
    case 'queued':
      return 'running'
    default:
      return 'none'
  }
}

export interface GameRowProps {
  entry: ReplayLibraryEntry
  edge: PanelEdge
  selected: boolean
  hideResults: boolean
  myNames: ReadonlyArray<string> | undefined
  computerLabel: string
  /** The keyboard's place in the list. */
  focused: boolean
  /** Shows the date along with the time, for lists that aren't split into days. */
  showDate: boolean
  /** From `getTeamSlotWidth` over every game in the list, so names line up from row to row. */
  slotWidth: number
  /** Called on a click with Ctrl or Shift, which changes the selection instead of opening. */
  onSelect: (id: number, event: React.MouseEvent) => void
  /** Shows the game's stats, analyzing it first if needed. */
  onOpen: (entry: ReplayLibraryEntry) => void
  /** Analyzes the game in the background, without leaving the library. */
  onAnalyze: (entry: ReplayLibraryEntry) => void
  onWatch: (entry: ReplayLibraryEntry) => void
  onContextMenu: (entry: ReplayLibraryEntry, event: React.MouseEvent) => void
}

/** Whether an event happened in the row's own elements, not in a popover rendered from it. */
function isFromRow(event: React.SyntheticEvent) {
  return event.currentTarget.contains(event.target as Node)
}

/** One game in the library: its type, teams, map, length and what can be done with it. */
export function GameRow({
  entry,
  edge,
  selected,
  focused,
  showDate,
  hideResults,
  myNames,
  slotWidth,
  computerLabel,
  onSelect,
  onOpen,
  onAnalyze,
  onWatch,
  onContextMenu,
}: GameRowProps) {
  const { t } = useTranslation()
  const locale = useFormatLocale()
  const status = useReplayStatsStatus(entry.path)
  const art = useMapArt(entry.mapName, entry.tileset)

  // The stats button opens stats the game already has, and otherwise queues an analysis so the
  // library stays put. A click on the row itself always opens the game.
  const onStatsClick = () => {
    if (status.kind === 'ready') {
      onOpen(entry)
    } else if (status.kind === 'none' || status.kind === 'failed') {
      onAnalyze(entry)
    }
  }

  const common = {
    tabIndex: 0,
    onClick: (event: React.MouseEvent) => {
      // A player's name opens their card instead, and clicks inside that card reach the row
      // through React's tree even though the card isn't inside the row.
      if (event.defaultPrevented || !isFromRow(event)) {
        return
      }
      onSelect(entry.id, event)
      if (!entry.parseError && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        onOpen(entry)
      }
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && event.target === event.currentTarget && !entry.parseError) {
        // Handled here rather than by the library's Enter key, which acts on the focused entry.
        event.stopPropagation()
        onOpen(entry)
      }
    },
    onMouseDown: (event: React.MouseEvent) => {
      // Shift-click extends the selection; without this it would also select the rows' text.
      if (event.shiftKey) {
        event.preventDefault()
      }
    },
    onContextMenu: (event: React.MouseEvent) => {
      if (isFromRow(event)) {
        onContextMenu(entry, event)
      }
    },
  }

  if (entry.parseError) {
    return (
      <Root $edge={edge}>
        <RowGrid
          $selected={selected}
          $focused={focused}
          $last={edge === 'last'}
          $openable={false}
          {...common}>
          <Mode />
          <ErrorLine>
            <MaterialIcon icon='error' size={18} />
            {entry.fileName}
          </ErrorLine>
          <MapAndTime>
            <Time>{t('replays.library.unreadable', "Couldn't read this replay")}</Time>
          </MapAndTime>
          <Length />
          <Actions />
        </RowGrid>
      </Root>
    )
  }

  const layout = getReplayDisplayTeams(entry.players)
  const mode = getGameMode(layout)
  const modeLabel = getGameModeLabel(layout, t)
  const summary =
    status.kind === 'ready'
      ? {
          ...status.summary,
          players: [
            ...withAssumedResults(status.summary.players, status.summary.complete, myNames),
          ],
        }
      : undefined
  const lines = getGameRowLines(layout, summary, hideResults)
  const time = new Intl.DateTimeFormat(
    locale,
    showDate
      ? {
          month: 'short',
          day: 'numeric',
          year:
            new Date(entry.gameTime).getFullYear() === new Date().getFullYear()
              ? undefined
              : 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }
      : { hour: 'numeric', minute: '2-digit' },
  ).format(entry.gameTime)

  let runningLabel = t('replays.status.analyzing', 'Analyzing')
  if (status.kind === 'queued') {
    runningLabel = t('replays.status.queued', 'Queued')
  }

  return (
    <Root $edge={edge}>
      <RowGrid
        $selected={selected}
        $focused={focused}
        $last={edge === 'last'}
        $openable={true}
        {...common}>
        <Mode>
          {mode === 'none' ? null : <MaterialIcon icon={getModeIcon(mode)} size={16} />}
          <ModeLabel>{modeLabel}</ModeLabel>
        </Mode>
        <Lines>
          {lines.map((line, i) => (
            <TeamLine
              key={i}
              players={line.players.map(p => ({
                name: p.isComputer ? computerLabel : p.name,
                race: p.race,
                isYou: !p.isComputer && isMyPlayerName(p.name, myNames),
                isComputer: p.isComputer,
              }))}
              result={line.result}
              slotWidth={slotWidth}
              wonLabel={t('replays.library.won', 'Won')}
              renderName={p =>
                p.isComputer ? (
                  p.name
                ) : (
                  <PlayerNameButton name={p.name} race={p.race}>
                    {p.name}
                  </PlayerNameButton>
                )
              }
            />
          ))}
        </Lines>
        <MapAndTime $art={art} style={art?.isMap ? undefined : getArtPosition(entry.id)}>
          <MapName title={filterColorCodes(entry.mapName)}>
            {filterColorCodes(entry.mapName)}
          </MapName>
          <Time>{time}</Time>
        </MapAndTime>
        {/* A game's length gives its result away as much as the result does. */}
        <Length>
          {hideResults ? null : getGameDurationString(entry.durationFrames * FASTEST_MS_PER_FRAME)}
        </Length>
        <Actions
          // The buttons act on their own; a click on them shouldn't also open the row.
          onClick={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}>
          <PlayButton
            label={t('replays.library.watchReplay', 'Watch replay')}
            onClick={() => onWatch(entry)}
          />
          <StatusPill
            status={toPillStatus(status)}
            readyLabel={t('replays.status.viewStats', 'View stats')}
            runningLabel={runningLabel}
            noneLabel={
              status.kind === 'failed'
                ? t('replays.status.tryAgain', 'Try again')
                : t('replays.status.analyze', 'Analyze')
            }
            onClick={onStatsClick}
          />
        </Actions>
      </RowGrid>
    </Root>
  )
}

/**
 * Sticks to the top of the list while its rows scroll under it. The window's background fills in
 * behind its rounded corners, and a line marks its bottom edge, so rows never show around it.
 */
const HeaderRoot = styled.div`
  position: relative;
  padding: var(--space-3) var(--space-5);

  display: flex;
  align-items: baseline;
  gap: 10px;

  border: 1px solid var(--theme-outline-variant);
  border-bottom: none;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background-color: var(--theme-container);
  box-shadow:
    inset 0 1px 0 var(--theme-panel-highlight),
    0 1px 0 var(--theme-outline-variant);

  &::before {
    content: '';
    position: absolute;
    inset: -1px -1px 0;
    z-index: -1;
    background-color: var(--theme-container-lowest);
  }
`

const HeaderTitle = styled.span`
  ${titleSmall};
  font-size: 15px;
  font-weight: 700;
  color: var(--theme-on-surface);
`

const HeaderSummary = styled.span`
  ${bodySmall};
  font-size: 13px;
  color: var(--theme-on-surface-variant);
`

/** The top of a group of games' panel: its name, like the day, and how many games it has. */
export function GroupHeader({ title, summary }: { title: string; summary: string }) {
  return (
    <HeaderRoot>
      <HeaderTitle>{title}</HeaderTitle>
      <HeaderSummary>{summary}</HeaderSummary>
    </HeaderRoot>
  )
}
