import { TFunction } from 'i18next'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { getGameDurationString } from '../../common/games/game-duration'
import { MapFamily } from '../../common/games/map-family'
import { GameShape } from '../../common/games/player-metrics'

import { LiveGamePlayer } from '../../common/live-game'
import { MyStatsGame, WinLoss } from '../../common/my-stats/my-stats'
import { PlayerScout, ScoutMatchup } from '../../common/my-stats/player-scout'
import { emptyPlaystyleCounts, Playstyle, PLAYSTYLES } from '../../common/my-stats/playstyle'
import { AssignedRaceChar, RaceChar, raceCharToLabel } from '../../common/races'
import { KnownPlayer } from '../../common/settings/local-settings'
import { urlPath } from '../../common/urls'
import { getBuildFamilyName } from '../builds/build-shared'
import { getMapFamilyShortName } from '../coach/coach-shared'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { SectionErrorBoundary, useStatFormat } from '../games/game-stats-shared'
import { useMyPlayerNames } from '../games/my-player-names'
import { relativeTimeFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { liveGameAtom } from '../live-game/live-game-atoms'
import { ScoutState, useScouts } from '../live-game/live-game-data'
import { TileRating } from '../live-game/live-game-page'
import {
  GameKind,
  getCheeseRate,
  getEnemyRaces,
  getGameKind,
  getPlaystyle,
  getTeams,
  getUsualBuilds,
} from '../live-game/live-game-summary'
import {
  getPersonKey,
  getPlaystyleLabel,
  getRegionLabel,
  usePeople,
} from '../live-game/live-player-details'

import { Accordion } from '../material/accordion'
import { TextButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Dialog } from '../material/dialog'
import { RaceTag } from '../material/race-tag'
import { SkeletonText } from '../material/skeleton'
import {
  formatPercent,
  getResultLetter,
  getResultWord,
  getShapeLabel,
  getWinRate,
  HelpLabel,
  Muted,
  RecentGames,
  RecordText,
} from '../my-stats/my-stats-panels'
import { Badge } from '../my-stats/page-layout'
import { push } from '../navigation/routing'
import { useAppDispatch } from '../redux-hooks'
import { getGameStatsUrl } from '../replays/action-creators'
import { getRaceColor } from '../styles/colors'
import {
  bahnschrift,
  bodyMedium,
  bodySmall,
  labelLarge,
  labelMedium,
  singleLine,
} from '../styles/typography'
import {
  findPlayerByAccount,
  getPlayerForAccount,
  savePlayer,
  useKnownPlayers,
} from './known-players'
import { usePlayerAccounts } from './open-player'
import { usePlayerRecord } from './player-record-hooks'
import { LeagueTag } from './rank-tags'

const StyledDialog = styled(Dialog)`
  max-width: 640px;
`

const DialogTitle = styled.span`
  ${bahnschrift};
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
`

const TitleName = styled.span`
  ${singleLine};
  min-width: 0;
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`

const Group = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`

const IdentityRow = styled.div`
  ${bodyMedium};
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  color: var(--theme-on-surface-variant);

  /* The rating is laid out to sit at the end of a tile; here it follows the rest. */
  & > :last-child {
    margin-left: 0;
  }
`

const Heading = styled.h3`
  ${labelLarge};
  margin: 0;
  color: var(--theme-on-surface-variant);
  font-weight: 700;
`

/** One row when there's room, else wrapped rows whose tiles share each row evenly. */
const Tiles = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
`

const Tile = styled.div`
  /* Fits the longest note, "Estimate, 120 games". */
  flex: 1 1 160px;
  min-width: 0;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 2px;

  border-radius: var(--radius-md);
  background: var(--theme-container-low);
`

const TileValue = styled.span`
  ${bahnschrift};
  ${singleLine};
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 24px;
  font-weight: 700;
  line-height: 28px;
  font-variant-numeric: tabular-nums;
`

const TileLabel = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const TileNote = styled.span`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const Caption = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const Figure = styled.span`
  ${bahnschrift};
  font-variant-numeric: tabular-nums;
`

/** A box of what matters for the game being played, set apart from the rest. */
const Callout = styled.div<{ $color: string }>`
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);

  border-left: 3px solid ${props => props.$color};
  border-radius: var(--radius-md);
  background: var(--theme-container-low);
`

/** The user's own words about someone, up top where they're seen before any number. */
const NoteBox = styled.div`
  ${bodyMedium};
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;

  border-radius: var(--radius-md);
  background: var(--theme-container-high);
`

const NoteLabel = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  font-weight: 600;
`

const CalloutLine = styled.div`
  ${bodyMedium};
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
`

const LineLabel = styled.span`
  ${labelMedium};
  flex-shrink: 0;
  min-width: 96px;
  color: var(--theme-on-surface-variant);
`

const Strong = styled.span`
  font-weight: 700;
`

const CheeseValue = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
`

const CheeseBolt = styled(MaterialIcon).attrs({ icon: 'bolt', size: 16 })`
  align-self: center;
`

// Builds table

const Table = styled.div`
  ${bodySmall};
  display: grid;
  /* The same columns in every matchup, so the numbers line up from one to the next. */
  grid-template-columns: minmax(0, 1fr) 48px 64px 48px;
  align-items: baseline;
  gap: 2px var(--space-3);
`

/** A row is its cells, laid out by the table's columns. */
const TableRow = styled.div`
  display: contents;
`

const HeadCell = styled.div<{ $end?: boolean }>`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  text-align: ${props => (props.$end ? 'right' : 'left')};
`

/** A matchup's first row. Every cell in it gets the room above, so the row stays level. */
const MatchupCell = styled.div<{ $end?: boolean }>`
  ${labelMedium};
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--theme-outline-variant);
  font-weight: 700;
  text-align: ${props => (props.$end ? 'right' : 'left')};
