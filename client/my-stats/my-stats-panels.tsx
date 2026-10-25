import { TFunction } from 'i18next'
import { ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CartesianGrid,
  Tooltip as ChartTooltip,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  YAxis,
} from 'recharts'
import styled, { css } from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getGameDurationString } from '../../common/games/game-duration'
import { LadderRank } from '../../common/games/ladder'
import { GameShape } from '../../common/games/player-metrics'
import { TypedIpcRenderer } from '../../common/ipc'
import { getMapKey, TilesetId } from '../../common/maps'
import {
  Average,
  MapRow,
  MatchupRow,
  MIN_COLORED_GAMES,
  MyStatsGame,
  MyStatsResult,
  PersonRow,
  WinLoss,
} from '../../common/my-stats/my-stats'
import { AssignedRaceChar } from '../../common/races'
import { TICK_FONT_SIZE } from '../games/game-stats-charts'
import { RESULT_COLORS, StatsPanel, useStatFormat } from '../games/game-stats-shared'
import { MapArt, useMapArt } from '../games/map-art'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { RaceMix } from '../material/race-mix'
import { RaceTag } from '../material/race-tag'
import { Segmented, SegmentOption } from '../material/segmented'
import { Tooltip } from '../material/tooltip'
import { push } from '../navigation/routing'
import { PlayerNameButton } from '../players/player-card'
import { getGameStatsUrl } from '../replays/action-creators'
import {
  bahnschrift,
  bodyMedium,
  bodySmall,
  labelLarge,
  labelMedium,
  labelSmall,
  singleLine,
  titleSmall,
} from '../styles/typography'
import { getPoolSource, getScriptedNote } from './pool-source'

export const PanelTitle = styled.h2`
  ${titleSmall};
  margin: 0;
  font-weight: 700;
`

export const PanelNote = styled.p`
  ${bodySmall};
  max-width: 80ch;
  margin: 0;
  color: var(--theme-on-surface-variant);
`

export const PaddedPanel = styled(StatsPanel)`
  padding: var(--space-4) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
`

/**
 * The top of a panel: its title, a muted note or a control after it, and a line under them that
 * runs to the panel's edges. Centered rather than on a baseline, since a title can hold a race tag
 * with no text baseline.
 */
export const PanelHead = styled.div<{
  /** In a panel without padding, like one holding a table, rather than a padded one. */
  $flush?: boolean
  /** A control at the far end, like a picker, rather than a note right after the title. */
  $spread?: boolean
}>`
  margin: ${props => (props.$flush ? '0' : 'calc(-1 * var(--space-4)) calc(-1 * var(--space-5)) 0')};
  padding: var(--space-4) var(--space-5) var(--space-3);

  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);

  border-bottom: 1px solid var(--theme-outline-variant);

  /*
   * A control sits at the far end, and is taller than a title, so it reaches past the bar's
   * padding rather than making this header taller than the rest.
   */
  ${props =>
    props.$spread
      ? '& > :last-child:not(:first-child) { margin-left: auto; margin-block: -10px; }'
      : ''}
`

export const PanelHeadNote = styled.span`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const ipcRenderer = new TypedIpcRenderer()

/** A note under a table, at the foot of its panel. */
const TablePanelFooter = styled.div`
  padding: var(--space-3) var(--space-5) var(--space-4);
`

export const Muted = styled.span`
  color: var(--theme-on-surface-variant);
`

/** A win rate, or nothing when no game had a result. */
export function getWinRate(record: WinLoss): number | undefined {
  const decided = record.wins + record.losses
  return decided ? record.wins / decided : undefined
}

export function formatPercent(share: number | undefined, decimals = 0) {
  return share === undefined ? '-' : `${(share * 100).toFixed(decimals)}%`
}

const Wins = styled.span`
  color: ${RESULT_COLORS.win};
`

const Losses = styled.span`
  color: ${RESULT_COLORS.loss};
`

const RecordSeparator = styled.span`
  margin: 0 0.3em;
  color: var(--theme-on-surface-variant);
`

/** Wins and losses, each in its result's color, or "-" when no game had a result. */
export function RecordText({ record }: { record: Pick<WinLoss, 'wins' | 'losses'> }) {
  if (!record.wins && !record.losses) {
    return <Muted>-</Muted>
  }
  return (
    <span>
      <Wins>{record.wins}</Wins>
      <RecordSeparator>–</RecordSeparator>
      <Losses>{record.losses}</Losses>
    </span>
  )
}

export function getShapeLabel(shape: GameShape, t: TFunction) {
  switch (shape) {
    case 'ffa':
      return t('myStats.ffa', 'FFA')
    case 'other':
      return t('myStats.otherShape', 'Other')
    default:
      return shape
  }
}

/** 4v4 is left out: eight races don't fit on a chip. */
const TEAM_SIZES: Partial<Record<GameShape, number>> = { '1v1': 1, '2v2': 2, '3v3': 3 }

/**
 * Both teams' races, the user's team first, like ZvT or PPZvTZZ, or the game type in 4v4, when the
 * teams aren't even or when a race is missing.
 */
function getMatchupLabel(game: MyStatsGame, t: TFunction) {
  const team = game.race ? [game.race, ...game.teammateRaces].sort() : []
  const size = TEAM_SIZES[game.shape]
  if (size && team.length === size && game.opponentRaces.length === size) {
    return `${team.join('')}v${game.opponentRaces.join('')}`.toUpperCase()
  }
  return getShapeLabel(game.shape, t)
}

/** How many games a number comes from. */
function GameCount({ count }: { count: number }) {
  const { t } = useTranslation()
  return (
    <>
      {t('myStats.games', {
        defaultValue: '{{count}} games',
        defaultValue_one: '{{count}} game',
        count,
      })}
    </>
  )
}

const HelpTooltip = styled(Tooltip)`
  /* The tooltip's wrapper copies its parent's display, which would make it a table cell in a header. */
  display: inline-block;
`

const HelpTrigger = styled.span<{ $quiet?: boolean }>`
  text-decoration: underline dotted
    rgb(from currentColor r g b / ${props => (props.$quiet ? 0 : 0.5)});
  text-underline-offset: 3px;
  cursor: help;

  &:hover {
    text-decoration-color: rgb(from currentColor r g b / 0.5);
  }
`

const HelpText = styled.span`
  ${bodySmall};
  max-width: 260px;
  text-align: left;
`

/** A metric's name, which explains what the metric means when hovered or focused. */
export function HelpLabel({
  label,
  help,
  quiet = false,
}: {
  label: string
  help: string
  /** No underline until hovered, for a table full of them where it would only be noise. */
  quiet?: boolean
}) {
  return (
    <HelpTooltip position='top' text={<HelpText>{help}</HelpText>}>
      <HelpTrigger $quiet={quiet}>{label}</HelpTrigger>
    </HelpTooltip>
  )
}

// Totals

const TotalsGrid = styled.div<{ $compact?: boolean }>`
  display: grid;
  grid-template-columns: ${props =>
    props.$compact ? 'repeat(3, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(140px, 1fr))'};
  gap: var(--space-3);
