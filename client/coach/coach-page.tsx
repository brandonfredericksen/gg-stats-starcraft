import { TFunction } from 'i18next'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MapFamily } from '../../common/games/map-family'
import {
  COACH_METRIC_ORDER,
  COACH_MIN_POOL_GAMES,
  COACH_MIN_RESULT_GAMES,
  COACH_MIN_SCOPE_GAMES,
  COACH_MIN_USER_GAMES,
  COACH_WINDOW_GAMES,
  CoachBucket,
  CoachFinding,
  CoachResult,
  CoachResultFinding,
  CoachScope,
  CoachShortfall,
  CoachTiming,
  CoachWindow,
  EAPM_FLOORS,
} from '../../common/my-stats/coach'
import { isTeamGame } from '../../common/my-stats/player-games'
import { raceCharToLabel } from '../../common/races'
import { useObservedDimensions } from '../dom/dimension-hooks'
import { GameIcon } from '../games/game-icon'
import { SectionErrorBoundary } from '../games/game-stats-shared'
import { MaterialIcon } from '../icons/material/material-icon'
import { OutlinedButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { RaceTag } from '../material/race-tag'
import { Segmented, SegmentMenu, SegmentOption } from '../material/segmented'
import { Tooltip } from '../material/tooltip'
import { AnalyzeMine } from '../my-stats/analyze-mine'
import { useDemoPlayer, useStatsPlayerNames } from '../my-stats/demo-player'
import { MyStatsFilters, myStatsFiltersAtom } from '../my-stats/my-stats-data'
import {
  formatPercent,
  HelpLabel,
  PaddedPanel,
  PanelHead,
  PanelHeadNote,
  PanelTitle,
} from '../my-stats/my-stats-panels'
import { getPoolSource, getScriptedNote } from '../my-stats/pool-source'
import { RankMenu } from '../my-stats/rank-menu'
import { PageLoadingIndicator } from '../progress/page-loading'
import { STUCK_EDGE_PX, stuckEdgeGradient, useStuckBarBottom } from '../stuck-bar-edge'
import {
  bodyMedium,
  headlineMedium,
  labelLarge,
  labelSmall,
  titleMedium,
  titleSmall,
} from '../styles/typography'
import { OwnGamesNeeded, useNewestOwnGame } from '../system-bar/own-games-needed'
import {
  coachLockedShapeAtom,
  coachMapAtom,
  coachScopeAtom,
  coachWindowAtom,
  ShapeCount,
  useCoach,
  useShapeCounts,
} from './coach-data'
import { CoachNotes, GoalNumber, NextGame } from './coach-plan'
import {
  Cell,
  Columns,
  formatGameTime,
  formatTimeDiff,
  getBuildName,
  getMapFamilyShortName,
  getMetricGroup,
  getMetricText,
  getScopeName,
  GroupHead,
  HeadCell,
  MetricGroup,
  Table,
  Text,
  Tone,
  toneColor,
  useFormatValue,
} from './coach-shared'

/** The page, as a container so its sections can stack in a narrow window. */
export const Root = styled.div`
  container: coach / inline-size;
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-8) 48px;

  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`

export const Header = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-3);
`

export const Title = styled.h1`
  ${headlineMedium};
  margin: 0;
`

export const Badge = styled.span`
  ${labelSmall};
  height: 20px;
  padding: 0 var(--space-2);

  display: inline-flex;
  align-items: center;

  border: 1px solid var(--theme-outline-strong);
  border-radius: var(--radius-full);
  color: var(--theme-on-surface-variant);
  font-weight: 700;
`

/**
 * The kind of game to coach, which games, and who to compare with. Stays in view while the page
 * scrolls, like My stats' filters.
 */
const Toolbar = styled.div<{ $stuck: boolean }>`
  position: sticky;
  top: 0;
  z-index: 3;
  /* Out to the column's edges, so it covers all of what scrolls beneath it. */
  margin: calc(-1 * var(--space-3)) calc(-1 * var(--space-8));
  padding: var(--space-3) var(--space-8);

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);

  background-color: var(--theme-container-lowest);
  /*
   * An edge once the page scrolls under it, painted past the page's column out to the panel's
   * sides, which clip it, so it spans the panel however much wider than the column the window is.
   * The panel draws the rest of it, across its scrollbar.
   */
  border-image: ${props =>
    props.$stuck
      ? `${stuckEdgeGradient(`calc(100% - ${STUCK_EDGE_PX}px)`)} fill 0 / 0 / 0 100vw ${STUCK_EDGE_PX}px`
      : 'none'};
`

/**
 * Sits right above the bar: once it scrolls out of view, the bar is stuck. It takes none of the
 * page's gap, so the bar sits as far below what's above it as everything else.
 */
const StuckSentinel = styled.div`
  height: 1px;
  margin-bottom: calc(-1px - var(--space-4));
`

/** The race the user played, among the kinds of game of the picked game type. */
export const Races = styled.div<{ $dense?: boolean }>`
  flex-shrink: 0;
  padding: ${props => (props.$dense ? '2px' : '4px')};

  display: inline-flex;
  gap: 2px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-md);
  background-color: var(--theme-container-low);
`

export const RaceButton = styled.button<{ $on: boolean; $dense?: boolean }>`
  ${buttonReset};
  ${labelLarge};
  height: ${props => (props.$dense ? '26px' : '30px')};
  padding: 0 10px 0 6px;

  display: inline-flex;
  align-items: center;
  gap: 6px;

  border-radius: var(--radius-sm);
  background-color: ${props => (props.$on ? 'var(--theme-container-highest)' : 'transparent')};
  color: ${props => (props.$on ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)')};
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    color: var(--theme-on-surface);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 1px;
  }
`

const Spacer = styled.div`
  flex: 1;
`

/** A key number or date in a line of text, a little stronger than the words around it. */
const Key = styled.strong`
  color: var(--theme-on-surface);
  font-weight: 600;
`

/** Lines this long are as wide as reads comfortably. */
const About = styled(Text)`
  max-width: 80ch;
`

/** A title with a muted note after it on the same line. */
const TitleRace = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
`

/**
 * How the coach works, as a callout in the Coach tab's own color: open on the first visit, and
 * again when asked for. Its points sit side by side, each short enough to read at a glance.
 */
const Callout = styled.aside`
  position: relative;
  padding: var(--space-4) 48px var(--space-4) var(--space-4);

  display: flex;
  flex-direction: column;
  gap: var(--space-3);

  border: 1px solid var(--theme-tab-coach-ring);
  border-radius: var(--radius-md);
  background: var(--theme-tab-coach-tint);
`

const CalloutTop = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
`

const CalloutIcon = styled(MaterialIcon).attrs({ icon: 'lightbulb', size: 22 })`
  color: var(--theme-tab-coach);
`

const CalloutTitle = styled.h2`
  ${titleSmall};
  margin: 0;
`

/** The points across the callout, stacking once there's no room for three. */
const CalloutSteps = styled.ol`
  margin: 0;
  padding: 0;
  list-style: none;

  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3) var(--space-6);

  @container coach (width < 720px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const CalloutStep = styled.li`
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
`

const CalloutStepTitle = styled.span`
  ${labelLarge};
  color: var(--theme-tab-coach);
  font-weight: 600;
`

/** Lighter than plain muted text, so it reads as part of the callout's color. */
const CalloutStepText = styled.span`
  ${bodyMedium};
  color: color-mix(in srgb, var(--theme-tab-coach) 25%, var(--theme-on-surface));
`

const CalloutClose = styled.button`
  ${buttonReset};
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  width: 28px;
  height: 28px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: var(--radius-full);
  color: var(--theme-on-surface-variant);
  cursor: pointer;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
    color: var(--theme-on-surface);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const HowItWorksButton = styled.button`
  ${buttonReset};
  ${labelLarge};
  margin-left: auto;
  color: var(--theme-on-surface-variant);
  text-decoration: underline dotted;
  text-underline-offset: 3px;
  cursor: pointer;

  &:hover {
    color: var(--theme-on-surface);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const ScopeRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
`

/** What the page looks at, as parts of one quiet line that wraps where it must. */
const ScopeParts = styled.div`
  ${bodyMedium};
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  color: var(--theme-on-surface-variant);
`

const ScopeDot = styled.span`
  color: var(--theme-outline);
`

/**
 * The goals beside the trends and strengths, which together come close to the goals' height. They
 * stack once there's no room for both.
 */
const PlanColumns = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;

  @container coach (width < 880px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const SideColumn = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`

/** Tabs over the comparison: everything against other players, wins against losses, timings. */
const CompareTabs = styled(Segmented)`
  align-self: flex-start;
` as typeof Segmented

const Bucket = styled.section`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);

  & + & {
    margin-top: var(--space-4);
  }
`

const BucketTitle = styled.h2`
  ${titleMedium};
  margin: 0;
`

const ComparePanel = styled(PaddedPanel)`
  gap: var(--space-4);
`

export const Message = styled(PaddedPanel)`
  gap: var(--space-3);
`

const Progress = styled.div`
  ${bodyMedium};
  display: grid;
  /* The same label width in every row, so the bars start and end together. */
  grid-template-columns: 180px minmax(0, 1fr) 100px;
  align-items: center;
  gap: var(--space-4);
`

const ProgressCount = styled.span`
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--theme-on-surface-variant);
`

const Track = styled.span`
  position: relative;
  height: 8px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--theme-container-highest);
`

const Fill = styled.span<{ $tone?: Tone }>`
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: var(--radius-full);
  background: ${props => toneColor(props.$tone)};
`

const UnlockActions = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-3);
`

/** Where the user's typical game falls among other players: the marker sits at their share. */
const Standing = styled.span`
  position: relative;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--theme-container-highest);
