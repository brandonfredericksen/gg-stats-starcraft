import { TFunction } from 'i18next'
import { useAtomValue } from 'jotai'
import * as m from 'motion/react-m'
import * as React from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'

import { getMapDisplayName } from '../../common/games/map-family'
import { LiveGame, LiveGamePlayer, LiveMatchFound } from '../../common/live-game'
import { Playstyle } from '../../common/my-stats/playstyle'
import { AssignedRaceChar, RaceChar } from '../../common/races'
import { getBuildFamilyName } from '../builds/build-shared'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { useIsDocumentVisible } from '../dom/document-visibility'
import { useStatFormat } from '../games/game-stats-shared'
import { MapArt, useMapArt } from '../games/map-art'
import { useMyPlayerNames } from '../games/my-player-names'
import { relativeTimeFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { panelSurface } from '../material/panel'
import { RaceMix } from '../material/race-mix'
import { RaceTag } from '../material/race-tag'
import { SkeletonText } from '../material/skeleton'
import { Tooltip } from '../material/tooltip'
import { getShapeLabel, getWinRate, Muted, RecordText } from '../my-stats/my-stats-panels'
import { Badge, Header, Message, Root, Title } from '../my-stats/page-layout'
import {
  bahnschriftCapCentered,
  DivisionIcon,
  DivisionName,
  getDivisionLabel,
  getDivisionTier,
  LeagueTag,
  SourceTag,
} from '../players/rank-tags'
import { useCurrentMinuteMs } from '../react/date-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSettings } from '../settings/action-creators'
import { AppSettingsPage } from '../settings/settings-page'
import { getRaceColor } from '../styles/colors'
import {
  bahnschrift,
  bodyMedium,
  headlineMedium,
  labelMedium,
  labelSmall,
  singleLine,
  titleLarge,
  titleMedium,
  titleSmall,
} from '../styles/typography'
import { openLastGame } from '../system-bar/last-game'
import { liveGameAtom } from './live-game-atoms'
import { ScoutState, useScouts } from './live-game-data'
import {
  BuildScope,
  GameKind,
  getCheeseRate,
  getEnemyRaces,
  getGameKind,
  getKindRecord,
  getPlaystyle,
  getTeams,
  getUsualBuilds,
} from './live-game-summary'
import { getPersonKey, getPlaystyleLabel, Person, usePeople } from './live-player-details'

const TIME_AGO_FORMAT = relativeTimeFormat({ numeric: 'auto' })

/**
 * A tile's height with everything in it: its rows, the gaps between them and the same padding
 * above and below. Tiles never grow past it, so nothing floats in them.
 */
const FULL_TILE_HEIGHT = 160
/** A win rate shows from this many games with a result. Fewer is a coin flip, not a rate. */
const MIN_RATE_GAMES = 5
/** The stat columns, the same in every tile, so each stat sits under the one above it. */
const STAT_COLUMNS =
  'minmax(112px, 1fr) minmax(76px, 0.8fr) minmax(124px, 1fr) minmax(132px, 1.3fr) minmax(0, 1fr)'

/**
 * Centers a Bahnschrift capital in a small badge by the capital's own height, not the font's. That
 * still leaves it a little high, which the top padding lowers it by, measured at 4x.
 */
/**
 * The page fills the window and no more, so everyone in the game shows at once, without scrolling,
 * on a second monitor. In a narrow window, where the sides stack, it scrolls instead.
 */
const LiveRoot = styled(Root)`
  position: relative;
  /* Keeps the map's art above the page's background. */
  isolation: isolate;
  max-width: 1600px;
  height: 100%;
  min-height: 0;
  padding-bottom: var(--space-6);

  @container page (width < 820px) {
    height: auto;
  }
`

/**
 * The map behind everything, like a loading screen's, faint enough that the tiles read over it and
 * fading out at the edges.
 */
const MapBackdrop = styled.div<{ $art: MapArt }>`
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;

  background: url('${props => props.$art.url}')
    ${props => (props.$art.isMap ? 'center / cover' : 'center / 720px')};
  opacity: 0.16;
  mask-image: radial-gradient(ellipse at center, black 40%, transparent 75%);
`

/** The kind of game, the map and the races, on their own line under the title. */
const GameInfo = styled.div`
  margin-top: calc(var(--space-2) * -1);
  display: flex;
  align-items: center;
  gap: var(--space-3);
`

const GameLine = styled.span`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

/** Each side's races, like PZR vs TPZ, the matchup at a glance. */
const RaceComp = styled.span`
  ${labelMedium};
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--theme-on-surface-variant);
  font-weight: 700;