`

const TotalTile = styled(StatsPanel)`
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const BigNumber = styled.span<{ $compact?: boolean }>`
  ${bahnschrift};
  font-size: ${props => (props.$compact ? 22 : 30)}px;
  font-weight: 700;
  line-height: ${props => (props.$compact ? 24 : 30)}px;
  font-variant-numeric: tabular-nums;
`

/** A total without a panel of its own, for inside another panel. */
const CompactTile = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const TileLabel = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const TileNote = styled.span`
  ${bodySmall};
  margin-top: -4px;
  color: var(--theme-on-surface-variant);
`

const RankLetter = styled.span`
  margin-left: var(--space-2);
  color: var(--theme-on-surface-variant);
`

function ESkillValue({ value, rank }: { value: string; rank?: LadderRank }) {
  return (
    <>
      {value}
      {rank ? <RankLetter>{rank.toUpperCase()}</RankLetter> : null}
    </>
  )
}

/**
 * The headline numbers. `compact` fits them in a narrow panel, like a player's card, without a
 * panel around each.
 */
export function Totals({
  stats,
  compact = false,
}: {
  stats: Pick<MyStatsResult, 'games' | 'record' | 'apm' | 'eapm' | 'durationMs' | 'eSkill'>
  compact?: boolean
}) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const noResult = stats.games - stats.record.wins - stats.record.losses
  const tiles: Array<[value: ReactNode, label: string, help: string, note?: string]> = [
    [
      format.format(stats.games),
      t('myStats.totals.games', 'Games'),
      t('myStats.help.games', 'Your analyzed games that match the filters.'),
    ],
    [
      <RecordText key='record' record={stats.record} />,
      t('myStats.totals.record', 'Wins and losses'),
      t(
        'myStats.help.record',
        "Games you won and lost. A game you left counts as a loss. Games without a result don't count either way.",
      ),
      noResult > 0
        ? t('myStats.totals.noResult', {
            defaultValue: '{{count}} more without a result',
            count: noResult,
          })
        : undefined,
    ],
    [
      formatPercent(getWinRate(stats.record)),
      t('myStats.totals.winRate', 'Win rate'),
      t('myStats.help.winRate', 'Wins out of the games that had a result.'),
    ],
    [
      stats.apm ? format.format(stats.apm.value) : '-',
      t('myStats.totals.apm', 'Average APM'),
      t(
        'myStats.help.apm',
        'Actions per minute: every select, order, build and hotkey you used, averaged over your games.',
      ),
    ],
    [
      stats.eapm ? format.format(stats.eapm.value) : '-',
      t('myStats.totals.eapm', 'Average EAPM'),
      t(
        'myStats.help.eapm',
        'Effective actions per minute. Like APM, but without spam, like the same order clicked again right away.',
      ),
    ],
    [
      stats.eSkill ? (
        <ESkillValue
          key='eSkill'
          value={format.format(stats.eSkill.value)}
          rank={stats.eSkill.rank}
        />
      ) : (
        '-'
      ),
      t('myStats.totals.eSkill', 'eSkill'),
      t(
        'myStats.help.eSkill',
        'The 1v1 ladder MMR and rank of players who play the way you do: your speed, hotkeys and macro, ranked against players of your race in the same kind of game. Nothing an opponent decides counts in it.',
      ),
      stats.eSkill
        ? t('myStats.totals.eSkillGames', {
            defaultValue: 'Over your last {{count}} games',
            count: stats.eSkill.games,
          })
        : undefined,
    ],
    [
      stats.durationMs ? getGameDurationString(stats.durationMs.value) : '-',
      t('myStats.totals.length', 'Average length'),
      t('myStats.help.length', 'How long your games lasted, on average.'),
    ],
  ]
  const Tile = compact ? CompactTile : TotalTile
  return (
    <TotalsGrid $compact={compact}>
      {tiles.map(([value, label, help, note]) => (
        <Tile key={label}>
          <BigNumber $compact={compact}>{value}</BigNumber>
          <TileLabel>
            <HelpLabel label={label} help={help} />
          </TileLabel>
          {note ? <TileNote>{note}</TileNote> : null}
        </Tile>
      ))}
    </TotalsGrid>
  )
}

// Recent games

const RecentStrip = styled.div<{ $columns: number }>`
  display: grid;
  grid-template-columns: repeat(${props => props.$columns}, minmax(0, 1fr));
  gap: 5px;
`

/** How many of the latest games a compact strip shows: one row of them, in a narrow panel. */
const COMPACT_CHIP_COLUMNS = 10

const RESULT_FILLS: Record<MyStatsGame['result'], string> = {
  win: 'var(--theme-positive-container)',
  loss: 'var(--theme-negative-container)',
  unknown: 'var(--theme-container)',
}

/** Filled by result, so a run of wins or losses shows at a glance. */
export const RecentChip = styled.button<{ $result: MyStatsGame['result']; $tall: boolean }>`
  ${buttonReset};
  ${labelLarge};
  height: ${props => (props.$tall ? 44 : 36)}px;
  min-width: 0;
  width: 100%;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  border: 1px solid
    ${props => (props.$result === 'unknown' ? 'var(--theme-outline-variant)' : 'transparent')};
  border-radius: var(--radius-sm);
  background: ${props => RESULT_FILLS[props.$result]};
  color: ${props =>
    props.$result === 'unknown' ? 'var(--theme-on-surface-variant)' : RESULT_COLORS[props.$result]};
  font-weight: 700;
  line-height: 16px;
  cursor: pointer;

  &:hover {
    border-color: var(--theme-outline-strong);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 1px;
  }
`

const RecentMatchup = styled.span`
  ${labelSmall};
  ${singleLine};
  max-width: 100%;
  color: var(--theme-on-surface-variant);
  font-weight: 600;
`

/** Lets a chip's tooltip wrapper fill its grid cell. */
export const RecentTooltip = styled(Tooltip)`
  min-width: 0;
`

export function getResultLetter(result: MyStatsGame['result'], t: TFunction) {
  switch (result) {
    case 'win':
      return t('myStats.recent.win', 'W')
    case 'loss':
      return t('myStats.recent.loss', 'L')
    default:
      return '-'
  }
}

export function getResultWord(result: MyStatsGame['result'], t: TFunction) {
  switch (result) {
    case 'win':
      return t('myStats.recent.winWord', 'Win')
    case 'loss':
      return t('myStats.recent.lossWord', 'Loss')
    default:
      return t('myStats.recent.noResult', 'No result: the replay ends before anyone won or lost')
  }
}

/**
 * What a chip in the recent games strip says under its result. Only 1v1 races fit a chip, so team
 * games say their game type and leave the races to the tooltip.
 */
function getChipMatchupLabel(game: MyStatsGame, t: TFunction) {
  return game.shape === '1v1' ? getMatchupLabel(game, t) : getShapeLabel(game.shape, t)
}

/**
 * The latest games as chips colored by result, oldest first. `compact` shows only the latest row of
 * them, without the panel and its title, for inside another panel.
 */