`

const BuildCell = styled.div`
  min-width: 0;
  padding-left: var(--space-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const NumberCell = styled.div`
  ${bahnschrift};
  text-align: right;
  font-variant-numeric: tabular-nums;
`

/** A share from too few games to mean much, shown but quiet. */
const FewGames = styled.span`
  color: var(--theme-on-surface-variant);
  opacity: 0.6;
`

// Shares, like races played and styles of play

const Shares = styled.div`
  display: grid;
  grid-template-columns: minmax(96px, max-content) minmax(0, 1fr) 40px 40px;
  align-items: center;
  gap: var(--space-2) var(--space-3);
`

const ShareLabel = styled.span`
  ${bodyMedium};
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
`

const Bar = styled.span`
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--theme-container-high);
  overflow: hidden;
`

const BarFill = styled.span<{ $color: string }>`
  display: block;
  height: 100%;
  border-radius: inherit;
  background: ${props => props.$color};
`

const ShareNumber = styled.span`
  ${bodySmall};
  ${bahnschrift};
  text-align: right;
  font-variant-numeric: tabular-nums;
`

const ShareDim = styled(ShareNumber)`
  color: var(--theme-on-surface-variant);
`

// Recent games

const GameList = styled.div`
  display: flex;
  flex-direction: column;
`

const GameRow = styled.button`
  ${buttonReset};
  ${bodySmall};
  min-height: 32px;
  padding: 0 var(--space-2);

  display: grid;
  grid-template-columns: 24px 20px minmax(72px, max-content) minmax(0, 1fr) 48px 96px 16px;
  align-items: center;
  gap: var(--space-3);

  border-radius: var(--radius-sm);
  color: var(--theme-on-surface);
  text-align: left;
  cursor: pointer;

  &:hover {
    background: rgb(from var(--theme-on-surface) r g b / 0.06);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: -3px;
  }
`

const RESULT_FILLS: Record<MyStatsGame['result'], string> = {
  win: 'var(--theme-positive-container)',
  loss: 'var(--theme-negative-container)',
  unknown: 'var(--theme-container)',
}

const RESULT_TEXT: Record<MyStatsGame['result'], string> = {
  win: 'var(--theme-positive)',
  loss: 'var(--theme-negative)',
  unknown: 'var(--theme-on-surface-variant)',
}

const ResultLetter = styled.span<{ $result: MyStatsGame['result'] }>`
  ${labelMedium};
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: var(--radius-sm);
  background: ${props => RESULT_FILLS[props.$result]};
  color: ${props => RESULT_TEXT[props.$result]};
  font-weight: 700;
`

const RowCell = styled.span`
  ${singleLine};
  min-width: 0;
`

const RowDim = styled(RowCell)`
  color: var(--theme-on-surface-variant);
`

const RowChevron = styled(MaterialIcon).attrs({ icon: 'chevron_right', size: 16 })`
  color: var(--theme-on-surface-variant);
`

const RowNumber = styled(RowDim)`
  ${bahnschrift};
  text-align: right;
  font-variant-numeric: tabular-nums;
`

// Note and accounts

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const FieldLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  font-weight: 600;
`

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const Chip = styled.span`
  ${labelLarge};
  height: 28px;
  padding: 0 4px 0 10px;

  display: inline-flex;
  align-items: center;
  gap: 2px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-full);
  font-weight: 600;
`

/** An account the user can't take off, like one from their Battle.net profile. */
const FixedChip = styled(Chip)`
  padding: 0 10px;
`

const ChipRemove = styled.button`
  ${buttonReset};
  width: 22px;
  height: 22px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: var(--radius-full);
  color: var(--theme-on-surface-variant);
  cursor: pointer;

  &:hover {
    background: rgb(from var(--theme-on-surface) r g b / 0.08);
    color: var(--theme-on-surface);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 1px;
  }
`

const AddRow = styled.form`
  display: flex;
  gap: 6px;
`

const fieldStyle = `
  min-width: 0;
  padding: 0 10px;

  border: 1px solid var(--theme-outline-strong);
  border-radius: var(--radius-md);
  background: var(--theme-container-low);
  color: var(--theme-on-surface);
  font: inherit;

  &:focus-visible {
    outline: 2px solid var(--theme-grey-blue);
    outline-offset: 1px;
  }
`

const TextInput = styled.input`
  ${bodyMedium};
  ${fieldStyle};
  flex: 1 1 auto;
  height: 32px;
`

const NoteInput = styled.textarea`
  ${bodyMedium};
  ${fieldStyle};
  min-height: 72px;
  padding: 8px 10px;
  resize: vertical;
`

const AddButton = styled.button`
  ${buttonReset};
  ${labelLarge};
  height: 32px;
  padding: 0 var(--space-3);

  border-radius: var(--radius-md);
  color: var(--theme-on-surface);
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: rgb(from var(--theme-on-surface) r g b / 0.08);
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 1px;
  }