`

const StandingMarker = styled.span<{ $tone?: Tone }>`
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;

  z-index: 1;
  border: 2px solid var(--theme-container);
  border-radius: var(--radius-full);
  background: ${props => toneColor(props.$tone)};
`

const StandingMiddle = styled.span`
  position: absolute;
  top: -2px;
  bottom: -2px;
  left: 50%;
  width: 1px;
  background: var(--theme-outline);
`

/** A small version of the standing bar, for a table row. */
const MiniStanding = styled.span`
  height: 20px;
  vertical-align: top;

  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
`

const MiniTrack = styled(Standing)`
  width: 64px;
  height: 6px;
`

const MiniMarker = styled(StandingMarker)`
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border-width: 1.5px;
`

function getBucketTitle(bucket: CoachBucket, t: TFunction) {
  return bucket.mapFamily
    ? t('myStats.coach.onMaps', 'On {{maps}}', { maps: getBucketPlace(bucket, t) })
    : undefined
}

/** A few map names for a sentence, like "Python, Lost Temple and 3 more". */
function formatMapNames(names: ReadonlyArray<string>, t: TFunction) {
  if (names.length <= 2) {
    return names.join(t('myStats.coach.mapsAnd', ' and '))
  }
  return t('myStats.coach.mapsMore', '{{maps}} and {{count}} more', {
    maps: names.slice(0, 2).join(', '),
    count: names.length - 2,
  })
}

/** Where a group of games was played: the money map's name, or the maps themselves. */
function getBucketPlace(bucket: CoachBucket, t: TFunction) {
  switch (bucket.mapFamily) {
    case 'fastest':
      return t('myStats.coach.mapFastest', 'Fastest')
    case 'bgh':
      return t('myStats.coach.mapBgh', 'Big Game Hunters')
    default:
      return formatMapNames(bucket.mapNames, t)
  }
}

/** Which games the other players in a comparison come from, like "3v3 on BGH". */
export function getPoolPlace(bucket: CoachBucket, t: TFunction) {
  const place = getPoolGameType(bucket, t)
  return bucket.onMap
    ? t('myStats.coach.poolOnMap', '{{place}} on {{map}}', { place, map: bucket.onMap })
    : place
}

function getPoolGameType(bucket: CoachBucket, t: TFunction) {
  const shape = bucket.shape === 'ffa' ? t('myStats.ffa', 'FFA') : bucket.shape
  if (bucket.opponentRace) {
    return t('myStats.coach.poolVs', '{{shape}} against {{opponent}}', {
      shape,
      opponent: raceCharToLabel(bucket.opponentRace, t),
    })
  }
  if (bucket.allyRace && !bucket.anyAlly) {
    return t('myStats.coach.poolAlly', '{{shape}} with a {{ally}} ally', {
      shape,
      ally: raceCharToLabel(bucket.allyRace, t),
    })
  }
  if (bucket.mapFamily) {
    return t('myStats.coach.poolMap', '{{shape}} on {{map}}', {
      shape,
      map: getMapFamilyShortName(bucket.mapFamily, t),
    })
  }
  return t('myStats.coach.poolShape', '{{shape}}', { shape })
}

/** A day, like Jul 7, 2026. */
function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function isReady(bucket: CoachBucket) {
  return bucket.userGames >= COACH_MIN_USER_GAMES && bucket.poolGames >= COACH_MIN_POOL_GAMES
}

/** A game type and the kind of map, which the race picker then splits by race. */
function getModeKey(scope: Pick<CoachScope, 'shape' | 'mapFamily'>) {
  return `${scope.shape}:${scope.mapFamily ?? ''}`
}

function getShapeName(shape: CoachScope['shape'], t: TFunction) {
  return shape === 'ffa' ? t('myStats.ffa', 'FFA') : shape
}

function toQueryScope({ shape, race, opponentRace, allyRace, mapFamily }: CoachScope) {
  return { shape, race, opponentRace, allyRace, mapFamily }
}

/**
 * The game type to coach, and the game types in the user's replays with too few analyzed to coach
 * yet, each with how many of the user's replays of it are analyzed.
 */
function ShapeMenu({
  scopes,
  picked,
  counts,
}: {
  scopes: ReadonlyArray<CoachScope>
  picked: Omit<CoachScope, 'games'> | undefined
  counts: ReadonlyArray<ShapeCount>
}) {
  const { t } = useTranslation()
  const setScope = useSetAtom(coachScopeAtom)
  const setMap = useSetAtom(coachMapAtom)
  const [pickedLocked, setLocked] = useAtom(coachLockedShapeAtom)

  // Scopes come most played first, so the first of each game type is the one to open it on.
  const shapes = new Map<CoachScope['shape'], { first: CoachScope; games: number }>()
  for (const scope of scopes) {
    const shape = shapes.get(scope.shape)
    shapes.set(scope.shape, {
      first: shape?.first ?? scope,
      games: (shape?.games ?? 0) + scope.games,
    })
  }
  // A game type played on one kind of map only names it here, rather than in a picker of one.
  const nameOf = (shape: CoachScope['shape']) => {
    const families = new Set(scopes.filter(s => s.shape === shape).map(s => s.mapFamily))
    const [family] = families
    return families.size === 1 && family
      ? `${getShapeName(shape, t)} ${getMapFamilyShortName(family, t)}`
      : getShapeName(shape, t)
  }
  const analyzedText = (name: string, count: ShapeCount) =>
    t('myStats.coach.modeLocked', '{{name}}, {{analyzed}} of {{total}} analyzed', {
      name,
      analyzed: count.analyzed,
      total: count.total,
    })
  const locked = counts.filter(count => !shapes.has(count.shape))
  const options: Array<SegmentOption<string>> = [
    ...Array.from(shapes, ([shape, { games }]) => {
      const count = counts.find(c => c.shape === shape)
      return {
        value: shape,
        label: nameOf(shape),
        menuLabel: count
          ? analyzedText(nameOf(shape), count)
          : t('myStats.coach.modeGames', '{{name}}, {{count}} games', {
              name: nameOf(shape),
              count: games,
            }),
      }
    }),
    ...locked.map(count => ({
      value: `locked:${count.shape}`,
      label: getShapeName(count.shape, t),
      menuLabel: analyzedText(getShapeName(count.shape, t), count),
    })),
  ]
  if (!options.length) {
    return null
  }
  let value: string = picked?.shape ?? options[0].value
  const lockedShape =
    pickedLocked ?? (picked && !shapes.has(picked.shape) ? picked.shape : undefined)
  if (lockedShape && locked.some(count => count.shape === lockedShape)) {
    value = `locked:${lockedShape}`
  }

  return (
    <SegmentMenu
      label={t('myStats.coach.mode', 'Game type')}
      showLabel={false}
      options={options}
      value={value}
      onChange={key => {
        if (key.startsWith('locked:')) {
          setLocked(key.slice('locked:'.length) as ShapeCount['shape'])
          return
        }
        setLocked(undefined)
        setMap(undefined)
        setScope(toQueryScope(shapes.get(key as CoachScope['shape'])!.first))
      }}
    />
  )
}

/** The kind of map to coach, in a game type that splits by map. Keeps the race where it can. */
function MapPicker({
  scopes,
  picked,
}: {
  scopes: ReadonlyArray<CoachScope>
  picked: Omit<CoachScope, 'games'>
}) {
  const { t } = useTranslation()
  const setScope = useSetAtom(coachScopeAtom)
  if (!picked.mapFamily) {
    return null
  }
  const inShape = scopes.filter(scope => scope.shape === picked.shape && scope.mapFamily)
  const families = new Map<MapFamily, number>()
  for (const scope of inShape) {
    families.set(scope.mapFamily!, (families.get(scope.mapFamily!) ?? 0) + scope.games)
  }
  // With one kind of map, the game type's name already says which.
  if (families.size < 2) {
    return null
  }

  return (
    <SegmentMenu
      label={t('myStats.coach.map', 'Maps')}
      showLabel={false}
      options={Array.from(families, ([family, games]) => ({
        value: family,
        label: getMapFamilyShortName(family, t),
        menuLabel: t('myStats.coach.modeGames', '{{name}}, {{count}} games', {
          name: getMapFamilyShortName(family, t),
          count: games,
        }),
      }))}
      value={picked.mapFamily}
      onChange={family => {
        const onMap = inShape.filter(scope => scope.mapFamily === family)
        setScope(toQueryScope(onMap.find(scope => scope.race === picked.race) ?? onMap[0]))
      }}
    />
  )
}

/** One map to coach, in a game type that doesn't split by map, or all of them. */
function MapNameMenu({
  maps,
  picked,
}: {
  maps: ReadonlyArray<{ key: string; name: string; games: number }>
  picked: string | undefined
}) {
  const { t } = useTranslation()
  const setMap = useSetAtom(coachMapAtom)
  if (maps.length < 2 && !picked) {
    return null
  }
  const options: Array<SegmentOption<string>> = [
    { value: '', label: t('myStats.coach.allMaps', 'All maps') },
    ...maps.map(({ key, name, games }) => ({
      value: key,
      label: name,
      menuLabel: t('myStats.coach.modeGames', '{{name}}, {{count}} games', {
        name,
        count: games,
      }),
    })),
  ]
  // A map picked for another race can have none of this one's games, and still needs a name.
  if (picked && !maps.some(m => m.key === picked)) {
    options.push({ value: picked, label: picked })
  }

  return (
    <SegmentMenu
      label={t('myStats.coach.map', 'Maps')}
      showLabel={false}
      options={options}
      value={picked ?? ''}
      onChange={name => setMap(name || undefined)}
    />
  )
}

/** The race to coach within the picked game type, with the matchup or ally where it splits by one. */
function RacePicker({
  scopes,
  picked,
}: {
  scopes: ReadonlyArray<CoachScope>
  picked: Omit<CoachScope, 'games'>
}) {
  const { t } = useTranslation()
  const setScope = useSetAtom(coachScopeAtom)
  const inMode = scopes.filter(scope => getModeKey(scope) === getModeKey(picked))
  if (!inMode.length) {
    return null
  }

  const keyOf = (scope: Omit<CoachScope, 'games'>) =>
    `${scope.race}${scope.opponentRace ?? ''}${scope.allyRace ?? ''}`
  const options: Array<SegmentOption<string>> = inMode.map(scope => ({
    value: keyOf(scope),
    label: getScopeName(scope, t),
    menuDetail: t('myStats.coach.scopeGames', {
      defaultValue: '{{count}} games',
      defaultValue_one: '{{count}} game',
      count: scope.games,
    }),
    buttonContent: <ScopeTags scope={scope} />,
  }))
  return (
    <SegmentMenu
      label={t('myStats.coach.races', 'Your race')}
      showLabel={false}
      options={options}
      value={keyOf(picked)}
      onChange={key => {
        const scope = inMode.find(s => keyOf(s) === key)
        if (scope) {
          setScope(toQueryScope(scope))
        }
      }}
    />
  )
}

/** A kind of game's races as tags, like Z vs P, or P + T in 2v2. */
function ScopeTags({ scope }: { scope: Omit<CoachScope, 'games'> }) {
  const { t } = useTranslation()
  return (
    <ScopeTagsRoot>
      <RaceTag race={scope.race} />
      {scope.allyRace ? (
        <>
          +
          <RaceTag race={scope.allyRace} />
        </>
      ) : null}
      {scope.opponentRace ? (
        <>
          {t('myStats.vs', 'vs')}
          <RaceTag race={scope.opponentRace} />
        </>
      ) : null}
      {!scope.allyRace && !scope.opponentRace ? (
        <span>{raceCharToLabel(scope.race, t)}</span>
      ) : null}
    </ScopeTagsRoot>
  )
}

const ScopeTagsRoot = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--theme-on-surface-variant);
`