export function RecentGames({
  games,
  compact = false,
}: {
  games: ReadonlyArray<MyStatsGame>
  compact?: boolean
}) {
  const { t } = useTranslation()
  // The same matchup on every chip is noise; it's shown once in the title instead.
  const matchups = new Set(games.map(game => getChipMatchupLabel(game, t)))
  const matchupsVary = matchups.size > 1
  const shown = compact ? games.slice(-COMPACT_CHIP_COLUMNS) : games
  const strip = (
    <RecentStrip $columns={compact ? COMPACT_CHIP_COLUMNS : 20}>
      {shown.toReversed().map(game => (
        <RecentTooltip
          key={game.gameId}
          tabIndex={-1}
          position='top'
          text={[
            getResultWord(game.result, t),
            getMatchupLabel(game, t),
            game.mapName,
            getGameDurationString(game.durationMs),
            new Date(game.gameTimeMs).toLocaleString(),
          ].join(', ')}>
          <RecentChip
            type='button'
            $result={game.result}
            $tall={matchupsVary}
            aria-label={`${getResultLetter(game.result, t)} ${getMatchupLabel(game, t)}`}
            onClick={() => push(getGameStatsUrl(game.gameId))}>
            <span>{getResultLetter(game.result, t)}</span>
            {matchupsVary ? <RecentMatchup>{getChipMatchupLabel(game, t)}</RecentMatchup> : null}
          </RecentChip>
        </RecentTooltip>
      ))}
    </RecentStrip>
  )
  if (compact) {
    return strip
  }
  return (
    <PaddedPanel>
      <PanelHead>
        <PanelTitle>
          {t('myStats.recent.title', {
            defaultValue: 'Last {{count}} games',
            defaultValue_one: 'Your only game',
            count: games.length,
          })}
        </PanelTitle>
        <PanelHeadNote>
          {games.length === 1 ? [...matchups][0] : null}
          {games.length > 1 && matchupsVary ? t('myStats.recent.note', 'Newest first') : null}
          {games.length > 1 && !matchupsVary
            ? t('myStats.recent.noteOne', '{{matchup}}, newest first', {
                matchup: [...matchups][0] ?? '',
              })
            : null}
        </PanelHeadNote>
      </PanelHead>
      {strip}
    </PaddedPanel>
  )
}

// Tables

const Table = styled.table`
  ${bodyMedium};
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;

  th {
    ${labelMedium};
    padding: var(--space-2);
    color: var(--theme-on-surface-variant);
    font-weight: 600;
    text-align: right;
  }

  td {
    padding: 10px 8px;
    border-top: 1px solid var(--theme-outline-variant);
    text-align: right;
  }

  th:first-child,
  td:first-child {
    padding-left: var(--space-5);
    text-align: left;
  }

  th:last-child,
  td:last-child {
    padding-right: var(--space-5);
  }
`

const MatchupCell = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
`

const ExpandButton = styled.button`
  ${buttonReset};
  ${bodyMedium};
  margin: -4px -8px;
  padding: var(--space-1) var(--space-2);

  display: inline-flex;
  align-items: center;
  gap: var(--space-1);

  border-radius: var(--radius-sm);
  color: inherit;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-primary);
  }
`

const ExpandChevron = styled(MaterialIcon)<{ $open: boolean }>`
  color: var(--theme-on-surface-variant);
  transform: rotate(${props => (props.$open ? '180deg' : '0deg')});
  transition: transform 150ms ease;
`

const MatchupCount = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  font-weight: 400;
`

const BreakdownRow = styled.tr`
  background: rgb(from var(--theme-on-surface) r g b / 0.03);

  td:first-child {
    padding-left: 44px;
  }
`

const WinBar = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
`

const WinBarTrack = styled.span`
  width: 72px;
  height: 6px;
  display: flex;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--theme-container-highest);
`

/** Green from an even record up, red below, so a matchup that's going badly stands out. */
const WinBarFill = styled.span<{ $good: boolean }>`
  border-radius: var(--radius-full);
  background: ${props => (props.$good ? 'var(--theme-positive)' : 'var(--theme-negative)')};
`

function WinRate({ record }: { record: WinLoss }) {
  const rate = getWinRate(record)
  return (
    <WinBar>
      <WinBarTrack aria-hidden={true}>
        <WinBarFill $good={(rate ?? 0) >= 0.5} style={{ width: `${(rate ?? 0) * 100}%` }} />
      </WinBarTrack>
      {formatPercent(rate)}
    </WinBar>
  )
}

function Matchup({ row }: { row: MatchupRow }) {
  const { t } = useTranslation()
  if (row.shape === '1v1' && row.race && row.opponentRace) {
    return (
      <MatchupCell>
        <RaceTag race={row.race} />
        <Muted>{t('myStats.versus', 'vs')}</Muted>
        <RaceTag race={row.opponentRace} />
      </MatchupCell>
    )
  }
  if (row.opponentRaces?.length) {
    return (
      <MatchupCell>
        {row.teamRaces?.length
          ? row.teamRaces.map((race, i) => <RaceTag key={i} race={race} />)
          : getShapeLabel(row.shape, t)}
        <Muted>{t('myStats.versus', 'vs')}</Muted>
        {row.opponentRaces.map((race, i) => (
          <RaceTag key={i} race={race} />
        ))}
      </MatchupCell>
    )
  }
  return <MatchupCell>{getShapeLabel(row.shape, t)}</MatchupCell>
}

function sumGames(rows: ReadonlyArray<MatchupRow>) {
  return rows.reduce((total, row) => total + row.games, 0)
}

function getMatchupKey(row: MatchupRow) {
  return `${row.shape}${row.race ?? ''}${row.opponentRace ?? ''}${row.teamRaces?.join('') ?? ''}${row.opponentRaces?.join('') ?? ''}`
}

function MatchupCells({ row }: { row: MatchupRow }) {
  const format = useStatFormat()
  return (
    <>
      <td>{format.format(row.games)}</td>
      <td>
        <RecordText record={row} />
      </td>
      <td>
        <WinRate record={row} />
      </td>
      {/* Zero means the games didn't record it, like one that ended before it started. */}
      <td>{row.apm ? format.format(row.apm) : '-'}</td>
      <td>{row.durationMs ? getGameDurationString(row.durationMs) : '-'}</td>
    </>
  )
}

function ShapeRows({ row, startOpen }: { row: MatchupRow; startOpen: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(startOpen)
  const matchups = row.matchups ?? []
  if (!matchups.length) {
    return (
      <tr>
        <td>
          <Matchup row={row} />
        </td>
        <MatchupCells row={row} />
      </tr>
    )
  }
  return (
    <>
      <tr>
        <td>
          <ExpandButton type='button' aria-expanded={open} onClick={() => setOpen(!open)}>
            {getShapeLabel(row.shape, t)}
            <MatchupCount>
              {t('myStats.byMatchup.matchupCount', {
                defaultValue: '{{count}} matchups',
                defaultValue_one: '{{count}} matchup',
                count: matchups.length,
              })}
            </MatchupCount>
            <ExpandChevron icon='expand_more' size={18} $open={open} />
          </ExpandButton>
        </td>
        <MatchupCells row={row} />
      </tr>
      {open
        ? matchups.map(matchup => (
            <BreakdownRow key={getMatchupKey(matchup)}>
              <td>
                <Matchup row={matchup} />
              </td>
              <MatchupCells row={matchup} />
            </BreakdownRow>
          ))
        : null}
    </>
  )
}

export function ByMatchup({
  rows,
  apmGames,
}: {
  rows: ReadonlyArray<MatchupRow>
  apmGames: number
}) {
  const { t } = useTranslation()
  return (
    <StatsPanel>
      <PanelHead $flush={true}>
        <PanelTitle>{t('myStats.byMatchup.title', 'By matchup')}</PanelTitle>
      </PanelHead>
      <Table>
        <thead>
          <tr>
            <th>{t('myStats.byMatchup.matchup', 'Matchup')}</th>
            <th>{t('myStats.byMatchup.games', 'Games')}</th>
            <th>{t('myStats.byMatchup.record', 'Record')}</th>
            <th>
              <HelpLabel
                label={t('myStats.byMatchup.winRate', 'Win rate')}
                help={t('myStats.help.winRate', 'Wins out of the games that had a result.')}
              />
            </th>
            <th>
              <HelpLabel
                label={t('myStats.byMatchup.apm', 'APM')}
                help={t(
                  'myStats.help.matchupApm',
                  'Your average actions per minute in these games.',
                )}
              />
            </th>
            <th>
              <HelpLabel
                label={t('myStats.byMatchup.length', 'Length')}
                help={t('myStats.help.matchupLength', 'How long these games lasted, on average.')}
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {/* With only one kind of game there's nothing to scan past, so its matchups show. */}
          {rows.map(row => (
            <ShapeRows key={getMatchupKey(row)} row={row} startOpen={rows.length === 1} />
          ))}
        </tbody>
      </Table>
      {/* Only worth saying when some games didn't track APM, like ones against computers. */}
      {apmGames < sumGames(rows) ? (
        <TablePanelFooter>
          <PanelNote>
            {t('myStats.byMatchup.note', {
              defaultValue: 'APM is from the {{count}} games that tracked it.',
              defaultValue_one: 'APM is from the one game that tracked it.',
              count: apmGames,
            })}
          </PanelNote>
        </TablePanelFooter>
      ) : null}
    </StatsPanel>
  )
}

export function ByLength({ rows }: { rows: MyStatsResult['byLength'] }) {
  const { t } = useTranslation()
  const labelOf = (index: number) => {
    const max = rows[index].maxMinutes
    const min = rows[index - 1]?.maxMinutes
    if (min === undefined) {
      return t('myStats.byLength.under', 'Under {{max}} min', { max })
    }
    if (max === undefined) {
      return t('myStats.byLength.over', 'Over {{min}} min', { min })
    }
    return t('myStats.byLength.between', '{{min}} to {{max}} min', { min, max })
  }
  return (
    <StatsPanel>
      <PanelHead $flush={true}>
        <PanelTitle>{t('myStats.byLength.title', 'Win rate by game length')}</PanelTitle>
      </PanelHead>
      <Table>
        <tbody>
          {rows.map((row, i) =>
            // A length nobody's games had is just noise.
            row.games ? (
              <tr key={row.maxMinutes ?? 'longest'}>
                <td>{labelOf(i)}</td>
                <td>
                  <Muted>
                    <GameCount count={row.games} />
                  </Muted>
                </td>
                <td>
                  <RecordText record={row} />
                </td>
                <td>
                  <WinRate record={row} />
                </td>
              </tr>
            ) : null,
          )}
        </tbody>
      </Table>
    </StatsPanel>
  )
}

// Trends

/** Fills whatever height its column leaves, with a floor so a short column still gets a chart. */
const TrendsPanel = styled(PaddedPanel)`
  flex: 1 1 auto;