`

const RaceCompVs = styled.span`
  margin: 0 var(--space-2);
`

/** Pushes what follows it to the far end of the header. */
const HeaderEnd = styled.div`
  margin-left: auto;
`

const NamesStrip = styled.div`
  ${bodyMedium};
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--theme-on-surface-variant);
`

/**
 * Two sides with the VS between them, or for any other count of sides, like a free for all or a
 * game whose teams aren't known yet, everyone in two columns. Side by side in a wide window, one
 * above the other in a narrow one.
 */
const Versus = styled.div<{ $sides: number }>`
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  align-items: stretch;
  gap: var(--space-4);
  grid-template-columns: ${props =>
    props.$sides === 2 ? 'minmax(0, 1fr) 56px minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)'};

  @container page (width < 820px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

/** The VS's column has the sides' rows, so the VS sits level with the middle of the tiles. */
const VsColumn = styled.div<{ $rows: number }>`
  min-height: 0;
  display: grid;
  grid-template-rows: auto repeat(${props => props.$rows}, minmax(0, ${FULL_TILE_HEIGHT}px));
  align-content: start;
  gap: var(--space-2);

  @container page (width < 820px) {
    display: none;
  }
`

const VsMark = styled.div`
  ${headlineMedium};
  grid-row: 2 / -1;
  align-self: center;
  text-align: center;
  color: var(--theme-on-surface);
`

/** Tiles get the height there is, from a full tile's to a tall one's, so a 4v4 fits a short window. */
const Side = styled.section<{ $rows: number }>`
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto repeat(${props => props.$rows}, minmax(0, ${FULL_TILE_HEIGHT}px));
  align-content: start;
  gap: var(--space-2);
`

const SideLabel = styled.h2`
  ${titleSmall};
  margin: 0;
  color: var(--theme-on-surface-variant);
`

/**
 * One player. Every tile on a side is the same height, so the rows line up across the VS. It's a
 * size container, so what's in it can go by its height.
 */
/**
 * The eSkill ranks whose tiles get a touch of their league's color, more for each rank up: an edge
 * catching the light from the top left, then from both corners with a glow, like a trophy's rim.
 */
type Flair = 'b' | 'a' | 's'

const FLAIR_EDGES: Record<Flair, string> = {
  b: `linear-gradient(
    135deg,
    rgb(from var(--theme-league-b) r g b / 0.6),
    transparent 30%
  )`,
  a: `linear-gradient(
    135deg,
    var(--theme-league-a),
    rgb(from var(--theme-league-a) r g b / 0.3) 35%,
    transparent 60%
  )`,
  s: `linear-gradient(
    135deg,
    var(--theme-league-s),
    rgb(from var(--theme-league-s) r g b / 0.3) 35%,
    transparent 55%,
    transparent 70%,
    rgb(from var(--theme-league-s) r g b / 0.5)
  )`,
}

function getFlair(scout: ScoutState): Flair | undefined {
  const rank = scout !== 'loading' && scout !== 'error' ? scout.totals.eSkill?.rank : undefined
  return rank === 's' || rank === 'a' || rank === 'b' ? rank : undefined
}

const Tile = styled(m.button)<{ $me: boolean; $flair?: Flair }>`
  ${buttonReset};
  ${panelSurface};
  /* The flair's edge draws over the border, outside what the reset would clip. */
  overflow: visible;
  container-type: size;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
  color: var(--theme-on-surface);
  text-align: left;

  ${props =>
    props.$me &&
    css`
      border-color: var(--theme-outline);
    `}

  &::after {
    position: absolute;
    inset: 0;
    content: '';
    pointer-events: none;
    border-radius: inherit;
  }

  ${props =>
    props.$flair &&
    css`
      &::before {
        position: absolute;
        inset: -1px;
        content: '';
        pointer-events: none;
        padding: 1px;
        border-radius: inherit;
        background: ${FLAIR_EDGES[props.$flair]};
        /* Only the ring the border takes up. */
        mask:
          linear-gradient(#000 0 0) content-box,
          linear-gradient(#000 0 0);
        mask-composite: exclude;
      }
    `}

  &:hover::after {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.04);
  }

  &:active::after {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.1);
  }
`

/**
 * What's in a tile. Shorter than a full tile, it tightens up before anything is left out, and the
 * usual build is the last to go: it says most about what a player is about to do.
 */
const TileBody = styled.span<{ $noGames: boolean; $glow: boolean }>`
  height: 100%;
  padding: 0 var(--space-4);
  border-radius: inherit;
  /* An S rank's tile is lit faintly gold from behind the race. */
  background: ${props =>
    props.$glow
      ? 'radial-gradient(circle at 38px 50%, rgb(from var(--theme-league-s) r g b / 0.1), transparent 160px)'
      : 'none'};

  /*
   * Every tile has the same rows at the same heights, the build's too when it's empty, and they
   * sit in the middle: the space above and below is always even, and names line up across the VS.
   */
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  grid-template-rows: 44px 24px 24px;
  align-content: center;
  column-gap: var(--space-3);
  row-gap: var(--space-3);

  @container (height < ${FULL_TILE_HEIGHT}px) {
    grid-template-rows: 44px 24px 20px;
    row-gap: var(--space-2);
  }

  @container (height < 112px) {
    grid-template-columns: 32px minmax(0, 1fr);
    grid-template-rows: 32px 24px 20px;
    row-gap: var(--space-1);
  }

  @container (height < 88px) {
    grid-template-rows: 32px 24px;
  }

  /* With nothing known about them, it's their name and a note, still in the middle. */
  ${props =>
    props.$noGames &&
    css`
      && {
        grid-template-rows: 44px auto;
      }

      @container (height < 112px) {
        && {
          grid-template-rows: 32px auto;
        }
      }
    `}
`

/** The race they picked, the biggest thing on the tile after the name. */
const RaceBlock = styled.span<{ $color: string }>`
  ${titleLarge};
  ${bahnschrift};
  width: 100%;
  height: 100%;

  display: flex;
  align-items: center;
  justify-content: center;

  background-color: rgb(from ${props => props.$color} r g b / 0.24);
  border-radius: var(--radius-md);
  color: ${props => props.$color};
  font-size: 24px;
  ${bahnschriftCapCentered};
  /* At this size its capitals need more, measured at 4x. */
  padding-top: 2px;

  @container (height < 112px) {
    font-size: 18px;
  }
`

const UnknownRace = styled(RaceBlock)`
  background-color: var(--theme-container-high);
`

const NameRow = styled.span`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
`

const Name = styled.span`
  ${titleLarge};
  ${bahnschrift};
  ${singleLine};
  min-width: 0;

  @container (height < 112px) {
    font-size: 18px;
  }
`

const Rating = styled.span`
  ${titleMedium};
  ${bahnschrift};
  margin-left: auto;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-variant-numeric: tabular-nums;
`

const Division = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

/** A season's wins and losses next to the rating, smaller than it. */
const RatingRecord = styled.span`
  ${labelMedium};
  cursor: help;
`

const StatsRow = styled.span`
  grid-column: 1 / -1;
  min-width: 0;
  display: grid;
  grid-template-columns: ${STAT_COLUMNS};
  column-gap: var(--space-3);
  align-items: center;
`

/** A stat with its label before it, read as one: eAPM 205. */
const Stat = styled.span`
  min-width: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
`

const StatLabel = styled.span`
  ${labelMedium};
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

/** In the labels' face, a size up and bold, so a stat reads as one with its label. */
const StatValue = styled.span`
  ${titleSmall};
  ${singleLine};
  font-weight: 700;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-variant-numeric: tabular-nums;
`

const StatsNote = styled.span`
  ${bodyMedium};
  grid-column: 1 / -1;
  color: var(--theme-on-surface-variant);
`

/** A label that explains itself on hover, underlined like the app's other metric names. */
const HintLabel = styled(StatLabel)`
  text-decoration: underline dotted;
  text-underline-offset: 3px;
  cursor: help;
`

const Dim = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const PLAYSTYLE_ICONS: Record<Playstyle, string> = {
  standard: 'check',
  cheese: 'bolt',
  staticDefense: 'shield',
  tech: 'science',
  greedy: 'savings',
  offMeta: 'explore',
}

/**
 * A way of playing worth knowing about before the game. Neutral, like the best value pill: color
 * on this page means race. Standard play gets no chip, so one stands out.
 */
const StyleChip = styled.span`
  ${labelMedium};
  ${singleLine};
  justify-self: start;
  max-width: 100%;
  height: 24px;
  padding: 0 var(--space-3) 0 var(--space-2);

  display: inline-flex;
  align-items: center;
  gap: var(--space-1);

  background-color: var(--theme-container-highest);
  border-radius: var(--radius-full);
  color: var(--theme-on-surface);
  font-weight: 700;
`

const BuildRow = styled.span`
  ${bodyMedium};
  grid-column: 1 / -1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  white-space: nowrap;

  /* At the bottom of its row, which is taller at full size: a little apart from the stats. */
  align-self: end;

  @container (height < 88px) {
    display: none;
  }
`

const BuildScopeLabel = styled.span`
  ${labelSmall};
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

const Builds = styled.span`
  ${singleLine};
  min-width: 0;
`

const BuildName = styled.span`
  font-weight: 600;
`

const RaceBuild = styled.span`
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  overflow: hidden;
`

const Watching = styled.div`
  ${bodyMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

function getSourceLabel(game: LiveGame, t: TFunction) {
  return game.source === 'ladder' ? t('liveGame.source.ladder', 'Ladder') : 'ShieldBattery'
}

/**
 * A side's name: the user's and the other one, or with the user not playing, Team 1 and Team 2.
 */
function getSideLabel(side: Person[], index: number, userPlaying: boolean, t: TFunction) {
  if (!userPlaying) {
    return t('liveGame.side.team', 'Team {{number}}', { number: index + 1 })
  }
  if (side.some(p => p.isMe)) {
    return side.length === 1
      ? t('liveGame.side.you', 'You')
      : t('liveGame.side.yourTeam', 'Your team')
  }
  return side.length === 1
    ? t('liveGame.side.opponent', 'Opponent')
    : t('liveGame.side.opponents', 'Opponents')
}

function getScopeLabel(
  scope: BuildScope,
  enemyRaces: ReadonlyArray<string>,
  games: number,
  t: TFunction,
) {
  switch (scope) {
    case 'matchup':
      return t('liveGame.buildScope.matchup', 'Vs {{races}}', {
        races: [...enemyRaces].sort().join('').toUpperCase(),
      })
    case 'kind':
      return t('liveGame.buildScope.kind', 'Usually')
    case 'race':
      return t('liveGame.buildScope.otherModesGames', {
        defaultValue: '{{count}} games, other modes',
        defaultValue_one: '1 game, other modes',
        count: games,
      })
    default:
      return scope satisfies never
  }
}

/** Their rating: on ShieldBattery, their matchmaking rating, on the ladder, this season's MMR. */
export function TileRating({ player }: { player: LiveGamePlayer }) {
  const { t } = useTranslation()
  const { shieldBattery, ladder } = player
  if (shieldBattery) {
    const division = shieldBattery.division
      ? getDivisionLabel(shieldBattery.division, t)
      : undefined
    return (
      <Rating>
        <Tooltip
          text={t(
            'liveGame.shieldBatteryRatingHelp',
            'ShieldBattery: their matchmaking rating and division in this kind of game.',
          )}
          tabIndex={-1}
          position='top'>
          <SourceTag $source='shieldBattery'>{t('liveGame.shieldBatteryShort', 'SB')}</SourceTag>
        </Tooltip>
        {division ? (
          <>
            <DivisionIcon
              src={`ggstats://app/assets/ranks/${shieldBattery.division}.svg`}
              alt=''
              draggable={false}
            />
            <DivisionName $tier={getDivisionTier(shieldBattery.division!)!}>
              {division}
            </DivisionName>
          </>
        ) : null}
        {shieldBattery.rating}
        {shieldBattery.record ? (
          <Tooltip
            text={t(
              'liveGame.shieldBatteryRecordHelp',
              'Their wins and losses in {{mode}} this season, from their ShieldBattery profile.',
              { mode: shieldBattery.record.mode },
            )}
            tabIndex={-1}
            position='top'>
            <RatingRecord>
              <RecordText record={shieldBattery.record} />
            </RatingRecord>
          </Tooltip>
        ) : null}
      </Rating>
    )
  }
  if (ladder) {
    return (
      <Rating>
        <Tooltip
          text={t(
            'liveGame.battleNetRatingHelp',
            'Battle.net: their 1v1 ladder MMR and rank this season.',
          )}
          tabIndex={-1}
          position='top'>
          <SourceTag $source='battleNet'>{t('liveGame.battleNetShort', 'BNET')}</SourceTag>
        </Tooltip>
        {ladder.rank ? (
          <LeagueTag $rank={ladder.rank}>{ladder.rank.toUpperCase()}</LeagueTag>
        ) : null}
        {ladder.rating ?? <Division>{t('liveGame.unranked', 'Unranked')}</Division>}
      </Rating>
    )
  }
  return null
}