/**
 * What the coach is looking at, in one quiet line: the user's games, other players' games from the
 * same dates, and how many of the user's replays are analyzed, with a way to analyze more. Each part
 * explains itself when hovered.
 */
function ScopeLine({
  bucket,
  eapmFloor,
  sinceMs,
  window,
  autoGames,
  autoMonths,
  counts,
  others,
}: {
  bucket: CoachBucket
  eapmFloor: number
  sinceMs?: number
  window: CoachWindow
  autoGames: number
  autoMonths: boolean
  counts: ReadonlyArray<ShapeCount>
  /** The groups of games too small to show. */
  others?: string
}) {
  const { t } = useTranslation()
  const names = useStatsPlayerNames() ?? []
  const race = raceCharToLabel(bucket.race, t)
  const count = counts.find(c => c.shape === bucket.shape)

  let reach: string
  if (sinceMs === undefined) {
    reach = t('myStats.coach.scopeReachAll', 'Every one you have analyzed.')
  } else if (window === 'auto' && autoMonths) {
    reach = t('myStats.coach.scopeReachMonths', 'Back to {{date}}, your last 3 months.', {
      date: formatDate(sinceMs),
    })
  } else {
    reach = t('myStats.coach.scopeReachGames', 'Back to {{date}}, your last {{count}} games.', {
      date: formatDate(sinceMs),
      count: window === 'auto' || window === 'all' ? autoGames : window,
    })
  }
  const skipped = bucket.skippedGames
    ? t('myStats.coach.scopeSkipped', {
        defaultValue: '{{count}} more left out: someone quit in the first 5 minutes.',
        defaultValue_one: '{{count}} more left out: someone quit in the first 5 minutes.',
        count: bucket.skippedGames,
      })
    : ''
  const poolSource = getPoolSource(bucket.poolFromBaseline, bucket.poolGames, t)
  const theirs =
    sinceMs === undefined
      ? t(
          'myStats.coach.scopeTheirsHelpAll',
          '{{players}} players over {{floor}} EAPM {{source}}, up to 5 games each.',
          { players: bucket.poolPlayers, floor: eapmFloor, source: poolSource },
        )
      : t(
          'myStats.coach.scopeTheirsHelp',
          '{{players}} players over {{floor}} EAPM {{source}}, since the same date, up to 5 games each.',
          { players: bucket.poolPlayers, floor: eapmFloor, source: poolSource },
        )
  const rankOnly = bucket.rank
    ? t('myStats.rankOnly', 'Only players who were rank {{rank}} going into the game count.', {
        rank: bucket.rank.toUpperCase(),
      })
    : ''

  return (
    <ScopeRoot>
      <ScopeParts>
        <HelpLabel
          label={t('myStats.coach.scopeYours', {
            defaultValue: 'Your {{games}} {{race}} games in {{where}}',
            defaultValue_one: 'Your {{games}} {{race}} game in {{where}}',
            count: bucket.userGames,
            games: bucket.userGames.toLocaleString(),
            race,
            where: getPoolPlace(bucket, t),
          })}
          help={[reach, skipped].filter(Boolean).join(' ')}
        />
        <ScopeDot aria-hidden={true}>·</ScopeDot>
        <HelpLabel
          label={t('myStats.coach.scopeTheirs', {
            defaultValue: '{{games}} games from other {{race}} players',
            defaultValue_one: '{{games}} game from other {{race}} players',
            count: bucket.poolGames,
            games: bucket.poolGames.toLocaleString(),
            race,
          })}
          help={[theirs, rankOnly].filter(Boolean).join(' ')}
        />
        {count ? (
          <>
            <ScopeDot aria-hidden={true}>·</ScopeDot>
            <HelpLabel
              label={t(
                'myStats.coach.scopeAnalyzed',
                '{{analyzed}} of your {{total}} {{shape}} replays analyzed',
                {
                  analyzed: count.analyzed.toLocaleString(),
                  total: count.total.toLocaleString(),
                  shape: getShapeName(bucket.shape, t),
                },
              )}
              help={t(
                'myStats.coach.scopeAnalyzedHelp',
                'More analyzed means more of your games and more players to compare with.',
              )}
            />
            <AnalyzeMine
              names={names}
              filters={{ range: 'all', shape: bucket.shape }}
              compact={true}
            />
          </>
        ) : null}
      </ScopeParts>
      {others ? <Text>{others}</Text> : null}
    </ScopeRoot>
  )
}