`

const TIME_AGO_FORMAT = relativeTimeFormat({ numeric: 'auto' })

/** How long ago something was, like 3 days ago. */
function useTimeAgo() {
  const format = useFormat(TIME_AGO_FORMAT)
  return (ms: number) => format.format(Math.min(ms, Date.now()))
}

/** Players on a side, in game types whose matchups are written out. */
const TEAM_SIZES: Partial<Record<GameShape, number>> = { '1v1': 1, '2v2': 2 }

/**
 * Like P v T or PZ v TZ when both sides' races are known, or else the race and the kind of game, and
 * the kind of map in game types that play differently by map.
 */
function getMatchupLabel(matchup: ScoutMatchup, t: TFunction) {
  const team = [matchup.race, ...matchup.teammateRaces].sort()
  const size = TEAM_SIZES[matchup.shape]
  if (size && team.length === size && matchup.opponentRaces.length === size) {
    const side = (races: ReadonlyArray<string>) => races.join('').toUpperCase()
    return `${side(team)} ${t('gameStats.matchupSeparator', 'v')} ${side(matchup.opponentRaces)}`
  }
  return `${raceCharToLabel(matchup.race, t)} · ${getKindLabel(matchup, t)}`
}

/** A kind of game, like 3v3 BGH: the game type, and the kind of map where that matters. */
function getKindLabel(kind: GameKind, t: TFunction) {
  return [
    getShapeLabel(kind.shape, t),
    kind.mapFamily ? getMapFamilyShortName(kind.mapFamily, t) : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * A game's races from the player's side, like PZ v TT, or its game type when a side's races
 * aren't all known.
 */
function getGameRaces(game: MyStatsGame, t: TFunction) {
  const team = game.race ? [game.race, ...game.teammateRaces].sort() : []
  const size = team.length
  if (!size || game.opponentRaces.length !== size || size * 2 !== getShapeSize(game.shape)) {
    return getShapeLabel(game.shape, t)
  }
  const side = (races: ReadonlyArray<string>) => races.join('').toUpperCase()
  return `${side(team)} ${t('gameStats.matchupSeparator', 'v')} ${side(game.opponentRaces)}`
}

/** How many play in an even game type, like 6 in a 3v3. */
function getShapeSize(shape: GameShape) {
  const match = /^(\d)v\d$/.exec(shape)
  return match ? Number(match[1]) * 2 : 0
}

/** What one of the ways someone's builds go means, for its label's tooltip. */
function getPlaystyleHelp(style: Playstyle, t: TFunction) {
  switch (style) {
    case 'standard':
      return t('players.playstyleHelp.standard', 'Builds plenty of other players go with too.')
    case 'cheese':
      return t(
        'players.playstyleHelp.cheese',
        'Rushes and all ins, like a BBS, a 4 pool or a cannon rush.',
      )
    case 'staticDefense':
      return t(
        'players.playstyleHelp.staticDefense',
        'Plenty of Cannons, Bunkers, Turrets or Colonies early.',
      )
    case 'tech':
      return t(
        'players.playstyleHelp.tech',
        'An uncommon build that heads for tech early, like Dark Templar or 1 base Mutalisks.',
      )
    case 'greedy':
      return t(
        'players.playstyleHelp.greedy',
        'An uncommon build that expands early, like Nexus first or 3 Hatch.',
      )
    case 'offMeta':
      return t('players.playstyleHelp.offMeta', 'An uncommon build that is none of those.')
    default:
      return style satisfies never
  }
}

/** Fewer games than this, and a win rate says little: it's shown, but quiet. */
const FEW_GAMES = 5

/** A win rate, quiet when it's from too few games to tell. */
function WinRate({ record }: { record: WinLoss }) {
  const { t } = useTranslation()
  const rate = formatPercent(getWinRate(record))
  return record.wins + record.losses < FEW_GAMES ? (
    <FewGames title={t('players.fewGames', 'Too few games to tell')}>{rate}</FewGames>
  ) : (
    <>{rate}</>
  )
}

function isKind(row: { shape: GameShape; mapFamily?: MapFamily }, kind: GameKind) {
  return row.shape === kind.shape && (!kind.mapFamily || row.mapFamily === kind.mapFamily)
}

/** The race someone is playing, unless it's random or not known yet. */
function getKnownRace(race: RaceChar | undefined): AssignedRaceChar | undefined {
  return race && race !== 'r' ? race : undefined
}

/**
 * Their matchups with the ones that matter now first: as the race they're playing, and in the
 * kind of game they're in. Otherwise most games first.
 */
function sortMatchups(
  matchups: ReadonlyArray<ScoutMatchup>,
  race: AssignedRaceChar | undefined,
  kind: GameKind | undefined,
) {
  const rank = (m: ScoutMatchup) =>
    Number(!!race && m.race !== race) * 2 + Number(!!kind && !isKind(m, kind))
  return matchups.toSorted((a, b) => rank(a) - rank(b) || b.games - a.games)
}

/** What's known about whoever the dialog is about. */
interface Profile {
  name: string
  /** The race they're playing, where they were clicked on. */
  race?: RaceChar
  /** Every account their games are looked up by. */
  accounts: string[]
  isMe: boolean
  /** From the live game they're in: their gateway, rating and ladder accounts. */
  live?: {
    player: LiveGamePlayer
    kind: GameKind
    enemyRaces: AssignedRaceChar[]
    /** Whether they're on the user's side, when the user is playing. */
    ally?: boolean
  }
}

// Overview

/** The few numbers that sum someone up, and how their latest games went. */
function Overview({
  scout,
  isMe,
  showCheese,
}: {
  scout: PlayerScout
  isMe: boolean
  /** Whether to lead with how often they cheese, which a live game's box shows otherwise. */
  showCheese: boolean
}) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const { totals } = scout
  const noResult = totals.games - totals.record.wins - totals.record.losses
  const styles = emptyPlaystyleCounts()
  for (const row of scout.playstyles) {
    for (const style of PLAYSTYLES) {
      styles[style] += row.counts[style]
    }
  }
  const styleGames = PLAYSTYLES.reduce((sum, style) => sum + styles[style], 0)
  return (
    <Group>
      <Heading>
        {isMe
          ? t('players.allYourGames', 'All your games')
          : t('players.allTheirGames', 'All their games')}
      </Heading>
      <Tiles>
        <Tile>
          <TileValue>
            <RecordText record={totals.record} />
          </TileValue>
          <TileLabel>
            <HelpLabel
              label={t('players.record', 'Record')}
              help={
                isMe
                  ? t(
                      'players.recordHelpMe',
                      "Every analyzed game of yours. A game you left is a loss. Games with no result don't count.",
                    )
                  : t(
                      'players.recordHelp',
                      "Every analyzed game of theirs, whoever they played. A game they left is a loss. Games with no result don't count.",
                    )
              }
            />
          </TileLabel>
          <TileNote>
            {t('players.winRateNote', '{{rate}} won', {
              rate: formatPercent(getWinRate(totals.record)),
            })}
          </TileNote>
        </Tile>
        <Tile>
          <TileValue>{totals.eapm ? format.format(totals.eapm.value) : '-'}</TileValue>
          <TileLabel>
            <HelpLabel
              label={t('players.eapm', 'eAPM')}
              help={t(
                'players.eapmHelp',
                'Effective actions per minute, on average. APM without spam, such as the same order clicked twice in a row.',
              )}
            />
          </TileLabel>
          <TileNote>
            {t('players.apmNote', 'APM {{apm}}', {
              apm: totals.apm ? format.format(totals.apm.value) : '-',
            })}
          </TileNote>
        </Tile>
        {showCheese ? (
          <Tile>
            <TileValue>{styleGames ? formatPercent(styles.cheese / styleGames) : '-'}</TileValue>
            <TileLabel>
              <HelpLabel
                label={t('players.cheese', 'Cheese')}
                help={t(
                  'players.cheeseAllHelp',
                  'Rushes and all ins, like a BBS, a 4 pool or a cannon rush, out of every game with a named build.',
                )}
              />
            </TileLabel>
            <TileNote>
              {styleGames
                ? t('players.cheeseNote', {
                    defaultValue: '{{cheese}} of {{count}} games',
                    defaultValue_one: '{{cheese}} of 1 game',
                    cheese: styles.cheese,
                    count: styleGames,
                  })
                : t('players.noNamedBuild', 'No named build')}
            </TileNote>
          </Tile>
        ) : null}
        <Tile>
          <TileValue>
            {totals.eSkill ? format.format(totals.eSkill.value) : '-'}
            {totals.eSkill?.rank ? (
              <LeagueTag $rank={totals.eSkill.rank}>{totals.eSkill.rank.toUpperCase()}</LeagueTag>
            ) : null}
          </TileValue>
          <TileLabel>
            <HelpLabel
              label={t('players.eSkill', 'eSkill')}
              help={t(
                'players.eSkillHelp',
                "An estimate, not a ladder rating: the 1v1 ladder MMR and rank that this speed, hotkeys and macro match, over the latest games. Results don't count.",
              )}
            />
          </TileLabel>
          <TileNote>
            {totals.eSkill
              ? t('players.eSkillGames', {
                  defaultValue: 'Estimate, {{count}} games',
                  defaultValue_one: 'Estimate, 1 game',
                  count: totals.eSkill.games,
                })
              : t('players.eSkillNone', 'Needs longer games')}
          </TileNote>
        </Tile>
        <Tile>
          <TileValue>
            {totals.durationMs ? getGameDurationString(totals.durationMs.value) : '-'}
          </TileValue>
          <TileLabel>{t('players.length', 'Game length')}</TileLabel>
          <TileNote>{t('players.lengthNote', 'On average')}</TileNote>
        </Tile>
      </Tiles>
      {totals.recent.length ? <RecentGames games={totals.recent} compact={true} /> : null}
      <Caption>
        {[
          t('players.scope', {
            defaultValue: '{{count}} analyzed games, newest on the left.',
            defaultValue_one: '1 analyzed game.',
            count: totals.games,
          }),
          noResult > 0
            ? t('players.noResult', {
                defaultValue: '{{count}} have no result.',
                defaultValue_one: '1 has no result.',
                count: noResult,
              })
            : '',
          scout.fromBaseline
            ? t('players.fromBaseline', {
                defaultValue: '{{count}} are ladder games that come with GG Stats.',
                defaultValue_one: '1 is a ladder game that comes with GG Stats.',
                count: scout.fromBaseline,
              })
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
      </Caption>
    </Group>
  )
}

// This game

/** Their record in this kind of game as `race`, or with no race, as any race. */
function getRaceKindRecord(scout: PlayerScout, kind: GameKind, race: AssignedRaceChar | undefined) {
  const record: WinLoss = { games: 0, wins: 0, losses: 0 }
  for (const matchup of scout.matchups) {
    if (isKind(matchup, kind) && (!race || matchup.race === race)) {
      record.games += matchup.games
      record.wins += matchup.wins
      record.losses += matchup.losses
    }
  }
  return record
}

/**
 * What to expect from them in the live game: the builds they go with as the race they picked
 * against these races, how they tend to play, and their record in this kind of game.
 */
function ThisGame({ scout, live }: { scout: PlayerScout; live: NonNullable<Profile['live']> }) {
  const { t } = useTranslation()
  const { player, kind, enemyRaces } = live
  const race = getKnownRace(player.race)
  const style = getPlaystyle(scout, race, kind)
  const cheese = getCheeseRate(scout, race, kind)
  const kindLabel = getKindLabel(kind, t)
  const enemies = [...enemyRaces].sort().join('').toUpperCase()
  const raceRecord = getRaceKindRecord(scout, kind, race)
  const record = raceRecord.games ? raceRecord : getRaceKindRecord(scout, kind, undefined)

  const buildLines = (race ? [race] : scout.races.slice(0, 2).map(r => r.race)).map(played => {
    const usual = getUsualBuilds(scout, played, kind, enemyRaces)
    let scope: string | undefined
    if (usual?.scope === 'matchup' && enemies) {
      scope = t('players.buildScope.matchup', 'vs {{races}}', { races: enemies })
    } else if (usual?.scope === 'race') {
      scope = t('players.buildScope.race', 'in other game types')
    }
    return (
      <CalloutLine key={played}>
        <LineLabel>
          {race
            ? t('players.usualBuild', 'Usual build')
            : t('players.usualBuildAs', 'As {{race}}', { race: raceCharToLabel(played, t) })}
        </LineLabel>
        {usual ? (
          <span
            title={t('players.buildShareHelp', 'Out of {{of}} games with a named build', {
              of: usual.of,
            })}>
            {usual.builds.map((build, i) => (
              <React.Fragment key={build.family}>
                {i > 0 ? <Muted> · </Muted> : null}
                <Strong>{getBuildFamilyName(build.family, t)}</Strong>{' '}
                <Muted>
                  {build.games}/{usual.of}
                </Muted>
              </React.Fragment>
            ))}
            {scope ? <Muted> {scope}</Muted> : null}
          </span>
        ) : (
          <Muted>{t('players.noNamedBuild', 'No named build')}</Muted>
        )}
      </CalloutLine>
    )
  })

  return (
    <Callout $color={race ? getRaceColor(race) : 'var(--theme-outline-strong)'}>
      <Heading>
        {race
          ? t('players.thisGameAs', 'This game: {{race}} in {{kind}}', {
              race: raceCharToLabel(race, t),
              kind: kindLabel,
            })
          : t('players.thisGame', 'This game: {{kind}}', { kind: kindLabel })}
      </Heading>
      <CalloutLine>
        <LineLabel>
          <HelpLabel
            label={t('players.cheese', 'Cheese')}
            help={t(
              'players.cheeseHelp',
              'Rushes and all ins, out of their games with a named build. As this race in this kind of game when they have a few of those.',
            )}
          />
        </LineLabel>
        {cheese ? (
          <CheeseValue>
            {cheese.cheeser ? <CheeseBolt /> : null}
            <Figure>{formatPercent(cheese.cheese / cheese.games)}</Figure>
            <Muted>
              {cheese.cheese}/{cheese.games}
            </Muted>
          </CheeseValue>
        ) : (
          <Muted>{t('players.noNamedBuild', 'No named build')}</Muted>
        )}
      </CalloutLine>
      {buildLines}
      {style && style.style !== 'standard' && style.style !== 'cheese' ? (
        <CalloutLine>
          <LineLabel>{t('players.watchFor', 'Watch for')}</LineLabel>
          <span>
            <HelpLabel
              label={getPlaystyleLabel(style.style, t)}
              help={getPlaystyleHelp(style.style, t)}
            />{' '}
            <Muted>
              {style.counts[style.style]}/{style.games}
            </Muted>
          </span>
        </CalloutLine>
      ) : null}
      <CalloutLine>
        <LineLabel>
          {race && raceRecord.games
            ? t('players.recordAs', 'Record as {{race}}', { race: raceCharToLabel(race, t) })
            : t('players.record', 'Record')}
        </LineLabel>
        {record.games ? (
          <>
            <Figure>
              <RecordText record={record} />
            </Figure>
            <Muted>
              {t('players.winRateNote', '{{rate}} won', {
                rate: formatPercent(getWinRate(record)),
              })}
            </Muted>
          </>
        ) : (
          <Muted>{t('players.noKindGames', 'No games in {{kind}} yet', { kind: kindLabel })}</Muted>
        )}
      </CalloutLine>
    </Callout>
  )
}

// You and them

/**
 * The user's record with someone. Keyed by the game, so the next game counts again; when more of
 * their accounts become known, the record so far stays up until the new count replaces it.
 */
function YouAndThem({ accounts, myNames }: { accounts: string[]; myNames: ReadonlyArray<string> }) {
  const { t } = useTranslation()
  const timeAgo = useTimeAgo()
  const record = usePlayerRecord(accounts, myNames)

  let body: React.ReactNode
  if (record === 'error') {
    body = <Muted>{t('players.recordFailed', "Couldn't count your games with them.")}</Muted>
  } else if (!record) {
    body = <SkeletonText $width='240px' />
  } else {
    const { against, with: together } = record
    const unknown = against.unknown + together.unknown
    const games = against.wins + against.losses + together.wins + together.losses + unknown
    body = games ? (
      <CalloutLine>
        <span>
          <Muted>{t('players.against', 'Against them')}</Muted>{' '}
          <Figure>
            <RecordText record={against} />
          </Figure>
        </span>
        <span>
          <Muted>{t('players.with', 'With them')}</Muted>{' '}
          <Figure>
            <RecordText record={together} />
          </Figure>
        </span>
        {record.lastPlayedMs ? (
          <Muted>
            {t('players.lastPlayed', 'Last played {{when}}', {
              when: timeAgo(record.lastPlayedMs),
            })}
          </Muted>
        ) : null}
        {unknown ? (
          <Muted>
            {t('players.withoutResult', {
              defaultValue: '{{count}} with no result',
              count: unknown,
            })}
          </Muted>
        ) : null}
      </CalloutLine>
    ) : (
      <Muted>{t('players.noGamesTogether', "You haven't played with or against them.")}</Muted>
    )
  }
  return (
    <Group>
      <Heading>{t('players.youAndThem', 'You and them')}</Heading>
      {body}
    </Group>
  )
}

// Builds

/** How much of the builds table shows before it's opened up: a glance, not every game ever. */
const MATCHUPS_SHOWN = 4
const BUILDS_SHOWN = 3

/** The rows a matchup has: its builds, then the games whose build has no name, if any. */
function getBuildRows(matchup: ScoutMatchup, all: boolean) {
  const builds = all ? matchup.builds : matchup.builds.slice(0, BUILDS_SHOWN)
  // Unnamed games only take a row of their own when they're all there is, or everything shows.
  const unnamed = matchup.unnamed.games > 0 && (all || !matchup.builds.length)
  return { builds, unnamed }
}

function countRows(matchups: ReadonlyArray<ScoutMatchup>, all: boolean) {
  return matchups.slice(0, all ? undefined : MATCHUPS_SHOWN).reduce((count, matchup) => {
    const rows = getBuildRows(matchup, all)
    return count + 1 + rows.builds.length + Number(rows.unnamed)
  }, 0)
}

function BuildsTable({ matchups }: { matchups: ReadonlyArray<ScoutMatchup> }) {
  const { t } = useTranslation()
  const [all, setAll] = useState(false)
  const hiddenRows = countRows(matchups, true) - countRows(matchups, false)
  return (
    <>
      <Table role='table' aria-label={t('players.buildsTable', 'Builds by matchup')}>
        <TableRow role='row'>
          <HeadCell role='columnheader'>
            {t('players.matchupAndBuild', 'Matchup and build')}
          </HeadCell>
          <HeadCell role='columnheader' $end={true}>
            {t('players.games', 'Games')}
          </HeadCell>
          <HeadCell role='columnheader' $end={true}>
            {t('players.record', 'Record')}
          </HeadCell>
          <HeadCell role='columnheader' $end={true}>
            {t('players.won', 'Won')}
          </HeadCell>
        </TableRow>
        {matchups.slice(0, all ? undefined : MATCHUPS_SHOWN).map(matchup => {
          const rows = getBuildRows(matchup, all)
          return (
            <React.Fragment
              key={[
                matchup.shape,
                matchup.race,
                matchup.teammateRaces.join(''),
                matchup.opponentRaces.join(''),
                matchup.mapFamily,
              ].join(' ')}>
              <TableRow role='row'>
                <MatchupCell role='rowheader'>{getMatchupLabel(matchup, t)}</MatchupCell>
                <MatchupCell role='cell' $end={true}>
                  <Figure>{matchup.games}</Figure>
                </MatchupCell>
                <MatchupCell role='cell' $end={true}>
                  <RecordText record={matchup} />
                </MatchupCell>
                <MatchupCell role='cell' $end={true}>
                  <Figure>
                    <WinRate record={matchup} />
                  </Figure>
                </MatchupCell>
              </TableRow>
              {rows.builds.map(build => (
                <TableRow role='row' key={build.family}>
                  <BuildCell role='rowheader' title={getBuildFamilyName(build.family, t)}>
                    {getBuildFamilyName(build.family, t)}
                  </BuildCell>
                  <NumberCell role='cell'>{build.games}</NumberCell>
                  <NumberCell role='cell'>
                    <RecordText record={build} />
                  </NumberCell>
                  <NumberCell role='cell'>
                    <WinRate record={build} />
                  </NumberCell>
                </TableRow>
              ))}
              {rows.unnamed ? (
                <TableRow role='row'>
                  <BuildCell
                    role='rowheader'
                    title={t(
                      'players.unnamedBuildHelp',
                      "Games whose build couldn't be named, like ones over too soon to tell.",
                    )}>
                    <Muted>{t('players.unnamedBuild', 'No named build')}</Muted>
                  </BuildCell>
                  <NumberCell role='cell'>{matchup.unnamed.games}</NumberCell>
                  <NumberCell role='cell'>
                    <RecordText record={matchup.unnamed} />
                  </NumberCell>
                  <NumberCell role='cell'>
                    <WinRate record={matchup.unnamed} />
                  </NumberCell>
                </TableRow>
              ) : null}
            </React.Fragment>
          )
        })}
      </Table>
      {hiddenRows > 0 || all ? (
        <div>
          <TextButton
            label={
              all
                ? t('players.showLess', 'Show less')
                : t('players.showMore', {
                    defaultValue: 'Show {{count}} more',
                    count: hiddenRows,
                  })
            }
            onClick={() => setAll(!all)}
          />
        </div>
      ) : null}
    </>
  )
}

/** Their most played build, as `race` when it's known, to say in a word what the builds hold. */
function getTopBuild(scout: PlayerScout, race: AssignedRaceChar | undefined) {
  const tallies = new Map<string, number>()
  for (const matchup of scout.matchups) {
    if (race && matchup.race !== race) {
      continue
    }
    for (const build of matchup.builds) {
      tallies.set(build.family, (tallies.get(build.family) ?? 0) + build.games)
    }
  }
  let top: { family: string; games: number } | undefined
  for (const [family, games] of tallies) {
    if (!top || games > top.games) {
      top = { family, games }
    }
  }
  return top
}

// Races and styles

function RacesAndStyles({
  scout,
  race,
}: {
  scout: PlayerScout
  /** The race they're playing, to say how they play as it. */
  race: AssignedRaceChar | undefined
}) {
  const { t } = useTranslation()
  const raceGames = scout.races.reduce((sum, r) => sum + r.games, 0)
  const counts = emptyPlaystyleCounts()
  const asRace = race ? scout.playstyles.filter(row => row.race === race) : []
  const styleRace = asRace.length ? race : undefined
  for (const row of styleRace ? asRace : scout.playstyles) {
    for (const style of PLAYSTYLES) {
      counts[style] += row.counts[style]
    }
  }
  const styleGames = PLAYSTYLES.reduce((sum, style) => sum + counts[style], 0)
  const played = PLAYSTYLES.filter(style => counts[style] > 0).sort((a, b) => counts[b] - counts[a])
  return (
    <>
      <Field>
        <FieldLabel>{t('players.racesPlayed', 'Races played')}</FieldLabel>
        <Shares>
          {scout.races.map(({ race, games }) => (
            <React.Fragment key={race}>
              <ShareLabel>
                <RaceTag race={race} />
                {raceCharToLabel(race, t)}
              </ShareLabel>
              <Bar>
                <BarFill
                  $color={getRaceColor(race)}
                  style={{ width: `${(games / raceGames) * 100}%` }}
                />
              </Bar>
              <ShareNumber>{games}</ShareNumber>
              <ShareDim>{formatPercent(games / raceGames)}</ShareDim>
            </React.Fragment>
          ))}
        </Shares>
      </Field>
      {played.length ? (
        <Field>
          <FieldLabel>
            <HelpLabel
              label={
                styleRace
                  ? t('players.playStyleAs', 'Play style as {{race}}', {
                      race: raceCharToLabel(styleRace, t),
                    })
                  : t('players.playStyle', 'Play style')
              }
              help={t('players.playStyleHelp', 'Out of their games with a named build.')}
            />
          </FieldLabel>
          <Shares>
            {played.map(style => (
              <React.Fragment key={style}>
                <ShareLabel>
                  <HelpLabel
                    label={getPlaystyleLabel(style, t)}
                    help={getPlaystyleHelp(style, t)}
                  />
                </ShareLabel>
                <Bar>
                  <BarFill
                    $color='var(--theme-on-surface-variant)'
                    style={{ width: `${(counts[style] / styleGames) * 100}%` }}
                  />
                </Bar>
                <ShareNumber>{counts[style]}</ShareNumber>
                <ShareDim>{formatPercent(counts[style] / styleGames)}</ShareDim>
              </React.Fragment>
            ))}
          </Shares>
        </Field>
      ) : null}
    </>
  )
}

// Recent games

/** How many of the latest games list before the rest are asked for. */
const RECENT_SHOWN = 5

function RecentList({ games, onOpen }: { games: ReadonlyArray<MyStatsGame>; onOpen: () => void }) {
  const { t } = useTranslation()
  const timeAgo = useTimeAgo()
  const [all, setAll] = useState(false)
  const newest = games.toReversed()
  return (
    <>
      <GameList>
        {newest.slice(0, all ? undefined : RECENT_SHOWN).map(game => {
          const races = getGameRaces(game, t)
          const length = getGameDurationString(game.durationMs)
          const when = timeAgo(game.gameTimeMs)
          return (
            <GameRow
              key={game.gameId}
              type='button'
              title={new Date(game.gameTimeMs).toLocaleString()}
              aria-label={[getResultWord(game.result, t), races, game.mapName, length, when].join(
                ', ',
              )}
              onClick={() => {
                onOpen()
                push(getGameStatsUrl(game.gameId))
              }}>
              <ResultLetter $result={game.result}>{getResultLetter(game.result, t)}</ResultLetter>
              {game.race ? <RaceTag race={game.race} /> : <span />}
              <RowCell>
                <Strong>{races}</Strong>
              </RowCell>
              <RowDim>{game.mapName}</RowDim>
              <RowNumber>{length}</RowNumber>
              <RowNumber>{when}</RowNumber>
              <RowChevron />
            </GameRow>
          )
        })}
      </GameList>
      {newest.length > RECENT_SHOWN ? (
        <div>
          <TextButton
            label={
              all
                ? t('players.showLess', 'Show less')
                : t('players.showMore', {
                    defaultValue: 'Show {{count}} more',
                    count: newest.length - RECENT_SHOWN,
                  })
            }
            onClick={() => setAll(!all)}
          />
        </div>
      ) : null}
    </>
  )
}

// Note and accounts

/** The user's note on someone and the accounts they play under, saved as they're changed. */
function NoteAndAccounts({
  name,
  ladderAccounts,
}: {
  name: string
  ladderAccounts: ReadonlyArray<string>
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const knownPlayers = useKnownPlayers()
  const [player, setPlayer] = useState<KnownPlayer>(() => getPlayerForAccount(knownPlayers, name))
  const [note, setNote] = useState(player.note ?? '')
  const [newAccount, setNewAccount] = useState('')
  const fixed = ladderAccounts.filter(
    a => !player.accounts.some(b => a.toLowerCase() === b.toLowerCase()),
  )

  const save = (next: KnownPlayer) => {
    setPlayer(next)
    dispatch(savePlayer(next))
  }
  const addAccount = () => {
    const account = newAccount.trim()
    if (account && !player.accounts.some(a => a.toLowerCase() === account.toLowerCase())) {
      save({ ...player, accounts: [...player.accounts, account] })
    }
    setNewAccount('')
  }

  return (
    <>
      <Field>
        <FieldLabel>{t('players.note', 'Your note')}</FieldLabel>
        <NoteInput
          value={note}
          placeholder={t('players.notePlaceholder', 'Anything to remember about them')}
          aria-label={t('players.note', 'Your note')}
          // Saved as it's typed, so closing the dialog any way at all keeps it.
          onChange={event => {
            setNote(event.target.value)
            save({ ...player, note: event.target.value })
          }}
        />
      </Field>
      <Field>
        <FieldLabel>
          <HelpLabel
            label={t('players.accounts', 'Their accounts')}
            help={t('players.accountsHelp', 'Games on any of these count as theirs, everywhere.')}
          />
        </FieldLabel>
        <Chips>
          {player.accounts.map(account => (
            <Chip key={account}>
              {account}
              {player.accounts.length > 1 ? (
                <ChipRemove
                  type='button'
                  aria-label={t('players.removeAccount', 'Remove {{name}}', { name: account })}
                  onClick={() =>
                    save({ ...player, accounts: player.accounts.filter(a => a !== account) })
                  }>
                  <MaterialIcon icon='close' size={16} />
                </ChipRemove>
              ) : (
                <span style={{ width: 6 }} />
              )}
            </Chip>
          ))}
          {fixed.map(account => (
            <FixedChip
              key={account}
              title={t('players.ladderAccount', 'From their Battle.net profile')}>
              {account}
            </FixedChip>
          ))}
        </Chips>
        <AddRow
          onSubmit={event => {
            event.preventDefault()
            addAccount()
          }}>
          <TextInput
            value={newAccount}
            placeholder={t('players.addAccountPlaceholder', 'Another name they play as')}
            aria-label={t('players.addAccount', 'Add an account')}
            onChange={event => setNewAccount(event.target.value)}
          />
          <AddButton type='submit' disabled={!newAccount.trim()}>
            {t('players.add', 'Add')}
          </AddButton>
        </AddRow>
      </Field>
    </>
  )
}

// The dialog

/**
 * What their analyzed games say. In a live game, what matters for it comes first. `between` goes
 * after the summary and before the details.
 */
function ScoutSections({
  scout,
  profile,
  between,
  close,
}: {
  scout: ScoutState
  profile: Profile
  between: React.ReactNode
  close: () => void
}) {
  const { t } = useTranslation()
  if (scout === 'loading') {
    return (
      <>
        <Group>
          <SkeletonText $width='100%' />
          <SkeletonText $width='60%' />
        </Group>
        {between}
      </>
    )
  }
  if (scout === 'error' || !scout.totals.games) {
    let message = t('players.noGames', 'None of their games are analyzed yet.')
    if (scout === 'error') {
      message = t('players.scoutFailed', "Couldn't look up their games.")
    } else if (profile.isMe) {
      message = t('players.noGamesMe', 'None of your games are analyzed yet.')
    }
    return (
      <>
        <Muted>{message}</Muted>
        {between}
      </>
    )
  }
  const race = getKnownRace(profile.live?.player.race ?? profile.race)
  const top = getTopBuild(scout, race)
  const recent = scout.totals.recent
  const recentRecord = {
    wins: recent.filter(g => g.result === 'win').length,
    losses: recent.filter(g => g.result === 'loss').length,
  }
  return (
    <>
      {profile.live ? <ThisGame scout={scout} live={profile.live} /> : null}
      <Overview scout={scout} isMe={profile.isMe} showCheese={!profile.live} />
      {between}
      <Group>
        <Accordion
          title={t('players.builds', 'Builds by matchup')}
          summary={
            top
              ? t('players.buildsSummary', 'Most played: {{build}}', {
                  build: getBuildFamilyName(top.family, t),
                })
              : undefined
          }
          testName='player-builds'>
          <BuildsTable matchups={sortMatchups(scout.matchups, race, profile.live?.kind)} />
        </Accordion>
        <Accordion
          title={t('players.racesAndStyles', 'Races and play style')}
          summary={scout.races
            .map(r => `${r.race.toUpperCase()} ${formatPercent(r.games / scout.totals.games)}`)
            .join(' · ')}
          testName='player-styles'>
          <RacesAndStyles scout={scout} race={race} />
        </Accordion>
        {recent.length ? (
          <Accordion
            title={t('players.recentGames', 'Recent games')}
            summary={t('players.recentSummary', '{{wins}} – {{losses}} in the last {{count}}', {
              wins: recentRecord.wins,
              losses: recentRecord.losses,
              count: recent.length,
            })}
            testName='player-recent'>
            <RecentList games={recent} onOpen={close} />
          </Accordion>
        ) : null}
      </Group>
    </>
  )
}

function PlayerView({
  profile,
  gone,
  onCancel,
  close,
}: {
  profile: Profile
  /** Why someone from the live game isn't in it anymore. */
  gone?: string
  onCancel: () => void
  close: () => void
}) {
  const { t } = useTranslation()
  const myNames = useMyPlayerNames() ?? []
  const knownPlayers = useKnownPlayers()
  const scouts = useScouts([profile.accounts])
  const scout = scouts(profile.accounts)
  const { name, race, isMe, live } = profile
  const note = findPlayerByAccount(knownPlayers, name)?.note
  const region = live?.player.gatewayId ? getRegionLabel(live.player.gatewayId, t) : undefined
  let noteSummary = t('players.addNote', 'Add a note or their other accounts')
  if (note) {
    noteSummary = t('players.editNote', 'Edit your note or their accounts')
  } else if (profile.accounts.length > 1) {
    noteSummary = t('players.accountCount', {
      defaultValue: '{{count}} accounts',
      count: profile.accounts.length,
    })
  }

  return (
    <StyledDialog
      title={
        <DialogTitle>
          {race ? <RaceTag race={race} /> : null}
          <TitleName>{name}</TitleName>
          {isMe ? <Badge>{t('players.you', 'You')}</Badge> : null}
        </DialogTitle>
      }
      onCancel={onCancel}
      showCloseButton={true}
      buttons={[
        <TextButton
          key='stats'
          label={
            isMe
              ? t('players.openMyStats', 'Open My stats')
              : t('players.openStats', 'Open their full stats')
          }
          iconStart={<MaterialIcon icon='query_stats' size={18} />}
          onClick={() => {
            push(isMe ? '/my-stats' : urlPath`/players/${name}`)
            close()
          }}
          testName='player-open-stats'
        />,
      ]}
      testName='player-dialog'>
      <Content>
        {gone ? <Muted>{gone}</Muted> : null}
        {live ? (
          <IdentityRow>
            {live.player.observer ? <Badge>{t('players.observer', 'Observer')}</Badge> : null}
            {live.ally === true ? <Badge>{t('players.yourTeam', 'Your team')}</Badge> : null}
            {live.ally === false ? <Badge>{t('players.opponent', 'Opponent')}</Badge> : null}
            {live.player.battleTag ? <span>{live.player.battleTag}</span> : null}
            {region ? <span>{region}</span> : null}
            {live.player.ladder ? (
              <span>
                {t('players.seasonRecord', 'This season')}{' '}
                <Figure>
                  <RecordText record={live.player.ladder} />
                </Figure>
              </span>
            ) : null}
            <TileRating player={live.player} />
          </IdentityRow>
        ) : null}
        {note ? (
          <NoteBox>
            <NoteLabel>{t('players.note', 'Your note')}</NoteLabel>
            {note}
          </NoteBox>
        ) : null}
        <SectionErrorBoundary>
          <ScoutSections
            scout={scout}
            profile={profile}
            close={close}
            between={
              !isMe && myNames.length ? (
                <SectionErrorBoundary>
                  <YouAndThem accounts={profile.accounts} myNames={myNames} />
                </SectionErrorBoundary>
              ) : null
            }
          />
        </SectionErrorBoundary>
        {!isMe ? (
          <Accordion
            title={t('players.noteAndAccounts', 'Note and accounts')}
            summary={noteSummary}
            testName='player-note'>
            <NoteAndAccounts name={name} ladderAccounts={live?.player.otherAccounts ?? []} />
          </Accordion>
        ) : null}
      </Content>
    </StyledDialog>
  )
}

/** Someone clicked on by name, anywhere outside the live game. */
function NamedPlayerDialog({
  name,
  race,
  onCancel,
  close,
}: {
  name: string
  race?: RaceChar
  onCancel: () => void
  close: () => void
}) {
  // The user's own details count every name they play under.
  const { accounts, isMe } = usePlayerAccounts(name)
  return <PlayerView profile={{ name, race, accounts, isMe }} onCancel={onCancel} close={close} />
}

/**
 * Someone in the live game. It stays up once they've left or the game is over, saying so, and
 * closes for the next game.
 */
function LivePlayerDialog({
  gameId,
  personKey,
  onCancel,
  close,
}: {
  gameId: string
  personKey: string
  onCancel: () => void
  close: () => void
}) {
  const { t } = useTranslation()
  const game = useAtomValue(liveGameAtom)
  const thisGame = game?.id === gameId ? game : undefined
  const people = usePeople(thisGame)
  const found = people.find((p, i) => getPersonKey(p, i, people) === personKey)
  const sides = thisGame ? getTeams(people, thisGame.source) : []
  const [lastSeen, setLastSeen] = useState<Profile>()
  const profile: Profile | undefined = found
    ? {
        name: found.player.name,
        race: found.player.race,
        accounts: found.accounts,
        isMe: found.isMe,
        live: {
          player: found.player,
          kind: getGameKind(sides, thisGame?.mapName),
          enemyRaces: getEnemyRaces(sides, sides.find(side => side.includes(found)) ?? []),
          ally: people.some(p => p.isMe && !p.player.observer)
            ? sides.find(side => side.includes(found))?.some(p => p.isMe)
            : undefined,
        },
      }
    : lastSeen
  if (found && profile && profile.live?.player !== lastSeen?.live?.player) {
    setLastSeen(profile)
  }
  const nextGame = !!game && game.id !== gameId

  useEffect(() => {
    if (nextGame) {
      close()
    }
  }, [nextGame, close])

  if (!profile) {
    return null
  }
  let gone: string | undefined
  if (!found) {
    gone = game
      ? t('players.leftGame', 'They left the game.')
      : t('players.gameOver', 'The game is over.')
  }
  return <PlayerView profile={profile} gone={gone} onCancel={onCancel} close={close} />
}

export interface PlayerDialogProps extends CommonDialogProps {
  name: string
  race?: RaceChar
  /** Where they are in the live game, when they were clicked on there. */
  live?: { gameId: string; personKey: string }
}

/**
 * Everything known about one player: how they play and how they've done, from every analyzed game
 * they were in, the user's record with them, and the user's note on them. The details sit in
 * sections that open on a click.
 */
export function PlayerDialog({ name, race, live, onCancel, close }: PlayerDialogProps) {
  return live ? (
    <LivePlayerDialog
      gameId={live.gameId}
      personKey={live.personKey}
      onCancel={onCancel}
      close={close}
    />
  ) : (
    <NamedPlayerDialog name={name} race={race} onCancel={onCancel} close={close} />
  )
}