function TileStats({
  scout,
  race,
  kind,
  id,
}: {
  scout: ScoutState
  race: AssignedRaceChar | undefined
  kind: GameKind
  id: string
}) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const eapmLabel = (
    <Tooltip
      text={t(
        'liveGame.eapmHelp',
        'Effective actions per minute, averaged over their analyzed games. Like APM, without ' +
          'spam, like the same order clicked again right away.',
      )}
      tabIndex={-1}
      position='top'>
      <HintLabel>{t('liveGame.eapm', 'eAPM')}</HintLabel>
    </Tooltip>
  )
  const eSkillLabel = (
    <Tooltip
      text={t(
        'liveGame.eSkillHelp',
        'The 1v1 ladder MMR and rank of players who play the way they do: their speed, hotkeys ' +
          'and macro over their latest games. Nothing an opponent decides counts in it.',
      )}
      tabIndex={-1}
      position='top'>
      <HintLabel>{t('liveGame.eSkill', 'eSkill')}</HintLabel>
    </Tooltip>
  )
  const cheeseLabel = (
    <Tooltip
      text={t(
        'liveGame.cheeseHelp',
        'How many of their games with a named build were rushes and all ins, like a BBS, a 4 ' +
          'pool or a cannon rush. As this race in this kind of game when they have a few of those.',
      )}
      tabIndex={-1}
      position='top'>
      <HintLabel>{t('liveGame.cheese', 'Cheese')}</HintLabel>
    </Tooltip>
  )
  if (scout === 'loading') {
    return (
      <StatsRow id={id}>
        <Stat>
          {cheeseLabel}
          <SkeletonText $width='48px' />
        </Stat>
        <Stat>
          {eapmLabel}
          <SkeletonText $width='32px' />
        </Stat>
        <Stat>
          {eSkillLabel}
          <SkeletonText $width='48px' />
        </Stat>
        <Stat>
          <StatLabel>{t('liveGame.winLoss', 'W-L')}</StatLabel>
          <SkeletonText $width='56px' />
        </Stat>
      </StatsRow>
    )
  }
  if (scout === 'error' || !scout.totals.games) {
    return (
      <StatsNote id={id}>
        {scout === 'error'
          ? t('liveGame.scoutFailed', "Couldn't look up their games.")
          : t('liveGame.noAnalyzedGamesYet', 'No analyzed games with them yet.')}
      </StatsNote>
    )
  }
  const { totals } = scout
  const style = getPlaystyle(scout, race, kind)
  const cheese = getCheeseRate(scout, race, kind)
  const record = getKindRecord(scout, kind)
  const decided = record.wins + record.losses
  const winRate = decided >= MIN_RATE_GAMES ? getWinRate(record) : undefined
  return (
    <StatsRow id={id}>
      <Stat>
        {cheeseLabel}
        <StatValue>
          {cheese ? (
            <>
              {cheese.cheeser ? <MaterialIcon icon={PLAYSTYLE_ICONS.cheese} size={16} /> : null}
              {Math.round((cheese.cheese / cheese.games) * 100)}%
              <Dim>
                {cheese.cheese}/{cheese.games}
              </Dim>
            </>
          ) : (
            '-'
          )}
        </StatValue>
      </Stat>
      <Stat>
        {eapmLabel}
        <StatValue>{totals.eapm ? format.format(totals.eapm.value) : '-'}</StatValue>
      </Stat>
      <Stat>
        {eSkillLabel}
        <StatValue>
          {totals.eSkill ? format.format(totals.eSkill.value) : '-'}
          {totals.eSkill?.rank ? (
            <LeagueTag $rank={totals.eSkill.rank}>{totals.eSkill.rank.toUpperCase()}</LeagueTag>
          ) : null}
        </StatValue>
      </Stat>
      <Stat>
        <Tooltip
          text={
            record.allGames
              ? t(
                  'liveGame.winLossAllModesHelp',
                  "Wins and losses in all their analyzed games: they haven't played this kind " +
                    'of game yet.',
                )
              : t(
                  'liveGame.winLossKindHelp',
                  'Wins and losses in their analyzed games of this kind, on this kind of map.',
                )
          }
          tabIndex={-1}
          position='top'>
          <HintLabel>{t('liveGame.winLoss', 'W-L')}</HintLabel>
        </Tooltip>
        <StatValue>
          <RecordText record={record} />
          {winRate !== undefined ? <Dim>{Math.round(winRate * 100)}%</Dim> : null}
        </StatValue>
      </Stat>
      {style && style.style !== 'standard' && style.style !== 'cheese' ? (
        <StyleChip>
          <MaterialIcon icon={PLAYSTYLE_ICONS[style.style]} size={16} />
          {getPlaystyleLabel(style.style, t)}
          <Dim>
            {style.counts[style.style]}/{style.games}
          </Dim>
        </StyleChip>
      ) : null}
    </StatsRow>
  )
}