/** A game type the coach can't look at yet: how many of its replays are analyzed, and a way on. */
export function LockedView({ locked }: { locked: ShapeCount }) {
  const { t } = useTranslation()
  const names = useStatsPlayerNames() ?? []
  const name = locked.shape === 'ffa' ? t('myStats.ffa', 'FFA') : locked.shape

  return (
    <PaddedPanel>
      <PanelHead>
        <PanelTitle>
          {t('myStats.coach.lockedTitle', 'Analyze more of your {{shape}} games to coach them', {
            shape: name,
          })}
        </PanelTitle>
      </PanelHead>
      <Progress>
        <span>{t('myStats.coach.lockedReplays', 'Your {{shape}} replays', { shape: name })}</span>
        <Track>
          <Fill style={{ width: `${(locked.analyzed / locked.total) * 100}%` }} />
        </Track>
        <ProgressCount>
          {t('myStats.coach.lockedCount', '{{analyzed}} of {{total}}', {
            analyzed: locked.analyzed,
            total: locked.total,
          })}
        </ProgressCount>
      </Progress>
      <Text>
        {t(
          'myStats.coach.lockedHow',
          'The coach looks at each race you play here once a few of those games are analyzed.',
        )}
      </Text>
      <UnlockActions>
        <AnalyzeMine names={names} filters={{ range: 'all', shape: locked.shape }} />
      </UnlockActions>
    </PaddedPanel>
  )
}

/**
 * A share of other players beaten under this, in whole percent, is colored as behind them, and
 * over `AHEAD_PERCENT` as ahead. Wider than what the coach points out, so a number leaning either
 * way already shows it.
 */
const BEHIND_PERCENT = 40
const AHEAD_PERCENT = 60

/** Where a number sits among other players, by the share as it's shown. */
function getStandingTone(beats: number): Tone | undefined {
  const percent = Math.round(beats * 100)
  if (percent < BEHIND_PERCENT) {
    return 'bad'
  }
  return percent > AHEAD_PERCENT ? 'good' : undefined
}