`

/** Wraps onto a second line rather than run past a narrow panel. */
const MetricPicker = styled(Segmented)`
  flex-shrink: 1;
  flex-wrap: wrap;
  max-width: 100%;
` as typeof Segmented

const ChartArea = styled.div`
  flex: 1 1 auto;
  width: 100%;
  min-height: 160px;
`

const ChartEmpty = styled(PanelNote)`
  ${bodyMedium};
  height: 100%;
  min-height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
`

const ChartFooter = styled.div`
  ${bodySmall};
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  color: var(--theme-on-surface-variant);
`

const LegendLine = styled.span<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;

  &::before {
    content: '';
    width: 14px;
    height: 2px;
    border-radius: var(--radius-full);
    background: ${props => props.$color};
  }
`

/** Marks the dotted line for the average, the way the legend marks the chart's lines. */
const AverageLegend = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;

  &::before {
    content: '';
    width: 14px;
    border-top: 2px dotted var(--theme-on-surface-variant);
  }
`

const TrendTip = styled.div`
  ${bodySmall};
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;

  background: var(--theme-container-high);
  border: 1px solid var(--theme-outline-strong);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.3);
`

const TrendTipTitle = styled.span`
  ${labelMedium};
  display: flex;
  gap: var(--space-2);
`

const TrendTipValue = styled.span<{ $color: string }>`
  color: ${props => props.$color};
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`

const MAIN_COLOR = 'var(--theme-data-1)'
const SECOND_COLOR = 'var(--theme-data-2)'
/** With more games than this, points would crowd the line, so only the hovered one is drawn. */
const MAX_DOTS = 50

type TrendMetric = 'apm' | 'eSkill' | 'workers6' | 'income6' | 'bankMid' | 'supplyBlocked'
type TrendCount = 20 | 50 | 100

interface TrendMetricInfo {
  label: string
  help: string
  /** The line, and for APM the EAPM line under it. */
  values: (game: MyStatsGame) => [main: number | undefined, second?: number | undefined]
  secondLabel?: string
  format: (value: number) => string
  /** A shorter form for the axis, without units. */
  axisFormat?: (value: number) => string
  /** Whether a lower number is the better one, which decides what counts as the best game. */
  lowerIsBetter?: boolean
}

interface TrendRow {
  game: MyStatsGame
  main?: number
  second?: number
}

/** A point colored by the game's result, so wins and losses show along the line. */
function ResultDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: TrendRow }) {
  if (cx === undefined || cy === undefined || !payload) {
    return null
  }
  const result = payload.game.result
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3.5}
      fill={result === 'unknown' ? 'var(--theme-on-surface-variant)' : RESULT_COLORS[result]}
      stroke='var(--theme-container-low)'
      strokeWidth={1.5}
    />
  )
}

function TrendTooltip({
  active,
  payload,
  info,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: TrendRow }>
  info: TrendMetricInfo
}) {
  const { t } = useTranslation()
  const row = payload?.[0]?.payload
  if (!active || !row) {
    return null
  }
  const { game } = row
  return (
    <TrendTip>
      <TrendTipTitle>
        {game.result !== 'unknown' ? (
          <span style={{ color: RESULT_COLORS[game.result] }}>
            {getResultLetter(game.result, t)}
          </span>
        ) : null}
        <span>{getMatchupLabel(game, t)}</span>
        <Muted>{getGameDurationString(game.durationMs)}</Muted>
      </TrendTipTitle>
      <Muted>
        {game.mapName}, {new Date(game.gameTimeMs).toLocaleDateString()}
      </Muted>
      {row.main !== undefined ? (
        <span>
          {info.label} <TrendTipValue $color={MAIN_COLOR}>{info.format(row.main)}</TrendTipValue>
        </span>
      ) : null}
      {info.secondLabel && row.second !== undefined ? (
        <span>
          {info.secondLabel}{' '}
          <TrendTipValue $color={SECOND_COLOR}>{info.format(row.second)}</TrendTipValue>
        </span>
      ) : null}
      <Muted>{t('myStats.trends.openGame', 'Click to open this game')}</Muted>
    </TrendTip>
  )
}

/** Picks a number the user can follow from game to game and draws it over their latest games. */
const TREND_COUNTS: ReadonlyArray<TrendCount> = [20, 50, 100]

export function Trends({ games }: { games: ReadonlyArray<MyStatsGame> }) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const [metric, setMetric] = useState<TrendMetric>('apm')
  const [count, setCount] = useState<TrendCount>(20)

  const metrics: Record<TrendMetric, TrendMetricInfo> = {
    apm: {
      label: t('myStats.trends.apm', 'APM'),
      help: t(
        'myStats.help.apm',
        'Actions per minute: every select, order, build and hotkey you used, averaged over your games.',
      ),
      values: game => [game.apm, game.eapm],
      secondLabel: t('myStats.trends.eapm', 'EAPM'),
      format: value => format.format(value),
    },
    eSkill: {
      label: t('myStats.trends.eSkill', 'eSkill'),
      help: t(
        'myStats.help.trendESkill',
        'The 1v1 ladder MMR of players who play the way you did, from your speed, hotkeys and macro. Games under 6 minutes have none.',
      ),
      values: game => [game.eSkill],
      format: value => format.format(value),
    },
    workers6: {
      label: t('myStats.trends.workers', 'Workers'),
      help: t('myStats.help.trendWorkers', 'Finished workers you had at 6 minutes.'),
      values: game => [game.workers6],
      format: value => format.format(value),
    },
    income6: {
      label: t('myStats.trends.mining', 'Mining'),
      help: t(
        'myStats.help.trendMining',
        'Minerals and gas you mined in the minute before 6 minutes.',
      ),
      values: game => [game.income6],
      format: value =>
        t('myStats.macro.perMinute', '{{amount}} a min', { amount: format.format(value) }),
      axisFormat: value => format.format(value),
    },
    bankMid: {
      label: t('myStats.trends.unspent', 'Unspent'),
      help: t(
        'myStats.help.bankMid',
        'Minerals and gas you had banked between 6 and 12 minutes, on average. Lower means you spent faster.',
      ),
      values: game => [game.bankMid],
      format: value => format.format(value),
      lowerIsBetter: true,
    },
    supplyBlocked: {
      label: t('myStats.trends.supplyBlocked', 'Supply blocked'),
      help: t(
        'myStats.help.supplyBlocked',
        "The share of the game you couldn't make units because you were out of supply. The first 3 minutes are left out, since early blocks are often part of a build.",
      ),
      values: game => [game.supplyBlockedShare],
      format: value => formatPercent(value, 1),
      axisFormat: value => formatPercent(value),
      lowerIsBetter: true,
    },
  }
  const info = metrics[metric]

  const recent = games.slice(-count)
  const rows: TrendRow[] = recent
    .map(game => {
      const [main, second] = info.values(game)
      return { game, main, second }
    })
    .filter(row => row.main !== undefined)
  const values = rows.map(row => row.main ?? 0)
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined
  let best: number | undefined
  if (values.length) {
    best = info.lowerIsBetter ? Math.min(...values) : Math.max(...values)
  }
  // Nothing at all is the best a lower is better number can be, so it doesn't say much.
  const showBest = rows.length >= 2 && best !== undefined && !(info.lowerIsBetter && best === 0)

  const metricOptions: Array<SegmentOption<TrendMetric>> = (
    Object.keys(metrics) as TrendMetric[]
  ).map(key => ({ value: key, label: metrics[key].label, title: metrics[key].help }))
  // A count past the first one that already takes in every game would show the same.
  const counts = TREND_COUNTS.filter((n, i) => i === 0 || TREND_COUNTS[i - 1] < games.length)
  const countOptions: Array<SegmentOption<TrendCount>> = counts.map(n => ({
    value: n,
    label: String(n),
    title: t('myStats.trends.lastGames', 'Last {{count}} games', { count: n }),
  }))

  return (
    <TrendsPanel>
      <PanelHead $spread={true}>
        <PanelTitle>{t('myStats.trends.title', 'Trends')}</PanelTitle>
        <Segmented
          label={t('myStats.trends.count', 'How many games')}
          options={countOptions}
          value={count}
          onChange={setCount}
        />
      </PanelHead>
      <div>
        <MetricPicker
          label={t('myStats.trends.metric', 'What to show')}
          options={metricOptions}
          value={metric}
          onChange={setMetric}
        />
      </div>
      <ChartArea>
        {rows.length >= 2 ? (
          <ResponsiveContainer width='100%' height='100%'>
            <LineChart
              data={rows}
              margin={{ top: 6, right: 6, bottom: 6, left: 0 }}
              style={{ cursor: 'pointer' }}
              onClick={state => {
                const index = Number(state.activeTooltipIndex)
                const row = Number.isInteger(index) ? rows[index] : undefined
                if (row) {
                  push(getGameStatsUrl(row.game.gameId))
                }
              }}>
              <CartesianGrid stroke='var(--theme-outline-variant)' vertical={false} />
              <YAxis
                width={44}
                domain={['auto', 'auto']}
                tickCount={4}
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--theme-on-surface-variant)', fontSize: TICK_FONT_SIZE }}
                tickFormatter={value => (info.axisFormat ?? info.format)(Number(value))}
              />
              {average !== undefined ? (
                <ReferenceLine
                  y={average}
                  stroke='var(--theme-on-surface-variant)'
                  strokeDasharray='4 4'
                  ifOverflow='extendDomain'
                />
              ) : null}
              <ChartTooltip
                cursor={{ stroke: 'var(--theme-outline-strong)' }}
                content={props => <TrendTooltip {...props} info={info} />}
              />
              <Line
                dataKey='main'
                name={info.label}
                stroke={MAIN_COLOR}
                strokeWidth={2.5}
                dot={rows.length <= MAX_DOTS ? <ResultDot /> : false}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
              {info.secondLabel ? (
                <Line
                  dataKey='second'
                  name={info.secondLabel}
                  stroke={SECOND_COLOR}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              ) : null}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <ChartEmpty>
            {rows.length
              ? t('myStats.trends.needTwo', 'A trend needs at least 2 games with this.')
              : t('myStats.trends.none', 'None of these games have this yet.')}
          </ChartEmpty>
        )}
      </ChartArea>
      <ChartFooter>
        <LegendLine $color={MAIN_COLOR}>{info.label}</LegendLine>
        {info.secondLabel ? (
          <LegendLine $color={SECOND_COLOR}>{info.secondLabel}</LegendLine>
        ) : null}
        {average !== undefined && rows.length >= 2 ? (
          <AverageLegend>
            {t('myStats.trends.average', 'Average {{value}}', { value: info.format(average) })}
          </AverageLegend>
        ) : null}
        {showBest && best !== undefined ? (
          <span>{t('myStats.trends.best', 'Best {{value}}', { value: info.format(best) })}</span>
        ) : null}
        <span>
          {rows.length < recent.length
            ? t('myStats.trends.someGames', '{{count}} of {{total}} games had this', {
                count: rows.length,
                total: recent.length,
              })
            : t('myStats.games', {
                defaultValue: '{{count}} games',
                defaultValue_one: '{{count}} game',
                count: rows.length,
              })}
        </span>
      </ChartFooter>
    </TrendsPanel>
  )
}

// Macro

const MacroValue = styled.span`
  ${bahnschrift};
  font-size: 22px;
  font-weight: 700;
  line-height: 24px;
  font-variant-numeric: tabular-nums;