/**
 * The builds they go with most as the race they picked, against the races they're up against. For
 * random, or without the race, like on the ladder, the races they play and the top build of each.
 */
function TileBuild({
  scout,
  race,
  kind,
  enemyRaces,
}: {
  scout: ScoutState
  race: RaceChar | undefined
  kind: GameKind
  enemyRaces: AssignedRaceChar[]
}) {
  const { t } = useTranslation()
  if (scout === 'loading') {
    return (
      <BuildRow>
        <SkeletonText $width='180px' />
      </BuildRow>
    )
  }
  const noBuild = (
    <BuildRow>
      <Muted>{t('liveGame.noNamedBuild', 'No named build yet.')}</Muted>
    </BuildRow>
  )
  if (scout === 'error' || !scout.totals.games) {
    return null
  }
  if (race && race !== 'r') {
    const usual = getUsualBuilds(scout, race, kind, enemyRaces)
    if (!usual) {
      return noBuild
    }
    return (
      <BuildRow>
        <BuildScopeLabel>{getScopeLabel(usual.scope, enemyRaces, usual.of, t)}</BuildScopeLabel>
        <Builds>
          {usual.builds.map((build, i) => (
            <React.Fragment key={build.family}>
              {i > 0 ? <Muted> · </Muted> : null}
              <BuildName>{getBuildFamilyName(build.family, t)}</BuildName>{' '}
              <Muted>
                {build.games}/{usual.of}
              </Muted>
            </React.Fragment>
          ))}
        </Builds>
      </BuildRow>
    )
  }
  if (!scout.races.length) {
    return noBuild
  }
  return (
    <BuildRow>
      <RaceMix races={scout.races} />
      {scout.races.slice(0, 2).map(({ race: played }) => {
        const top = getUsualBuilds(scout, played, kind, enemyRaces)?.builds[0]
        return top ? (
          <RaceBuild key={played}>
            <RaceTag race={played} />
            <Builds>
              <BuildName>{getBuildFamilyName(top.family, t)}</BuildName>
            </Builds>
          </RaceBuild>
        ) : null
      })}
    </BuildRow>
  )
}