function ComparedGroup({
  title,
  rows,
  first,
  goalNumbers,
  compact = false,
}: {
  title: string
  rows: ReadonlyArray<CoachFinding | CoachShortfall>
  first: boolean
  /** Each goal's number, by the number it's about. */
  goalNumbers: ReadonlyMap<string, number>
  /** For a narrow column: the share without its bar. */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const formatValue = useFormatValue()
  return (
    <>
      <GroupHead $first={first}>{title}</GroupHead>
      <GroupHead $first={first} $end={true}>
        {t('myStats.coach.you', 'You')}
      </GroupHead>
      <GroupHead $first={first} $end={true}>
        {t('myStats.coach.them', 'Them')}
      </GroupHead>
      <GroupHead $first={first} $end={true}>
        {t('myStats.coach.betterThan', 'Better than')}
      </GroupHead>
      {rows.map(finding => {
        if (!('beats' in finding)) {
          return (
            <ShortRow
              key={finding.key}
              shortfall={finding}
              goalNumber={goalNumbers.get(finding.key)}
            />
          )
        }
        const [label, help] = getMetricText(finding.key, t)
        const tone = getStandingTone(finding.beats)
        return [
          <Cell key={`${finding.key}-label`}>
            <RowName>
              <RowGoalMark number={goalNumbers.get(finding.key)} />
              <HelpLabel
                quiet={true}
                label={label}
                help={`${help} ${t(
                  'myStats.coach.fromGames',
                  'From {{userGames}} of your games and {{poolGames}} of theirs.',
                  { userGames: finding.userGames, poolGames: finding.poolGames },
                )}`}
              />
            </RowName>
          </Cell>,
          <Cell key={`${finding.key}-you`} $end={true} $tone={tone}>
            {formatValue(finding.userValue, finding.unit)}
          </Cell>,
          <Cell key={`${finding.key}-them`} $end={true} $tone='muted'>
            {formatValue(finding.poolValue, finding.unit)}
          </Cell>,
          <Cell key={`${finding.key}-standing`} $end={true} $tone={tone ?? 'muted'}>
            <MiniStanding>
              {compact ? null : (
                <MiniTrack aria-hidden={true}>
                  <StandingMiddle />
                  <MiniMarker $tone={tone} style={{ left: `${finding.beats * 100}%` }} />
                </MiniTrack>
              )}
              {formatPercent(finding.beats)}
            </MiniStanding>
          </Cell>,
        ]
      })}
    </>
  )
}

/**
 * Every table shares these widths, so their columns line up across the panel and from one table
 * to the next. The last is wider, for the standing bar beside its share.
 */
const VALUE_COLUMN = '120px'
const LAST_COLUMN = '128px'
const TABLE_COLUMNS = `minmax(0, 1fr) ${VALUE_COLUMN} ${VALUE_COLUMN} ${LAST_COLUMN}`

const RowGoal = styled(GoalNumber)`
  width: 20px;
  height: 20px;
`

/** A goal's number in front of a table row, so the row a goal came from can be found. */
function RowGoalMark({ number }: { number: number | undefined }) {
  const { t } = useTranslation()
  if (number === undefined) {
    return null
  }
  return (
    <Tooltip
      position='top'
      text={t('myStats.coach.rowGoal', 'Your goal {{number}} comes from this number.', { number })}>
      <RowGoal>{number}</RowGoal>
    </Tooltip>
  )
}

/** A row's name with a goal's number in front of it, the name wrapping beside the number. */
const RowName = styled.span`
  display: inline-flex;
  align-items: flex-start;
  gap: var(--space-2);
`

/** A row's empty values, as one spot to hover that says why they're empty. */
const ShortValues = styled(Tooltip)`
  grid-column: span 3;
  display: grid;
  grid-template-columns: subgrid;
  cursor: help;
`

/** A number that means something here, greyed out until enough games have it to compare. */
function ShortRow({
  shortfall,
  goalNumber,
}: {
  shortfall: CoachShortfall
  goalNumber: number | undefined
}) {
  const { t } = useTranslation()
  const [label, help] = getMetricText(shortfall.key, t)
  const values = {
    userGames: shortfall.userGames,
    userNeeded: shortfall.userNeeded,
    poolGames: shortfall.poolGames,
    poolNeeded: shortfall.poolNeeded,
  }
  const userShort = shortfall.userGames < shortfall.userNeeded
  const poolShort = shortfall.poolGames < shortfall.poolNeeded
  let why: string
  if (userShort && poolShort) {
    why = t(
      'myStats.coach.shortBoth',
      'Too few games to compare yet. {{userGames}} of yours and {{poolGames}} of theirs have this number, and it needs {{userNeeded}} and {{poolNeeded}}.',
      values,
    )
  } else if (userShort) {
    why = t(
      'myStats.coach.shortUser',
      'Too few of your games to compare yet. {{userGames}} have this number, and it needs {{userNeeded}}.',
      values,
    )
  } else {
    why = t(
      'myStats.coach.shortPool',
      'Too few of their games to compare yet. {{poolGames}} have this number, and it needs {{poolNeeded}}.',
      values,
    )
  }
  return (
    <>
      <Cell $tone='muted'>
        <RowName>
          <RowGoalMark number={goalNumber} />
          <HelpLabel quiet={true} label={label} help={help} />
        </RowName>
      </Cell>
      <ShortValues position='top' text={why}>
        <Cell $end={true} $tone='muted'>
          -
        </Cell>
        <Cell $end={true} $tone='muted'>
          -
        </Cell>
        <Cell $end={true} $tone='muted'>
          -
        </Cell>
      </ShortValues>
    </>
  )
}

/**
 * Every number that means something here, grouped by what it's about: the ones the coach compared,
 * pointed out or not, and in their places, the ones too few games have yet.
 */
function ComparedTable({
  findings,
  uncompared,
  goalNumbers,
}: {
  findings: ReadonlyArray<CoachFinding>
  uncompared: ReadonlyArray<CoachShortfall>
  goalNumbers: ReadonlyMap<string, number>
}) {
  const { t } = useTranslation()
  const rows = [...findings, ...uncompared].sort(
    (a, b) => COACH_METRIC_ORDER.indexOf(a.key) - COACH_METRIC_ORDER.indexOf(b.key),
  )
  const titles: Record<MetricGroup, string> = {
    economy: t('myStats.coach.groupEconomy', 'Economy'),
    growth: t('myStats.coach.groupGrowth', 'Growth'),
    spending: t('myStats.coach.groupSpending', 'Spending'),
    fights: t('myStats.coach.groupFights', 'Fights'),
    speed: t('myStats.coach.groupSpeed', 'Speed'),
  }
  const sides: ReadonlyArray<ReadonlyArray<MetricGroup>> = [
    ['economy', 'growth', 'spending'],
    ['fights', 'speed'],
  ]
  return (
    <Columns>
      {sides.map(groups => (
        <Table key={groups.join()} $columns={TABLE_COLUMNS}>
          {groups
            .filter(group => rows.some(row => getMetricGroup(row.key) === group))
            .map((group, i) => (
              <ComparedGroup
                key={group}
                title={titles[group]}
                rows={rows.filter(row => getMetricGroup(row.key) === group)}
                first={i === 0}
                goalNumbers={goalNumbers}
              />
            ))}
        </Table>
      ))}
    </Columns>
  )
}

function LossesTable({
  findings,
  minute,
  goalNumbers,
}: {
  findings: ReadonlyArray<CoachResultFinding>
  /** The minute the numbers compared go up to. */
  minute: number
  goalNumbers: ReadonlyMap<string, number>
}) {
  const { t } = useTranslation()
  const formatValue = useFormatValue()
  return (
    <Table $columns={`minmax(0, 1fr) ${VALUE_COLUMN} ${VALUE_COLUMN} ${LAST_COLUMN}`}>
      <HeadCell>{t('myStats.coach.upToMinute', 'Up to {{minute}} min', { minute })}</HeadCell>
      <HeadCell $end={true}>{t('myStats.coach.inWinsHead', 'In wins')}</HeadCell>
      <HeadCell $end={true}>{t('myStats.coach.inLossesHead', 'In losses')}</HeadCell>
      <HeadCell $end={true}>{t('myStats.coach.differenceHead', 'Difference')}</HeadCell>
      {findings.map(finding => {
        const [label, help] = getMetricText(finding.key, t)
        return [
          <Cell key={`${finding.key}-label`}>
            <RowName>
              <RowGoalMark number={goalNumbers.get(finding.key)} />
              <HelpLabel quiet={true} label={label} help={help} />
            </RowName>
          </Cell>,
          <Cell key={`${finding.key}-wins`} $end={true}>
            {formatValue(finding.winValue, finding.unit)}
          </Cell>,
          <Cell
            key={`${finding.key}-losses`}
            $end={true}
            $tone={finding.notable ? 'bad' : undefined}>
            {formatValue(finding.lossValue, finding.unit)}
          </Cell>,
          <Cell key={`${finding.key}-diff`} $end={true} $tone='muted' $strong={finding.notable}>
            {formatDifference(finding.lossValue - finding.winValue, finding.unit, formatValue)}
          </Cell>,
        ]
      })}
    </Table>
  )
}

function TimingsTable({
  timings,
  goalNumbers,
}: {
  timings: ReadonlyArray<CoachTiming>
  goalNumbers: ReadonlyMap<string, number>
}) {
  const { t } = useTranslation()
  return (
    <Table $columns={TABLE_COLUMNS}>
      <HeadCell>{t('myStats.coach.build', 'Build')}</HeadCell>
      <HeadCell $end={true}>{t('myStats.coach.you', 'You')}</HeadCell>
      <HeadCell $end={true}>{t('myStats.coach.them', 'Them')}</HeadCell>
      <HeadCell $end={true}>{t('myStats.coach.difference', 'Difference')}</HeadCell>
      {timings.map(timing => {
        const { userMs, poolMs } = timing
        let difference = '-'
        if (userMs !== undefined && poolMs !== undefined) {
          const diffMs = userMs - poolMs
          const time = formatTimeDiff(Math.abs(diffMs), t)
          if (Math.round(Math.abs(diffMs) / 1000) === 0) {
            difference = t('myStats.coach.sameTime', 'Same')
          } else {
            difference =
              diffMs > 0
                ? t('myStats.coach.later', '{{time}} later', { time })
                : t('myStats.coach.earlier', '{{time}} earlier', { time })
          }
        }
        return [
          <Cell key={`${timing.buildKey}-name`}>
            <RowName>
              <RowGoalMark number={goalNumbers.get(timing.buildKey)} />
              <GameIcon buildKey={timing.buildKey} size={26} />
              {getBuildName(timing.buildKey, t)}
            </RowName>
          </Cell>,
          <Cell key={`${timing.buildKey}-you`} $end={true}>
            {userMs !== undefined ? formatGameTime(userMs) : '-'}
          </Cell>,
          <Cell key={`${timing.buildKey}-them`} $end={true} $tone='muted'>
            {poolMs !== undefined ? formatGameTime(poolMs) : '-'}
          </Cell>,
          <Cell key={`${timing.buildKey}-diff`} $end={true} $tone='muted' $strong={timing.notable}>
            {timing.quietBecause === 'oneSide' || timing.quietBecause === 'followsPlan' ? (
              <HelpLabel
                quiet={true}
                label={difference}
                help={
                  timing.quietBecause === 'oneSide'
                    ? t(
                        'myStats.coach.timingNotBoth',
                        'Only one side usually builds it, so the difference says more about the build than the timing.',
                      )
                    : t(
                        'myStats.coach.timingFollowsPlan',
                        'Upgrade and defense buildings go up when the plan or the opponent calls for them, so their timing says little on its own.',
                      )
                }
              />
            ) : (
              difference
            )}
          </Cell>,
        ]
      })}
    </Table>
  )
}

/** My stats' filters for a kind of game, which pick the same games of the user's. */
function toFilters(scope: Omit<CoachScope, 'games'>): MyStatsFilters {
  return {
    range: 'all',
    shape: scope.shape,
    race: scope.race,
    opponentRace: scope.opponentRace,
    mapFamily: scope.mapFamily,
  }
}

/** How far the user is from enough games to compare, with a way to get there. */
/**
 * What the coach needs before it can compare, with these filters: how many more of the user's
 * games, or of other players', and what would count more of them.
 */
function Unlock({
  bucket,
  eapmFloor,
  sinceMs,
}: {
  bucket: CoachBucket
  eapmFloor: number
  sinceMs?: number
}) {
  const { t } = useTranslation()
  const names = useStatsPlayerNames() ?? []
  const userShort = Math.max(0, COACH_MIN_USER_GAMES - bucket.userGames)
  const poolShort = Math.max(0, COACH_MIN_POOL_GAMES - bucket.poolGames)
  const race = raceCharToLabel(bucket.race, t)
  const progressText = (count: number, needed: number) =>
    count >= needed
      ? t('myStats.coach.progressEnough', '{{count}}, enough', { count })
      : t('myStats.coach.progress', '{{count}} of {{needed}}', { count, needed })

  let title: React.ReactNode
  if (userShort) {
    title = (
      <Trans
        t={t}
        i18nKey='myStats.coach.unlockUserCount'
        defaults='Analyze <b>{{count}}</b> more of your {{race}} games of this kind'
        count={userShort}
        values={{ race }}
        components={{ b: <Key /> }}
      />
    )
  } else {
    title = (
      <Trans
        t={t}
        i18nKey='myStats.coach.unlockPoolCount'
        defaults='The coach needs <b>{{count}}</b> more games of other {{race}} players'
        count={poolShort}
        values={{ race }}
        components={{ b: <Key /> }}
      />
    )
  }

  return (
    <PaddedPanel>
      <PanelHead>
        <PanelTitle>{title}</PanelTitle>
      </PanelHead>
      <Text>
        {sinceMs === undefined ? (
          <Trans
            t={t}
            i18nKey='myStats.coach.unlockFiltersAll'
            defaults='With these filters: all your {{race}} games here, compared to {{race}} players over <b>{{floor}} EAPM</b>.'
            values={{ race, floor: eapmFloor }}
            components={{ b: <Key /> }}
          />
        ) : (
          <Trans
            t={t}
            i18nKey='myStats.coach.unlockFiltersSince'
            defaults='With these filters: your games here since <b>{{date}}</b>, compared to {{race}} players over <b>{{floor}} EAPM</b> since then.'
            values={{ race, floor: eapmFloor, date: formatDate(sinceMs) }}
            components={{ b: <Key /> }}
          />
        )}
        {bucket.rank
          ? ` ${t('myStats.rankOnly', 'Only players who were rank {{rank}} going into the game count.', { rank: bucket.rank.toUpperCase() })}`
          : null}
        {bucket.poolScripted ? ` ${getScriptedNote(bucket.poolScripted, t)}` : null}
      </Text>
      <Progress>
        <span>{t('myStats.coach.yourGames', 'Your games')}</span>
        <Track>
          <Fill
            $tone={userShort ? undefined : 'good'}
            style={{ width: `${Math.min(1, bucket.userGames / COACH_MIN_USER_GAMES) * 100}%` }}
          />
        </Track>
        <ProgressCount>{progressText(bucket.userGames, COACH_MIN_USER_GAMES)}</ProgressCount>
      </Progress>
      <Progress>
        <span>{t('myStats.coach.theirGames', "Other players' games")}</span>
        <Track>
          <Fill
            $tone={poolShort ? undefined : 'good'}
            style={{ width: `${Math.min(1, bucket.poolGames / COACH_MIN_POOL_GAMES) * 100}%` }}
          />
        </Track>
        <ProgressCount>{progressText(bucket.poolGames, COACH_MIN_POOL_GAMES)}</ProgressCount>
      </Progress>
      <Text>
        {poolShort && sinceMs === undefined
          ? t(
              'myStats.coach.unlockPoolHowAll',
              'To count more players, analyze more replays or pick a lower EAPM under Compared with.',
            )
          : null}
        {poolShort && sinceMs !== undefined
          ? t(
              'myStats.coach.unlockPoolHow',
              'To count more players, analyze more replays, pick more of your games under You, or pick a lower EAPM under Compared with.',
            )
          : null}
        {poolShort
          ? null
          : t(
              'myStats.coach.unlockUserHow',
              'Analyze more of your replays of this kind, or pick more of your games under You.',
            )}
      </Text>
      <UnlockActions>
        <AnalyzeMine names={names} filters={toFilters(bucket)} />
      </UnlockActions>
    </PaddedPanel>
  )
}

/** A difference between two numbers, with its sign: +2, -1.5, or a time like 40s later. */
function formatDifference(
  diff: number,
  unit: CoachResultFinding['unit'],
  formatValue: ReturnType<typeof useFormatValue>,
) {
  const amount = formatValue(Math.abs(diff), unit)
  if (amount === formatValue(0, unit)) {
    return '0'
  }
  return `${diff > 0 ? '+' : '-'}${amount}`
}

type CompareTab = 'all' | 'losses' | 'timings'

const COMPARE_TAB_KEY = 'coach.compareTab'

function readCompareTab(): CompareTab {
  try {
    const tab = localStorage.getItem(COMPARE_TAB_KEY)
    return tab === 'losses' || tab === 'timings' ? tab : 'all'
  } catch {
    return 'all'
  }
}

function writeCompareTab(tab: CompareTab) {
  try {
    localStorage.setItem(COMPARE_TAB_KEY, tab)
  } catch {
    // Without storage the comparison opens on its first tab next time, which is fine.
  }
}

/** Each goal's number, by the metric or build it's about, for marking table rows. */
function getGoalNumbers(bucket: CoachBucket): ReadonlyMap<string, number> {
  return new Map(bucket.goals.map((goal, i) => [goal.buildKey ?? goal.key, i + 1]))
}

/** Where the user is ahead of most other players, one row each with every number. */
function KeepDoing({ bucket }: { bucket: CoachBucket }) {
  const { t } = useTranslation()
  return (
    <PaddedPanel>
      <PanelHead>
        <PanelTitle>{t('myStats.coach.keepDoing', 'Keep doing')}</PanelTitle>
        <PanelHeadNote>
          {t('myStats.coach.keepDoingAhead', 'Ahead of most {{race}} players.', {
            race: raceCharToLabel(bucket.race, t),
          })}
        </PanelHeadNote>
      </PanelHead>
      <Table $columns='minmax(0, 1fr) auto auto auto'>
        <ComparedGroup
          title={t('myStats.coach.number', 'Number')}
          rows={bucket.strengths}
          first={true}
          goalNumbers={new Map()}
          compact={true}
        />
      </Table>
    </PaddedPanel>
  )
}

/**
 * How the user's games compare: every number against other players, their wins against their
 * losses, and when they start each build, one at a time.
 */
export function Comparison({
  bucket,
  eapmFloor,
  sameDates,
  goalNumbers = new Map(),
}: {
  bucket: CoachBucket
  eapmFloor: number
  /** Whether other players' games are limited to the dates of the user's. */
  sameDates: boolean
  /** Each goal's number, by the number it's about, for the goals shown beside the panel. */
  goalNumbers?: ReadonlyMap<string, number>
}) {
  const { t } = useTranslation()
  const race = raceCharToLabel(bucket.race, t)
  const lossesMinute = bucket.mapFamily === 'bgh' ? 15 : 8
  const [tab, setTab] = useState(readCompareTab)
  const poolSource = getPoolSource(bucket.poolFromBaseline, bucket.poolGames, t)

  const source: string[] = [
    sameDates
      ? t(
          'myStats.coach.othersFloor',
          'Compared to {{race}} players over {{floor}} EAPM {{source}}, since the same date. Speed rows count every EAPM.',
          { race, floor: eapmFloor, source: poolSource },
        )
      : t(
          'myStats.coach.othersFloorAll',
          'Compared to {{race}} players over {{floor}} EAPM {{source}}. Speed rows count every EAPM.',
          { race, floor: eapmFloor, source: poolSource },
        ),
  ]
  if (isTeamGame(bucket.shape)) {
    source.push(t('myStats.coach.sourceTeammates', "Your regular teammates aren't counted."))
  }
  if (bucket.shape === '1v1') {
    // In a mirror, other players are mostly the user's own opponents; otherwise they can only come
    // from other people's games, so the benchmark means something different.
    const fromOthers = bucket.poolGames - bucket.poolFromUserGames - bucket.poolFromBaseline
    source.push(
      bucket.poolFromBaseline
        ? t(
            'myStats.coach.poolSourceSplitLadder',
            '{{fromYours}} of theirs are from your own games, {{fromOthers}} from your other replays and {{fromLadder}} from recent ladder games.',
            {
              fromYours: bucket.poolFromUserGames,
              fromOthers,
              fromLadder: bucket.poolFromBaseline,
            },
          )
        : t(
            'myStats.coach.poolSourceSplit',
            '{{fromYours}} of theirs are from your own games, {{fromOthers}} from other replays.',
            { fromYours: bucket.poolFromUserGames, fromOthers },
          ),
    )
  }
  if (bucket.allyRace) {
    source.push(
      bucket.anyAlly
        ? t(
            'myStats.coach.anyAlly',
            'Too few of them had a {{ally}} ally, so they are compared whatever their ally played.',
            { ally: raceCharToLabel(bucket.allyRace, t) },
          )
        : t('myStats.coach.sameAlly', 'All of them had a {{ally}} ally, like you.', {
            ally: raceCharToLabel(bucket.allyRace, t),
          }),
    )
  }
  // Last, so "them" and "theirs" above mean the players compared with.
  if (bucket.poolScripted) {
    source.push(getScriptedNote(bucket.poolScripted, t))
  }

  let content: React.ReactNode
  if (tab === 'all') {
    content = bucket.compared.length ? (
      <>
        {source.length ? <About>{source.join(' ')}</About> : null}
        <ComparedTable
          findings={bucket.compared}
          uncompared={bucket.uncompared}
          goalNumbers={goalNumbers}
        />
      </>
    ) : (
      <Text>
        {t('myStats.coach.nothingCompared', 'Not enough games to compare any number yet.')}
      </Text>
    )
  } else if (tab === 'losses') {
    if (bucket.inLosses.length) {
      content = (
        <>
          <About>
            {t(
              'myStats.coach.lossesHelpLine',
              'Every number from the first {{minute}} minutes, in your typical win and your typical loss. Red marks the ones that differ enough to matter. They go together with losing, which does not mean they cause it.',
              { minute: lossesMinute },
            )}
          </About>
          <LossesTable findings={bucket.inLosses} minute={lossesMinute} goalNumbers={goalNumbers} />
        </>
      )
    } else if (
      bucket.wins < COACH_MIN_RESULT_GAMES ||
      bucket.lossesCompared < COACH_MIN_RESULT_GAMES
    ) {
      content = (
        <Text>
          {t(
            'myStats.coach.lossesNeed',
            'Comparing needs {{needed}} wins and {{needed}} losses here. So far: {{wins}} and {{losses}}.',
            { needed: COACH_MIN_RESULT_GAMES, wins: bucket.wins, losses: bucket.lossesCompared },
          )}
          {bucket.lossesCompared < bucket.losses
            ? ` ${t(
                'myStats.coach.lossesLeftAlone',
                "Losses where a teammate went out first don't count.",
              )}`
            : null}
        </Text>
      )
    } else {
      content = (
        <Text>
          {t(
            'myStats.coach.lossesSame',
            "These games don't have numbers from the start of the game to compare.",
          )}
        </Text>
      )
    }
  } else {
    content = (
      <>
        <About>
          {[
            bucket.opening.length
              ? t('myStats.coach.opening', 'Your usual opening: {{opening}}.', {
                  opening: bucket.opening.map(key => getBuildName(key, t)).join(', '),
                })
              : '',
            t(
              'myStats.coach.timingsHelpLine',
              'When you and other players usually start each building, tech and upgrade in the first 15 minutes. Bold: both sides usually make it, 15 seconds or more apart, except upgrade and defense buildings. Earlier is not always better: it depends on your build.',
            ),
          ]
            .filter(Boolean)
            .join(' ')}
        </About>
        {bucket.timings.length ? (
          <TimingsTable timings={bucket.timings} goalNumbers={goalNumbers} />
        ) : (
          <Text>
            {t(
              'myStats.coach.noTimings',
              'No builds started in the first 15 minutes in enough of these games.',
            )}
          </Text>
        )}
      </>
    )
  }

  return (
    <ComparePanel>
      <PanelHead>
        <PanelTitle>
          <TitleRace>
            <RaceTag race={bucket.race} />
            {t('myStats.coach.allNumbers', 'All the numbers')}
          </TitleRace>
        </PanelTitle>
        <PanelHeadNote>
          {t('myStats.coach.allNumbersNote', 'Your {{race}} games in {{where}}.', {
            race,
            where: getPoolPlace(bucket, t),
          })}
        </PanelHeadNote>
      </PanelHead>
      <CompareTabs
        label={t('myStats.coach.compareTabs', 'What to compare')}
        options={[
          {
            value: 'all',
            label: t('myStats.coach.tabOthers', 'Compared to other {{race}} players', { race }),
          },
          { value: 'losses', label: t('myStats.coach.tabLosses', 'Wins against losses') },
          { value: 'timings', label: t('myStats.coach.tabTimings', 'Timings') },
        ]}
        value={tab}
        onChange={(next: CompareTab) => {
          writeCompareTab(next)
          setTab(next)
        }}
      />
      {content}
    </ComparePanel>
  )
}

function BucketView({
  bucket,
  eapmFloor,
  sinceMs,
  showTitle,
  counts,
  others,
  window,
  autoGames,
  autoMonths,
}: {
  bucket: CoachBucket
  eapmFloor: number
  sinceMs?: number
  showTitle: boolean
  counts: ReadonlyArray<ShapeCount>
  window: CoachWindow
  autoGames: number
  autoMonths: boolean
  /** The groups of games too small to show, named in the scope line. */
  others?: string
}) {
  const { t } = useTranslation()
  const ready = isReady(bucket)
  // Goals can come from the user's own wins and earlier games, before there are enough other
  // players to compare with.
  const showNextGame = ready || bucket.goals.length > 0
  const title = getBucketTitle(bucket, t)
  const showStrengths = ready && bucket.strengths.length > 0

  return (
    <Bucket>
      {showTitle && title ? <BucketTitle>{title}</BucketTitle> : null}
      <PlanColumns>
        <SectionErrorBoundary>
          {showNextGame ? (
            <NextGame bucket={bucket} allGames={sinceMs === undefined} eapmFloor={eapmFloor} />
          ) : (
            <Unlock bucket={bucket} eapmFloor={eapmFloor} sinceMs={sinceMs} />
          )}
        </SectionErrorBoundary>
        <SideColumn>
          <SectionErrorBoundary>
            <CoachNotes bucket={bucket} hideStrength={showStrengths} />
          </SectionErrorBoundary>
          {showStrengths ? (
            <SectionErrorBoundary>
              <KeepDoing bucket={bucket} />
            </SectionErrorBoundary>
          ) : null}
        </SideColumn>
      </PlanColumns>
      {ready ? (
        <SectionErrorBoundary>
          <Comparison
            bucket={bucket}
            eapmFloor={eapmFloor}
            sameDates={sinceMs !== undefined}
            goalNumbers={getGoalNumbers(bucket)}
          />
        </SectionErrorBoundary>
      ) : null}
      {showNextGame && !ready ? (
        <Unlock bucket={bucket} eapmFloor={eapmFloor} sinceMs={sinceMs} />
      ) : null}
      <ScopeLine
        bucket={bucket}
        eapmFloor={eapmFloor}
        sinceMs={sinceMs}
        window={window}
        autoGames={autoGames}
        autoMonths={autoMonths}
        counts={counts}
        others={others}
      />
    </Bucket>
  )
}

/**
 * Who the coach compares the user with, picked by EAPM. Until the user picks, it's the coach's
 * own pick from how fast they play. A pick also applies to My stats, which compares with the same
 * players.
 */
function FloorMenu({ floor }: { floor: number }) {
  const { t } = useTranslation()
  const setFilters = useSetAtom(myStatsFiltersAtom)
  const floors: Array<SegmentOption<number>> = EAPM_FLOORS.map(value => ({
    value,
    label: t('myStats.filters.floorOption', '{{floor}}+ EAPM', { floor: value }),
    menuLabel: t('myStats.coach.floorMenuPlayers', 'Players over {{floor}} EAPM', {
      floor: value,
    }),
  }))
  return (
    <SegmentMenu
      label={t('myStats.filters.floor', 'Compared with')}
      options={floors}
      value={floor}
      onChange={eapmFloor => setFilters(f => ({ ...f, eapmFloor }))}
    />
  )
}

/** Which of the user's games the coach looks at: their latest few, or all of them. */
function WindowMenu({ autoGames, autoMonths }: { autoGames: number; autoMonths: boolean }) {
  const { t } = useTranslation()
  const [window, setWindow] = useAtom(coachWindowAtom)
  // Auto is a number of games too, so a fixed choice of the same number would only repeat it.
  const options: Array<SegmentOption<CoachWindow>> = [
    autoMonths
      ? {
          value: 'auto',
          label: t('myStats.coach.windowMonths', 'Last 3 months'),
          menuLabel: t('myStats.coach.windowMonthsGames', 'Last 3 months, {{count}} games', {
            count: autoGames,
          }),
        }
      : {
          value: 'auto',
          label: t('myStats.coach.windowGames', 'Last {{count}} games', { count: autoGames }),
          menuLabel: t('myStats.coach.windowFewMonths', 'Last {{count}} games', {
            count: autoGames,
          }),
        },
    ...COACH_WINDOW_GAMES.filter(count => count !== autoGames).map(count => ({
      value: count,
      label: t('myStats.coach.windowGames', 'Last {{count}} games', { count }),
    })),
    { value: 'all', label: t('myStats.coach.windowAll', 'All games') },
  ]
  return (
    <SegmentMenu
      label={t('myStats.coach.you', 'You')}
      options={options}
      value={window}
      onChange={setWindow}
    />
  )
}

/** Every group of the coached kind of game that's ready, then the rest in a line. */
function CoachBody({ coach, counts }: { coach: CoachResult; counts: ReadonlyArray<ShapeCount> }) {
  const { t } = useTranslation()
  const names = useStatsPlayerNames() ?? []

  if (coach.status === 'noGames') {
    return (
      <Message>
        <Text>
          {t(
            'myStats.coach.nothingToPick',
            'None of your analyzed games can be compared yet. Analyze a few more of yours.',
          )}
        </Text>
        <UnlockActions>
          <AnalyzeMine names={names} filters={{ range: 'all' }} />
        </UnlockActions>
      </Message>
    )
  }
  if (!coach.buckets.length) {
    return (
      <Message>
        <Text>
          {t('myStats.coach.noneOfKind', 'None of your analyzed games are of this kind yet.')}
        </Text>
        <UnlockActions>
          <AnalyzeMine names={names} filters={toFilters(coach.scope)} />
        </UnlockActions>
      </Message>
    )
  }

  // Every group that's ready gets its own section. Short of that, only the biggest does, so a
  // stray game on another kind of map doesn't get a whole section to itself. Buckets come
  // biggest first.
  const ready = coach.buckets.filter(isReady)
  const shown = ready.length ? ready : coach.buckets.slice(0, 1)
  const rest = coach.buckets.filter(bucket => !shown.includes(bucket))
  const others = rest.length
    ? t('myStats.coach.tooFew', 'Also {{games}}, too few to compare yet.', {
        games: rest
          .map(bucket =>
            t('myStats.coach.tooFewGames', {
              defaultValue: '{{count}} games on {{maps}}',
              defaultValue_one: '{{count}} game on {{maps}}',
              count: bucket.userGames + bucket.skippedGames,
              maps: getBucketPlace(bucket, t),
            }),
          )
          .join(', '),
      })
    : undefined
  return (
    <>
      {shown.map((bucket, i) => (
        <BucketView
          key={`${bucket.shape}${bucket.mapFamily ?? ''}`}
          bucket={bucket}
          eapmFloor={coach.eapmFloor}
          sinceMs={coach.sinceMs}
          showTitle={shown.length > 1 && bucket.mapFamily !== undefined}
          counts={counts}
          others={i === 0 ? others : undefined}
          window={coach.window}
          autoGames={coach.autoGames}
          autoMonths={coach.autoMonths}
        />
      ))}
    </>
  )
}

/** How long the coach's explainer stays closed once the user closes it. */
const EXPLAINER_CLOSED_KEY = 'coach.explainerClosed'

function readExplainerClosed() {
  try {
    return localStorage.getItem(EXPLAINER_CLOSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeExplainerClosed(closed: boolean) {
  try {
    if (closed) {
      localStorage.setItem(EXPLAINER_CLOSED_KEY, '1')
    } else {
      localStorage.removeItem(EXPLAINER_CLOSED_KEY)
    }
  } catch {
    // Without storage it opens again next time, which is fine.
  }
}

/** Whether the bar has scrolled to the top of the page and stuck there, from a marker above it. */
function useStuck() {
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    if (!sentinel) {
      return undefined
    }
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting))
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [sentinel])
  return [setSentinel, stuck] as const
}

/**
 * The game type picked, from the locked ones or else the one `coach` looks at, if it has none of
 * `scopes` yet.
 */
export function useLockedShape(
  coach: CoachResult | 'error' | undefined,
  scopes: ReadonlyArray<CoachScope>,
  counts: ReadonlyArray<ShapeCount>,
): ShapeCount | undefined {
  const lockedShape = useAtomValue(coachLockedShapeAtom)
  const pickedShape =
    lockedShape ??
    (coach && coach !== 'error' && coach.status === 'ready' ? coach.scope.shape : undefined)
  return scopes.some(s => s.shape === pickedShape)
    ? undefined
    : counts.find(c => c.shape === pickedShape)
}

/**
 * The bar picking the kind of game, the user's games and who they're compared with, shared by the
 * Coach and Builds pages. Stays in view as the page scrolls, with an edge once it's stuck.
 */
export function CoachToolbar({
  coach,
  scopes,
  counts,
}: {
  coach: CoachResult
  /** The kinds of game to offer, of `coach.scopes`. */
  scopes: ReadonlyArray<CoachScope>
  counts: ReadonlyArray<ShapeCount>
}) {
  const { t } = useTranslation()
  const [sentinelRef, stuck] = useStuck()
  const [toolbarRef, toolbarSize] = useObservedDimensions<HTMLDivElement>()
  useStuckBarBottom(stuck ? toolbarSize?.height : undefined)
  const pickedLocked = useLockedShape(coach, scopes, counts)
  const picked = coach.status === 'ready' ? coach.scope : undefined
  return (
    <>
      <StuckSentinel ref={sentinelRef} />
      <Toolbar ref={toolbarRef} $stuck={stuck}>
        <ShapeMenu scopes={scopes} picked={picked} counts={counts} />
        {picked && !pickedLocked ? (
          <>
            <MapPicker scopes={scopes} picked={picked} />
            {coach.status === 'ready' ? (
              <MapNameMenu maps={coach.maps} picked={coach.mapKey} />
            ) : null}
            <RacePicker scopes={scopes} picked={picked} />
          </>
        ) : null}
        <Spacer />
        {coach.status === 'ready' ? (
          <WindowMenu autoGames={coach.autoGames} autoMonths={coach.autoMonths} />
        ) : null}
        <FloorMenu floor={coach.eapmFloor} />
        {picked?.shape === '1v1' ? (
          <RankMenu
            autoRank={coach.autoRank}
            rankMmr={coach.rankMmr}
            label={t('myStats.filters.rank', 'At rank')}
          />
        ) : null}
      </Toolbar>
    </>
  )
}

/**
 * The experimental coach: what to work on, how the user has played lately, and where they stand
 * against other players of their race in the same kind of game.
 */
export function CoachView({
  coach,
  onRetry,
}: {
  coach: CoachResult | 'error' | undefined
  onRetry?: () => void
}) {
  const { t } = useTranslation()
  const counts = useShapeCounts()
  const [explainerClosed, setExplainerClosed] = useState(readExplainerClosed)
  const scopes = (coach === 'error' ? undefined : coach)?.scopes.filter(
    scope => scope.games >= COACH_MIN_SCOPE_GAMES,
  )
  const pickedLocked = useLockedShape(coach, scopes ?? [], counts)
  const toggleExplainer = () => {
    writeExplainerClosed(!explainerClosed)
    setExplainerClosed(!explainerClosed)
  }

  let content: React.ReactNode
  if (coach === 'error') {
    content = (
      <Message>
        <Text>
          {t(
            'myStats.coach.loadError',
            "The coach couldn't work out your games. Your replays and stats are fine.",
          )}
        </Text>
        {onRetry ? (
          <UnlockActions>
            <OutlinedButton label={t('common.actions.tryAgain', 'Try again')} onClick={onRetry} />
          </UnlockActions>
        ) : null}
      </Message>
    )
  } else if (coach) {
    content = (
      <>
        <CoachToolbar coach={coach} scopes={scopes ?? []} counts={counts} />
        {pickedLocked ? (
          <LockedView locked={pickedLocked} />
        ) : (
          <CoachBody coach={coach} counts={counts} />
        )}
      </>
    )
  } else {
    content = <PageLoadingIndicator />
  }

  return (
    <Root>
      <Header>
        <Title>{t('myStats.coach.title', 'Coach')}</Title>
        <Badge>{t('myStats.coach.experimental', 'Experimental')}</Badge>
        {explainerClosed ? (
          <HowItWorksButton type='button' onClick={toggleExplainer}>
            {t('myStats.coach.howItWorks', 'How it works')}
          </HowItWorksButton>
        ) : null}
      </Header>
      {explainerClosed ? null : (
        <Callout>
          <CalloutTop>
            <CalloutIcon />
            <CalloutTitle>{t('myStats.coach.howItWorksTitle', 'How the coach works')}</CalloutTitle>
          </CalloutTop>
          <CalloutSteps>
            <CalloutStep>
              <CalloutStepTitle>
                {t('myStats.coach.stepCompareTitle', 'Your games against theirs')}
              </CalloutStepTitle>
              <CalloutStepText>
                {t(
                  'myStats.coach.stepCompare',
                  'Your recent games of one kind, next to other players of your race in the same kind of games.',
                )}
              </CalloutStepText>
            </CalloutStep>
            <CalloutStep>
              <CalloutStepTitle>
                {t('myStats.coach.stepGoalsTitle', 'A few goals')}
              </CalloutStepTitle>
              <CalloutStepText>
                {t(
                  'myStats.coach.stepGoals',
                  'Where you trail most players, where your losses differ from your wins, and builds you start late.',
                )}
              </CalloutStepText>
            </CalloutStep>
            <CalloutStep>
              <CalloutStepTitle>
                {t('myStats.coach.stepHintTitle', 'A hint, not a rule')}
              </CalloutStepTitle>
              <CalloutStepText>
                {t(
                  'myStats.coach.stepHint',
                  "Your build may call for something else, and the meta changes what's right.",
                )}
              </CalloutStepText>
            </CalloutStep>
          </CalloutSteps>
          <CalloutClose
            type='button'
            aria-label={t('common.actions.close', 'Close')}
            onClick={toggleExplainer}>
            <MaterialIcon icon='close' size={18} />
          </CalloutClose>
        </Callout>
      )}
      {content}
    </Root>
  )
}

/** The Coach page, which needs the user's names to tell which games are theirs. */
export function CoachPage() {
  const newest = useNewestOwnGame()
  const { coach, retry } = useCoach()
  const demo = useDemoPlayer()

  if (!demo && !newest) {
    return <PageLoadingIndicator />
  }
  if (!demo && newest && newest.state !== 'found') {
    return <OwnGamesNeeded state={newest.state} onRetry={newest.retry} />
  }
  return <CoachView coach={coach} onRetry={retry} />
}