`

const MacroGroups = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid var(--theme-outline-variant);
`

const MacroGroup = styled.section`
  padding: 14px 20px 10px;
  border-bottom: 1px solid var(--theme-outline-variant);

  &:nth-child(odd) {
    border-right: 1px solid var(--theme-outline-variant);
  }

  /* A group left on its own takes the whole row. */
  &:last-child:nth-child(odd) {
    grid-column: 1 / -1;
    border-right: none;
  }
`

const MacroColumns = styled.div<{ $others: boolean }>`
  display: grid;
  grid-template-columns: ${props =>
    props.$others ? 'minmax(0, 1fr) 84px 84px' : 'minmax(0, 1fr) 84px'};
  align-items: baseline;
  gap: var(--space-3);
`

const MacroGroupHeader = styled(MacroColumns)`
  margin-bottom: 6px;

  & > * {
    ${labelMedium};
    margin: 0;
    color: var(--theme-on-surface-variant);
    font-weight: 700;
  }

  & > :not(:first-child) {
    text-align: right;
  }
`

const MacroRowRoot = styled(MacroColumns)`
  ${bodyMedium};
  padding: 5px 0;
`

type Comparison = 'better' | 'worse' | 'same'

const COMPARISON_COLORS: Record<Comparison, string> = {
  better: 'var(--theme-positive)',
  worse: 'var(--theme-negative)',
  same: 'var(--theme-on-surface)',
}