function PlayerTile({
  person,
  personKey,
  gameId,
  scout,
  kind,
  enemyRaces,
  index,
  from,
}: {
  person: Person
  personKey: string
  gameId: string
  scout: ScoutState
  kind: GameKind
  enemyRaces: AssignedRaceChar[]
  /** Where it is on its side, for coming in one after another. */
  index: number
  /** Which way it comes in from: its side of the VS. */
  from: -1 | 0 | 1
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const visible = useIsDocumentVisible()
  const nameId = useId()
  const statsId = useId()
  const { player, isMe } = person
  const race = player.race
  return (
    <Tile
      type='button'
      $me={isMe}
      $flair={getFlair(scout)}
      // With the window hidden, animation frames don't run: tiles show at once rather than wait.
      initial={visible ? { opacity: 0.3, x: from * 16 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', duration: 0.3, bounce: 0, delay: index * 0.04 }}
      aria-labelledby={nameId}
      aria-describedby={statsId}
      onClick={() =>
        dispatch(
          openDialog({
            type: DialogType.Player,
            initData: { name: player.name, race, live: { gameId, personKey } },
          }),
        )
      }>
      <TileBody
        $glow={getFlair(scout) === 's'}
        $noGames={scout === 'error' || (scout !== 'loading' && !scout.totals.games)}>
        {race ? (
          <RaceBlock $color={getRaceColor(race)}>{race.toUpperCase()}</RaceBlock>
        ) : (
          <UnknownRace $color='var(--theme-on-surface-variant)'>?</UnknownRace>
        )}
        <NameRow>
          <Name id={nameId}>{player.name}</Name>
          {isMe ? <Badge>{t('liveGame.you', 'You')}</Badge> : null}
          <TileRating player={person.player} />
        </NameRow>
        <TileStats
          scout={scout}
          race={race && race !== 'r' ? race : undefined}
          kind={kind}
          id={statsId}
        />
        <TileBuild scout={scout} race={race} kind={kind} enemyRaces={enemyRaces} />
      </TileBody>
    </Tile>
  )
}

/** The picked races of everyone on a side, random ones as R. */
function SideRaces({ side }: { side: Person[] }) {
  return (
    <>{side.map((p, i) => (p.player.race ? <RaceTag key={i} race={p.player.race} /> : null))}</>
  )
}

/** Rounds down to the minute, to say how long ago something was in whole minutes. */
function toMinute(ms: number) {
  return ms - (ms % 60_000)
}

/** How long ago the user joined, on its own so the minute ticking over redraws only this. */
function Joined({ noticedMs }: { noticedMs: number }) {
  const { t } = useTranslation()
  const nowMs = useCurrentMinuteMs()
  const format = useFormat(TIME_AGO_FORMAT)
  const when = format.format(Math.min(toMinute(noticedMs), nowMs), nowMs)
  return <Muted>{t('liveGame.joined', 'Joined {{when}}', { when })}</Muted>
}

function LiveGameView({ game }: { game: LiveGame }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const people = usePeople(game)
  const scouts = useScouts(people.map(p => p.accounts))
  const sides = getTeams(people, game)
  const kind = getGameKind(sides, game)
  const userPlaying = people.some(p => p.isMe && !p.player.observer)
  const watching = people.filter(p => p.player.observer)
  const keyOf = (person: Person) => getPersonKey(person, people.indexOf(person), people)
  // Who the players opened during a match are playing with isn't known until it loads.
  const versus = !game.matchFound && sides.length === 2
  const art = useMapArt(game.mapName ?? '', game.tileset)
  const gameLine = [
    (versus || game.matchFound) && kind.shape !== 'other'
      ? getShapeLabel(kind.shape, t)
      : undefined,
    game.mapName ? getMapDisplayName(game.mapName) : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  // Every side has as many rows as the biggest, so tiles are the same height across the VS.
  const rows = versus ? Math.max(...sides.map(side => side.length)) : 0

  const renderTile = (person: Person, side: Person[], index: number, from: -1 | 0 | 1) => (
    <PlayerTile
      key={keyOf(person)}
      person={person}
      personKey={keyOf(person)}
      gameId={game.id}
      scout={scouts(person.accounts)}
      kind={kind}
      enemyRaces={getEnemyRaces(sides, side)}
      index={index}
      from={from}
    />
  )

  const renderSide = (side: Person[], sideIndex: number) => (
    <Side key={sideIndex} $rows={rows} aria-label={getSideLabel(side, sideIndex, userPlaying, t)}>
      <SideLabel>{getSideLabel(side, sideIndex, userPlaying, t)}</SideLabel>
      {side.map((person, i) => renderTile(person, side, i, sideIndex === 0 ? -1 : 1))}
    </Side>
  )

  /** Everyone without sides, two to a row, in the game's order. */
  const renderAll = () => {
    const playing = sides.flat()
    const half = Math.ceil(playing.length / 2)
    const columns = [playing.slice(0, half), playing.slice(half)]
    return columns.map((column, c) => (
      <Side key={c} $rows={half}>
        <span />
        {column.map((person, i) =>
          renderTile(person, sides.find(s => s.includes(person)) ?? [person], i, 0),
        )}
      </Side>
    ))
  }

  return (
    <LiveRoot>
      {art ? <MapBackdrop $art={art} aria-hidden={true} /> : null}
      <Header>
        <Title>{t('liveGame.title', 'Live game')}</Title>
        <Badge>{getSourceLabel(game, t)}</Badge>
        <Joined noticedMs={game.noticedMs} />
        <HeaderEnd>
          <TextButton
            label={t('matchStats.lastGame', "Last game's stats")}
            onClick={() => dispatch(openLastGame())}
          />
        </HeaderEnd>
      </Header>
      {gameLine || versus ? (
        <GameInfo>
          {gameLine ? <GameLine>{gameLine}</GameLine> : null}
          {versus && people.some(p => p.player.race) ? (
            <RaceComp>
              <SideRaces side={sides[0]} />
              <RaceCompVs>{t('liveGame.vsShort', 'vs')}</RaceCompVs>
              <SideRaces side={sides[1]} />
            </RaceComp>
          ) : null}
        </GameInfo>
      ) : null}
      <MyNamesStrip />
      {game.matchFound ? (
        <MatchFoundMessage match={game.matchFound} opened={people.length > 0} />
      ) : null}
      {sides.length ? (
        <Versus $sides={versus ? 2 : 1}>
          {versus ? (
            <>
              {renderSide(sides[0], 0)}
              <VsColumn $rows={rows} aria-hidden={true}>
                <span />
                <VsMark>{t('liveGame.vs', 'VS')}</VsMark>
              </VsColumn>
              {renderSide(sides[1], 1)}
            </>
          ) : (
            renderAll()
          )}
        </Versus>
      ) : null}
      {!sides.length && !game.matchFound ? (
        <Message>
          <Muted>{t('liveGame.waitingForPlayers', "Waiting to see who's in the game.")}</Muted>
        </Message>
      ) : null}
      {watching.length ? (
        <Watching>
          {t('liveGame.watching', {
            defaultValue: '{{count}} watching: {{names}}',
            count: watching.length,
            names: watching.map(p => p.player.name).join(', '),
          })}
        </Watching>
      ) : null}
    </LiveRoot>
  )
}

const MatchFoundTitle = styled.div`
  ${titleMedium};
  color: var(--theme-on-surface);
`

/**
 * Where a ShieldBattery match is before its game loads, which is when its players are known. Until
 * then, only the players the user opens in ShieldBattery show, under this.
 */
function MatchFoundMessage({ match, opened }: { match: LiveMatchFound; opened: boolean }) {
  const { t } = useTranslation()
  let title: string
  switch (match.phase) {
    case 'accepting':
      title = t('liveGame.matchFound.accepting', {
        defaultValue: 'Match found. {{accepted}} of {{count}} accepted.',
        accepted: match.accepted,
        count: match.playerCount,
      })
      break
    case 'drafting':
      title = t('liveGame.matchFound.drafting', 'Match found. Picking races.')
      break
    case 'starting':
      title = t('liveGame.matchFound.starting', 'Match found. Starting the game.')
      break
  }
  let hint: string
  if (match.phase === 'drafting') {
    hint = opened
      ? t(
          'liveGame.matchFound.draftOpened',
          'The players you clicked in the draft. Click the others to see them too.',
        )
      : t(
          'liveGame.matchFound.draftNames',
          "Click a player's name in the draft to see them here. Everyone shows once the game " +
            'loads.',
        )
  } else {
    hint = opened
      ? t(
          'liveGame.matchFound.opened',
          "The players you've opened in ShieldBattery. Everyone shows once the game loads.",
        )
      : t(
          'liveGame.matchFound.names',
          "ShieldBattery doesn't say who's in the match until the game loads. Once you're in " +
            "the draft, click a player's name to see them here.",
        )
  }
  return (
    <Message>
      <MatchFoundTitle>{title}</MatchFoundTitle>
      <Muted>{hint}</Muted>
    </Message>
  )
}

/** Asks for the user's names, without taking room from the players. */
function MyNamesStrip() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const myNames = useMyPlayerNames()
  if (!myNames || myNames.length) {
    return null
  }
  return (
    <NamesStrip>
      {t('liveGame.needsNames', 'Add your names to see which player is you.')}
      <TextButton
        label={t('liveGame.setNames', 'Set your names')}
        onClick={() => dispatch(openSettings(AppSettingsPage.PlayerNames))}
      />
    </NamesStrip>
  )
}

export function LiveGamePage() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const game = useAtomValue(liveGameAtom)
  const enabled = useAppSelector(s => s.settings.local.liveGame) !== false

  if (game) {
    // Keyed by the game, so each game comes in once and an update to it doesn't replay that.
    return <LiveGameView key={game.id} game={game} />
  }
  return (
    <Root>
      <Header>
        <Title>{t('liveGame.title', 'Live game')}</Title>
      </Header>
      <Message>
        {enabled ? (
          <>
            <Muted>
              {t(
                'liveGame.empty',
                "You're not in a game. Join one on the ladder or on ShieldBattery to see who's " +
                  'in it.',
              )}
            </Muted>
            <div>
              <TextButton
                label={t('matchStats.lastGame', "Last game's stats")}
                onClick={() => dispatch(openLastGame())}
              />
            </div>
          </>
        ) : (
          <>
            <Muted>{t('liveGame.off', "Showing who's in the games you join is turned off.")}</Muted>
            <div>
              <TextButton
                label={t('liveGame.openSettings', 'Open settings')}
                onClick={() => dispatch(openSettings(AppSettingsPage.Replays))}
              />
            </div>
          </>
        )}
      </Message>
    </Root>
  )
}