const MacroRowValue = styled.span<{ $comparison: Comparison }>`
  ${labelLarge};
  color: ${props => COMPARISON_COLORS[props.$comparison]};
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: right;
`

const MacroOtherValue = styled.span`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
  text-align: right;
`

const MacroNote = styled(PanelNote)`
  padding: var(--space-3) var(--space-5) var(--space-4);
`

interface MacroRow {
  label: string
  help: string
  value: string
  otherValue: string
  comparison: Comparison
  /** Shown on hover over the values: how many games each comes from. */
  sources: string
}

/**
 * Whether a number is clearly better or worse than another, past a difference worth noticing and
 * from enough games on each side to tell.
 */
function compareValues(
  mine: Average | undefined,
  theirs: Average | undefined,
  higherIsBetter: boolean,
  minDiff: number,
): Comparison {
  if (
    !mine ||
    !theirs ||
    mine.games < MIN_COLORED_GAMES ||
    theirs.games < MIN_COLORED_GAMES ||
    Math.abs(mine.value - theirs.value) < minDiff
  ) {
    return 'same'
  }
  return mine.value > theirs.value === higherIsBetter ? 'better' : 'worse'
}

export function MacroAveragesPanel({
  macro,
  others,
  othersGames,
  noOthersNote,
  othersFromBaseline,
  othersScripted,
  eapmFloor,
  rank,
  extraNote,
}: {
  macro: MyStatsResult['macro']
  others: MyStatsResult['macroOthers']
  othersGames: number
  /** Says why there's nobody to compare with, in place of saying none of them were found. */
  noOthersNote?: string
  othersFromBaseline: number
  /** Other players' games a bot or macro program played, left out of {@link othersGames}. */
  othersScripted: number
  eapmFloor: number
  rank?: LadderRank
  /** A last sentence for the note under the numbers. */
  extraNote?: string
}) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const row = (
    label: string,
    help: string,
    key: keyof MyStatsResult['macro'],
    show: (value: number) => string,
    higherIsBetter: boolean,
    minDiff: number,
  ): MacroRow => ({
    label,
    help,
    value: macro[key] ? show(macro[key].value) : '-',
    otherValue: others[key] ? show(others[key].value) : '-',
    comparison: compareValues(macro[key], others[key], higherIsBetter, minDiff),
    sources: t('myStats.macro.sources', 'From {{mine}} of your games and {{theirs}} of theirs', {
      mine: macro[key]?.games ?? 0,
      theirs: others[key]?.games ?? 0,
    }),
  })
  const whole = (value: number) => format.format(value)
  const perMinute = (value: number) =>
    t('myStats.macro.perMinute', '{{amount}} a min', { amount: format.format(value) })
  const workersHelp = t(
    'myStats.help.workers',
    'Finished workers you had at that point, from games that lasted that long.',
  )
  const miningHelp = t(
    'myStats.help.mining',
    'Minerals and gas you mined in the minute before that point, from games that lasted that long.',
  )
  const supplyHelp = t(
    'myStats.help.supplyMilestone',
    'When you first had that much supply in use. Only games where you got there count.',
  )
  const groups: Array<[title: string, rows: MacroRow[]]> = [
    [
      t('myStats.macro.workers', 'Workers'),
      [
        row(t('myStats.macro.at6', 'At 6 min'), workersHelp, 'workers6', whole, true, 2),
        row(t('myStats.macro.at10', 'At 10 min'), workersHelp, 'workers10', whole, true, 2),
      ],
    ],
    [
      t('myStats.macro.mining', 'Mining'),
      [
        row(t('myStats.macro.at6', 'At 6 min'), miningHelp, 'income6', perMinute, true, 60),
        row(t('myStats.macro.at10', 'At 10 min'), miningHelp, 'income10', perMinute, true, 60),
      ],
    ],
    [
      t('myStats.macro.growth', 'Growth'),
      [
        row(
          t('myStats.macro.supply100', 'Reached 100 supply'),
          supplyHelp,
          'supply100Ms',
          getGameDurationString,
          false,
          20_000,
        ),
        row(
          t('myStats.macro.supply150', 'Reached 150 supply'),
          supplyHelp,
          'supply150Ms',
          getGameDurationString,
          false,
          20_000,
        ),
      ],
    ],
    [
      t('myStats.macro.spending', 'Spending'),
      [
        row(
          t('myStats.macro.bankMid', 'Unspent, 6 to 12 min'),
          t(
            'myStats.help.bankMid',
            'Minerals and gas you had banked between 6 and 12 minutes, on average. Lower means you spent faster.',
          ),
          'bankMid',
          whole,
          false,
          100,
        ),
        row(
          t('myStats.macro.supplyBlocked', 'Time supply blocked'),
          t(
            'myStats.help.supplyBlocked',
            "The share of the game you couldn't make units because you were out of supply. The first 3 minutes are left out, since early blocks are often part of a build.",
          ),
          'supplyBlockedShare',
          value => formatPercent(value, 1),
          false,
          0.02,
        ),
      ],
    ],
    [
      t('myStats.macro.fights', 'Fights'),
      [
        row(
          t('myStats.macro.armyKilled', 'Army killed'),
          t(
            'myStats.help.armyKilled',
            "What the enemy army units you killed were worth, by StarCraft's score for each unit. Workers, buildings, Overlords, Interceptors, Scarabs and Spider Mines don't count.",
          ),
          'armyKilled',
          whole,
          true,
          300,
        ),
        row(
          t('myStats.macro.armyLost', 'Army lost'),
          t(
            'myStats.help.armyLost',
            "What the army units you lost were worth, by StarCraft's score for each unit. Workers, buildings, Overlords, Interceptors, Scarabs and Spider Mines don't count.",
          ),
          'armyLost',
          whole,
          false,
          300,
        ),
      ],
    ],
  ]
  const hasOthers = othersGames > 0
  // A number none of the user's games had says nothing, and a group of them even less.
  const shownGroups = groups
    .map(([title, rows]) => [title, rows.filter(r => r.value !== '-')] as const)
    .filter(([, rows]) => rows.length)

  return (
    <StatsPanel>
      <PanelHead $flush={true}>
        <PanelTitle>{t('myStats.macro.title', 'Macro, on average')}</PanelTitle>
      </PanelHead>
      <MacroGroups>
        {shownGroups.map(([title, rows]) => (
          <MacroGroup key={title}>
            <MacroGroupHeader $others={hasOthers}>
              <h3>{title}</h3>
              <span>{t('myStats.macro.you', 'You')}</span>
              {hasOthers ? (
                <span>
                  <HelpLabel
                    label={t('myStats.macro.others', 'Others')}
                    help={t(
                      'myStats.help.others',
                      'Other players in the same kind of games, with the same races as the filters, at least {{floor}} EAPM and at least 5 minutes played. Their games from any time count. Your games under 5 minutes are left out too.',
                      { floor: eapmFloor },
                    )}
                  />
                </span>
              ) : null}
            </MacroGroupHeader>
            {rows.map(r => (
              <MacroRowRoot key={r.label} $others={hasOthers}>
                <span>
                  <HelpLabel
                    label={r.label}
                    help={hasOthers ? `${r.help} ${r.sources}.` : r.help}
                  />
                </span>
                <MacroRowValue $comparison={r.comparison}>{r.value}</MacroRowValue>
                {hasOthers ? <MacroOtherValue>{r.otherValue}</MacroOtherValue> : null}
              </MacroRowRoot>
            ))}
          </MacroGroup>
        ))}
      </MacroGroups>
      <MacroNote>
        {hasOthers
          ? null
          : `${noOthersNote ?? t('myStats.macro.noOthers', 'No other players over {{floor}} EAPM in these games yet, so there is nothing to compare with.', { floor: eapmFloor })} `}
        {!hasOthers
          ? null
          : t('myStats.macro.othersNote', {
              defaultValue:
                "Others come from {{count}} games of other players {{source}}, at least {{floor}} EAPM. With 5 games or more on each side, your number is green when it's clearly better and red when it's clearly worse.",
              defaultValue_one:
                "Others come from {{count}} game of another player {{source}}, at least {{floor}} EAPM. With 5 games or more on each side, your number is green when it's clearly better and red when it's clearly worse.",
              count: othersGames,
              floor: eapmFloor,
              source: getPoolSource(othersFromBaseline, othersGames, t),
            })}
        {hasOthers ? ' ' : null}
        {othersScripted ? `${getScriptedNote(othersScripted, t)} ` : null}
        {rank
          ? `${t('myStats.rankOnly', 'Only players who were rank {{rank}} going into the game count.', { rank: rank.toUpperCase() })} `
          : null}
        {t('myStats.macro.note', 'Each number only counts games that lasted that long.')}
        {extraNote ? ` ${extraNote}` : null}
      </MacroNote>
    </StatsPanel>
  )
}

// People and maps

const RaceRow = styled.span<{ $slots?: number }>`
  /* Room for as many race tags as anyone in the list has, so the names after them line up. */
  min-width: ${props => (props.$slots ? `calc(${props.$slots} * 18px + ${props.$slots - 1} * 4px)` : '0')};
  flex-shrink: 0;
  display: inline-flex;
  gap: var(--space-1);
`

const ListRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 80px 56px;
  gap: 10px;
  align-items: center;
`

const ListName = styled.span`
  ${labelLarge};
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 600;
`

const ListNameText = styled.span`
  ${singleLine};
`

const RightAligned = styled.span`
  text-align: right;
  font-variant-numeric: tabular-nums;
`

/** Rows a list of people or maps shows at a time. */
const LIST_PAGE_SIZE = 8

const PagerRoot = styled.div`
  ${bodyMedium};
  display: flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

/** Which rows of a long list are showing, with buttons to the ones before and after. */
function Pager({
  page,
  total,
  onPage,
}: {
  page: number
  total: number
  onPage: (page: number) => void
}) {
  const { t } = useTranslation()
  const pages = Math.ceil(total / LIST_PAGE_SIZE)
  return (
    <PagerRoot>
      <span>
        {t('myStats.pageRange', '{{from}} to {{to}} of {{total}}', {
          from: page * LIST_PAGE_SIZE + 1,
          to: Math.min(total, (page + 1) * LIST_PAGE_SIZE),
          total,
        })}
      </span>
      <IconButton
        icon={<MaterialIcon icon='chevron_left' />}
        title={t('myStats.pagePrevious', 'Previous')}
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      />
      <IconButton
        icon={<MaterialIcon icon='chevron_right' />}
        title={t('myStats.pageNext', 'Next')}
        disabled={page >= pages - 1}
        onClick={() => onPage(page + 1)}
      />
    </PagerRoot>
  )
}

/**
 * A list's rows a page at a time, with a pager for the panel head when there's more than a page.
 * Goes back to the first page when the list changes length, like after a filter changes.
 */
function usePaged<T>(rows: ReadonlyArray<T>) {
  const [paged, setPaged] = useState({ page: 0, total: rows.length })
  const page = paged.total === rows.length ? paged.page : 0
  const shown = rows.slice(page * LIST_PAGE_SIZE, (page + 1) * LIST_PAGE_SIZE)
  const pager =
    rows.length > LIST_PAGE_SIZE ? (
      <Pager
        page={page}
        total={rows.length}
        onPage={next => setPaged({ page: next, total: rows.length })}
      />
    ) : null
  return { shown, pager }
}

function PersonName({ person }: { person: PersonRow }) {
  return (
    <>
      <RaceMix races={person.races} />
      <ListNameText>
        <PlayerNameButton name={person.name} race={person.races[0]?.race}>
          {person.name}
        </PlayerNameButton>
      </ListNameText>
    </>
  )
}

export function People({ title, people }: { title: string; people: ReadonlyArray<PersonRow> }) {
  const { shown, pager } = usePaged(people)
  return (
    <PaddedPanel>
      <PanelHead $spread={!!pager}>
        <PanelTitle>{title}</PanelTitle>
        {pager}
      </PanelHead>
      {shown.map(person => (
        <ListRow key={person.name}>
          <ListName>
            <PersonName person={person} />
          </ListName>
          <RightAligned>
            <Muted>
              <GameCount count={person.games} />
            </Muted>
          </RightAligned>
          <RightAligned>
            <RecordText record={person} />
          </RightAligned>
        </ListRow>
      ))}
    </PaddedPanel>
  )
}

function getMapLabel(map: MapRow, t: TFunction) {
  switch (map.family) {
    case 'fastest':
      return t('myStats.maps.fastest', 'Fastest (every version)')
    case 'bgh':
      return t('myStats.maps.bgh', 'Big Game Hunters (every version)')
    default:
      return map.mapName
  }
}

const MapListRow = styled.div<{ $art?: MapArt }>`
  position: relative;
  isolation: isolate;
  min-height: 48px;
  margin: 0 -8px;
  padding: 0 var(--space-2);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: var(--space-4);
  align-items: center;
  border-radius: 8px;
  overflow: hidden;

  /* A faint picture of the map behind its name, fading out toward the record. */
  ${props =>
    props.$art
      ? css`
          &::before {
            content: '';
            position: absolute;
            inset: 0;
            z-index: -1;
            background: url('${props.$art.url}') center / cover;
            opacity: 0.3;
            mask-image: linear-gradient(to right, black, transparent 85%);
          }
        `
      : ''}
`

const MapRecord = styled(RightAligned)`
  min-width: 72px;
  white-space: nowrap;
`

function MapListItem({
  map,
  tilesets,
}: {
  map: MapRow
  tilesets: Readonly<Record<string, TilesetId>>
}) {
  const { t } = useTranslation()
  const art = useMapArt(map.mapName, tilesets[getMapKey(map.mapName)])
  return (
    <MapListRow $art={art}>
      <ListName>
        <ListNameText>{getMapLabel(map, t)}</ListNameText>
      </ListName>
      <RightAligned>
        <Muted>
          <GameCount count={map.games} />
        </Muted>
      </RightAligned>
      <MapRecord>
        <RecordText record={map} />
      </MapRecord>
    </MapListRow>
  )
}

export function Maps({ maps }: { maps: ReadonlyArray<MapRow> }) {
  const { t } = useTranslation()
  const { shown, pager } = usePaged(maps)
  const [tilesets, setTilesets] = useState<Readonly<Record<string, TilesetId>>>({})
  useEffect(() => {
    ipcRenderer
      .invoke('replayLibraryGetMapTilesets')
      ?.then(result => setTilesets(result ?? {}))
      .catch(swallowNonBuiltins)
  }, [])
  return (
    <PaddedPanel>
      <PanelHead $spread={!!pager}>
        <PanelTitle>{t('myStats.maps.title', 'Maps')}</PanelTitle>
        {pager}
      </PanelHead>
      {shown.map(map => (
        <MapListItem key={`${map.family}${map.mapName}`} map={map} tilesets={tilesets} />
      ))}
    </PaddedPanel>
  )
}

// Team games

/** Below this panel width, the race table goes under the numbers instead of beside them. */
const TEAM_SIDE_BY_SIDE_PX = 760

const TeamPanel = styled(PaddedPanel)`
  container: team-games / inline-size;
`

const TeamBody = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);

  @container team-games (width >= ${TEAM_SIDE_BY_SIDE_PX}px) {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
    gap: var(--space-8);
  }
`

const TeamRaces = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);

  @container team-games (width >= ${TEAM_SIDE_BY_SIDE_PX}px) {
    padding-left: var(--space-8);
    border-left: 1px solid var(--theme-outline-variant);

    & > h3 {
      margin-top: 0;
      padding-top: 0;
      border-top: none;
    }
  }
`

const TeamFacts = styled.div`
  padding: var(--space-1) 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4);
`

const TeamFact = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
`

const TeamSubtitle = styled.h3`
  ${labelMedium};
  margin: var(--space-1) 0 0;
  padding-top: var(--space-3);
  border-top: 1px solid var(--theme-outline-variant);
  color: var(--theme-on-surface-variant);
  font-weight: 700;
`

type TeamRace = 'any' | AssignedRaceChar

/**
 * Team games, narrowed down to a race the user played with a filter of its own, which starts at
 * the page's race and leaves the rest of the page alone.
 */
export function TeamGames({
  byRace,
  initialRace,
}: {
  byRace: NonNullable<MyStatsResult['team']>
  initialRace?: AssignedRaceChar
}) {
  const { t } = useTranslation()
  const [race, setRace] = useState<TeamRace>(initialRace ?? 'any')
  const team = byRace[race]
  const teammateSlots = Math.max(1, ...(team?.byTeamRaces.map(row => row.races.length) ?? []))
  const options: Array<SegmentOption<TeamRace>> = [
    { value: 'any', label: t('myStats.filters.anyRace', 'Any race') },
    { value: 'p', label: 'P', title: t('myStats.filters.protoss', 'Protoss') },
    { value: 't', label: 'T', title: t('myStats.filters.terran', 'Terran') },
    { value: 'z', label: 'Z', title: t('myStats.filters.zerg', 'Zerg') },
  ]
  return (
    <TeamPanel>
      <PanelHead $spread={true}>
        <PanelTitle>{t('myStats.team.title', 'Team games')}</PanelTitle>
        <Segmented
          label={t('myStats.team.race', 'Your race in team games')}
          options={options}
          value={race}
          onChange={setRace}
        />
      </PanelHead>
      {team ? (
        <TeamBody>
          <TeamFacts>
            <TeamFact>
              <MacroValue>{formatPercent(team.incomeShare?.value)}</MacroValue>
              <TileLabel>
                <HelpLabel
                  label={t('myStats.team.incomeShare', 'Mining share')}
                  help={t(
                    'myStats.help.incomeShare',
                    'Your part of the minerals and gas your team mined, on average.',
                  )}
                />
              </TileLabel>
            </TeamFact>
            <TeamFact>
              <MacroValue>{formatPercent(team.killShare?.value)}</MacroValue>
              <TileLabel>
                <HelpLabel
                  label={t('myStats.team.killShare', 'Kill share')}
                  help={t(
                    'myStats.help.killShare',
                    "Your part of the enemy army your team killed, by the game's score, on average.",
                  )}
                />
              </TileLabel>
            </TeamFact>
            <TeamFact>
              <MacroValue>
                {team.losses
                  ? t('myStats.team.firstOutValue', '{{firstOut}} of {{losses}}', {
                      firstOut: team.firstOutLosses,
                      losses: team.losses,
                    })
                  : '-'}
              </MacroValue>
              <TileLabel>
                <HelpLabel
                  label={t('myStats.team.firstOut', 'Out first in losses')}
                  help={t(
                    'myStats.help.firstOut',
                    'Team losses where you were the first on your team to leave or be defeated.',
                  )}
                />
              </TileLabel>
            </TeamFact>
          </TeamFacts>
          <TeamRaces>
            <TeamSubtitle>
              <HelpLabel
                label={t('myStats.team.byTeammates', "By your teammates' races")}
                help={t(
                  'myStats.help.byTeammates',
                  'Your record in team games, grouped by the races your teammates played.',
                )}
              />
            </TeamSubtitle>
            {team.byTeamRaces.map(row => (
              <ListRow key={row.races.join('')}>
                <ListName>
                  <Muted>{t('myStats.team.with', 'With')}</Muted>
                  <RaceRow $slots={teammateSlots}>
                    {row.races.map((teammateRace, i) => (
                      <RaceTag key={i} race={teammateRace} />
                    ))}
                  </RaceRow>
                </ListName>
                <RightAligned>
                  <Muted>
                    <GameCount count={row.games} />
                  </Muted>
                </RightAligned>
                <RightAligned>
                  <RecordText record={row} />
                </RightAligned>
              </ListRow>
            ))}
          </TeamRaces>
        </TeamBody>
      ) : (
        <PanelNote>{t('myStats.team.noGames', 'No team games as this race.')}</PanelNote>
      )}
    </TeamPanel>
  )
}
