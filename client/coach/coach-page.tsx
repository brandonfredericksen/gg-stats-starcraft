import { TFunction } from 'i18next'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MapFamily } from '../../common/games/map-family'
import {
  COACH_MIN_POOL_GAMES,
  COACH_MIN_RESULT_GAMES,
  COACH_MIN_USER_GAMES,
  COACH_WINDOW_GAMES,
  CoachBucket,
  CoachFinding,
  CoachResult,
  CoachResultFinding,
  CoachScope,
  CoachTiming,
  CoachWindow,
  EAPM_FLOORS,
} from '../../common/my-stats/coach'
import { isTeamGame } from '../../common/my-stats/player-games'
import { raceCharToLabel } from '../../common/races'
import { SectionErrorBoundary } from '../games/game-stats-shared'
import { OutlinedButton, TextButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { RaceTag } from '../material/race-tag'
import { SegmentMenu, SegmentOption } from '../material/segmented'
import { AnalyzeMine } from '../my-stats/analyze-mine'
import { useDemoPlayer, useStatsPlayerNames } from '../my-stats/demo-player'
import { MyStatsFilters, myStatsFiltersAtom } from '../my-stats/my-stats-data'
import { formatPercent, HelpLabel, PaddedPanel, PanelTitle } from '../my-stats/my-stats-panels'
import { LoadingDotsArea } from '../progress/dots'
import {
  bodyMedium,
  bodySmall,
  headlineMedium,
  labelLarge,
  labelSmall,
  titleLarge,
  titleMedium,
  titleSmall,
} from '../styles/typography'
import { OwnGamesNeeded, useOwnGamesState } from '../system-bar/own-games-needed'
import {
  coachLockedShapeAtom,
  coachMapAtom,
  coachScopeAtom,
  coachWindowAtom,
  ShapeCount,
  useCoach,
  useShapeCounts,
} from './coach-data'
import { CoachNotes, NextGame } from './coach-plan'
import {
  Card,
  Cell,
  Column,
  Columns,
  ColumnTitle,
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
const Root = styled.div`
  container: coach / inline-size;
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 22px 32px 56px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const Title = styled.h1`
  ${headlineMedium};
  margin: 0;
`

const Badge = styled.span`
  ${labelSmall};
  height: 20px;
  padding: 0 8px;

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
  margin: -12px 0;
  padding: 12px 0;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;

  background-color: var(--theme-container-lowest);
  /* An edge once the page scrolls under it, so what passes beneath isn't cut off mid line. */
  box-shadow: ${props =>
    props.$stuck
      ? '0 1px 0 var(--theme-outline-variant), 0 8px 12px -8px rgb(0 0 0 / 0.5)'
      : 'none'};
`

/** Sits right above the bar: once it scrolls out of view, the bar is stuck. */
const StuckSentinel = styled.div`
  height: 1px;
  margin-bottom: -1px;
`

/** The race the user played, among the kinds of game of the picked game type. */
const Races = styled.div`
  flex-shrink: 0;
  padding: 4px;

  display: inline-flex;
  gap: 2px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-md);
  background-color: var(--theme-container-low);
`

const RaceButton = styled.button<{ $on: boolean }>`
  ${buttonReset};
  ${labelLarge};
  height: 30px;
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

/** Lines this long are as wide as reads comfortably. */
const About = styled(Text)`
  max-width: 80ch;
`

/** A title with a muted note after it on the same line. */
const TitleLine = styled.div`
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
`

const TitleRace = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`

const TitleNote = styled.span`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

/** Cards for one list across the panel, when the other list has nothing to show beside it. */
const CardsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px 20px;
`

/** The coach in a few lines, open until the user closes it. */
const Explainer = styled(PaddedPanel)`
  gap: 8px;
`

const ExplainerTop = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`

const ExplainerList = styled.ol`
  ${bodyMedium};
  margin: 0;
  padding-left: 20px;

  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--theme-on-surface-variant);
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

/** How much of the user's replays the coach has to go on, with a way to give it more. */
const Coverage = styled.div`
  ${bodyMedium};
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  color: var(--theme-on-surface-variant);
`

const Bucket = styled.section`
  display: flex;
  flex-direction: column;
  gap: 16px;

  & + & {
    margin-top: 16px;
  }
`

const BucketTitle = styled.h2`
  ${titleMedium};
  margin: 0;
`

/** The next game's goals beside the coach's notes, stacking when there's no room. */
const PlanColumns = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;

  @container coach (width < 880px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const ComparePanel = styled(PaddedPanel)`
  gap: 18px;
`

const Message = styled(PaddedPanel)`
  gap: 12px;
`

const UnlockTitle = styled.h4`
  ${titleSmall};
  margin: 0;
`

const Progress = styled.div`
  ${bodyMedium};
  display: grid;
  grid-template-columns: minmax(120px, max-content) minmax(0, 1fr) 100px;
  align-items: center;
  gap: 16px;
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
  gap: 12px;
`

const CardTop = styled.div`
  ${labelLarge};
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-weight: 600;
`

const Beats = styled.span`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
  white-space: nowrap;
`

const Numbers = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 32px;
`

const NumberBlock = styled.div`
  display: flex;
  flex-direction: column;
`

const Big = styled.span<{ $tone?: Tone }>`
  ${titleLarge};
  font-variant-numeric: tabular-nums;
  color: ${props => toneColor(props.$tone)};
`

const Caption = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
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
  gap: 8px;
  color: var(--theme-on-surface-variant);
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
function getPoolPlace(bucket: CoachBucket, t: TFunction) {
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

function isReady(bucket: CoachBucket) {
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
  if (pickedLocked && locked.some(count => count.shape === pickedLocked)) {
    value = `locked:${pickedLocked}`
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

  return (
    <Races role='group' aria-label={t('myStats.coach.races', 'Your race')}>
      {inMode.map(scope => {
        const selected =
          picked.race === scope.race &&
          picked.opponentRace === scope.opponentRace &&
          picked.allyRace === scope.allyRace
        const description = t('myStats.coach.scopeLabel', {
          defaultValue: '{{name}}, {{count}} games',
          defaultValue_one: '{{name}}, {{count}} game',
          name: getScopeName(scope, t),
          count: scope.games,
        })
        return (
          <RaceButton
            key={`${scope.race}${scope.opponentRace ?? ''}${scope.allyRace ?? ''}`}
            type='button'
            $on={selected}
            aria-pressed={selected}
            aria-label={description}
            title={description}
            onClick={() => setScope(toQueryScope(scope))}>
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
          </RaceButton>
        )
      })}
    </Races>
  )
}

/** How many of the user's replays of the picked game type are analyzed, and of all of them. */
function CoverageLine({
  shape,
  counts,
}: {
  shape: ShapeCount['shape']
  counts: ReadonlyArray<ShapeCount>
}) {
  const { t } = useTranslation()
  const names = useStatsPlayerNames() ?? []
  const count = counts.find(c => c.shape === shape)
  if (!count) {
    return null
  }

  return (
    <Coverage>
      <span>
        {t(
          'myStats.coach.coverage',
          '{{analyzed}} of your {{total}} games of {{shape}} are analyzed.',
          {
            analyzed: count.analyzed.toLocaleString(),
            total: count.total.toLocaleString(),
            shape: getShapeName(shape, t),
          },
        )}
      </span>
      <AnalyzeMine names={names} filters={{ range: 'all', shape }} compact={true} />
    </Coverage>
  )
}

/** A game type the coach can't look at yet: how many of its replays are analyzed, and a way on. */
function LockedView({ locked }: { locked: ShapeCount }) {
  const { t } = useTranslation()
  const names = useStatsPlayerNames() ?? []
  const name = locked.shape === 'ffa' ? t('myStats.ffa', 'FFA') : locked.shape

  return (
    <PaddedPanel>
      <UnlockTitle>
        {t('myStats.coach.lockedTitle', 'Analyze more of your {{shape}} games to coach them', {
          shape: name,
        })}
      </UnlockTitle>
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

function FindingCard({ finding }: { finding: CoachFinding }) {
  const { t } = useTranslation()
  const formatValue = useFormatValue()
  const [label, help] = getMetricText(finding.key, t)
  const tone: Tone = finding.beats >= 0.5 ? 'good' : 'bad'
  const percent = Math.round(finding.beats * 100)
  const notes: string[] = []
  if (finding.sameOpening) {
    notes.push(t('myStats.coach.sameOpening', 'Compared with players who opened the same way.'))
  }
  if (finding.fewerProduction) {
    notes.push(
      t(
        'myStats.coach.fewerProduction',
        'You had {{count}} fewer production buildings at 8 min than them, which is often why a bank builds up.',
        { count: Math.round(finding.fewerProduction) },
      ),
    )
  }

  return (
    <Card>
      <CardTop>
        <HelpLabel label={label} help={help} />
        <Beats>
          <HelpLabel
            label={t('myStats.coach.beats', 'Better than {{percent}}%', { percent })}
            help={t(
              'myStats.coach.beatsHelp',
              'In your typical game, you did better than {{percent}}% of the other players here. From {{userGames}} of your games and {{poolGames}} of theirs.',
              { percent, userGames: finding.userGames, poolGames: finding.poolGames },
            )}
          />
        </Beats>
      </CardTop>
      <Numbers>
        <NumberBlock>
          <Big $tone={tone}>{formatValue(finding.userValue, finding.unit)}</Big>
          <Caption>{t('myStats.coach.youUsually', 'You usually')}</Caption>
        </NumberBlock>
        <NumberBlock>
          <Big>{formatValue(finding.poolValue, finding.unit)}</Big>
          <Caption>{t('myStats.coach.themUsually', 'Them usually')}</Caption>
        </NumberBlock>
      </Numbers>
      <Standing aria-hidden={true}>
        <StandingMiddle />
        <StandingMarker $tone={tone} style={{ left: `${finding.beats * 100}%` }} />
      </Standing>
      {notes.map(note => (
        <Text key={note}>{note}</Text>
      ))}
    </Card>
  )
}

/** Where a number sits among other players, decided the way the coach decides what to point out. */
function getStandingTone(beats: number): Tone | undefined {
  if (beats < 0.3) {
    return 'bad'
  }
  return beats > 0.7 ? 'good' : undefined
}

function ComparedGroup({
  title,
  findings,
  first,
}: {
  title: string
  findings: ReadonlyArray<CoachFinding>
  first: boolean
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
      {findings.map(finding => {
        const [label, help] = getMetricText(finding.key, t)
        const tone = getStandingTone(finding.beats)
        return [
          <Cell key={`${finding.key}-label`}>
            <HelpLabel
              quiet={true}
              label={label}
              help={`${help} ${t(
                'myStats.coach.fromGames',
                'From {{userGames}} of your games and {{poolGames}} of theirs.',
                { userGames: finding.userGames, poolGames: finding.poolGames },
              )}`}
            />
          </Cell>,
          <Cell key={`${finding.key}-you`} $end={true} $tone={tone}>
            {formatValue(finding.userValue, finding.unit)}
          </Cell>,
          <Cell key={`${finding.key}-them`} $end={true} $tone='muted'>
            {formatValue(finding.poolValue, finding.unit)}
          </Cell>,
          <Cell key={`${finding.key}-standing`} $end={true}>
            <MiniStanding>
              <MiniTrack aria-hidden={true}>
                <StandingMiddle />
                <MiniMarker $tone={tone} style={{ left: `${finding.beats * 100}%` }} />
              </MiniTrack>
              {formatPercent(finding.beats)}
            </MiniStanding>
          </Cell>,
        ]
      })}
    </>
  )
}

/** Both halves of a table share these widths, so their columns line up across the panel. */
const VALUE_COLUMN = '116px'

/** Every number the coach compared, pointed out or not, grouped by what it's about. */
function ComparedTable({ findings }: { findings: ReadonlyArray<CoachFinding> }) {
  const { t } = useTranslation()
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
        <Table
          key={groups.join()}
          $columns={`minmax(0, 1fr) ${VALUE_COLUMN} ${VALUE_COLUMN} ${VALUE_COLUMN}`}>
          {groups
            .filter(group => findings.some(f => getMetricGroup(f.key) === group))
            .map((group, i) => (
              <ComparedGroup
                key={group}
                title={titles[group]}
                findings={findings.filter(f => getMetricGroup(f.key) === group)}
                first={i === 0}
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
}: {
  findings: ReadonlyArray<CoachResultFinding>
  /** The minute the numbers compared go up to. */
  minute: number
}) {
  const { t } = useTranslation()
  const formatValue = useFormatValue()
  return (
    <Table $columns={`minmax(0, 1fr) ${VALUE_COLUMN} ${VALUE_COLUMN}`}>
      <HeadCell>{t('myStats.coach.upToMinute', 'Up to {{minute}} min', { minute })}</HeadCell>
      <HeadCell $end={true}>{t('myStats.coach.inWinsHead', 'In wins')}</HeadCell>
      <HeadCell $end={true}>{t('myStats.coach.inLossesHead', 'In losses')}</HeadCell>
      {findings.map(finding => {
        const [label, help] = getMetricText(finding.key, t)
        return [
          <Cell key={`${finding.key}-label`}>
            <HelpLabel quiet={true} label={label} help={help} />
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
        ]
      })}
    </Table>
  )
}

function TimingsTable({ timings }: { timings: ReadonlyArray<CoachTiming> }) {
  const { t } = useTranslation()
  return (
    <Table $columns='minmax(0, 1fr) 72px 72px 104px'>
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
          <Cell key={`${timing.buildKey}-name`}>{getBuildName(timing.buildKey, t)}</Cell>,
          <Cell key={`${timing.buildKey}-you`} $end={true}>
            {userMs !== undefined ? formatGameTime(userMs) : '-'}
          </Cell>,
          <Cell key={`${timing.buildKey}-them`} $end={true} $tone='muted'>
            {poolMs !== undefined ? formatGameTime(poolMs) : '-'}
          </Cell>,
          <Cell key={`${timing.buildKey}-diff`} $end={true} $tone='muted' $strong={timing.notable}>
            {difference}
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
function Unlock({ bucket, eapmFloor }: { bucket: CoachBucket; eapmFloor: number }) {
  const { t } = useTranslation()
  const names = useStatsPlayerNames() ?? []
  const userShort = Math.max(0, COACH_MIN_USER_GAMES - bucket.userGames)
  const poolShort = bucket.poolGames < COACH_MIN_POOL_GAMES
  const progressText = (count: number, needed: number) =>
    count >= needed
      ? t('myStats.coach.progressEnough', '{{count}}, enough', { count })
      : t('myStats.coach.progress', '{{count}} of {{needed}}', { count, needed })

  return (
    <PaddedPanel>
      <UnlockTitle>
        {userShort
          ? t('myStats.coach.unlockUser', {
              defaultValue: 'Analyze {{count}} more of your games here to unlock the coach',
              defaultValue_one: 'Analyze {{count}} more of your games here to unlock the coach',
              count: userShort,
            })
          : t('myStats.coach.unlockPool', 'The coach needs more games of other players here')}
      </UnlockTitle>
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
        {t(
          'myStats.coach.poolSource',
          'Other players come from your replays: anyone of your race in these games, over the EAPM floor.',
        )}
        {poolShort && eapmFloor > EAPM_FLOORS[0]
          ? ` ${t('myStats.coach.lowerFloor', 'Lowering the EAPM floor at the top counts more of them.')}`
          : null}
      </Text>
      <UnlockActions>
        <AnalyzeMine names={names} filters={toFilters(bucket)} />
      </UnlockActions>
    </PaddedPanel>
  )
}

/** How the user's games compare with other players': gaps, strengths, every number, timings. */
function Comparison({
  bucket,
  eapmFloor,
  sinceMs,
}: {
  bucket: CoachBucket
  eapmFloor: number
  sinceMs?: number
}) {
  const { t } = useTranslation()
  const formatValue = useFormatValue()
  const race = raceCharToLabel(bucket.race, t)
  const lossesMinute = bucket.mapFamily === 'bgh' ? 15 : 8

  let losses: React.ReactNode
  if (bucket.inLosses.length) {
    losses = <LossesTable findings={bucket.inLosses} minute={lossesMinute} />
  } else if (bucket.wins < COACH_MIN_RESULT_GAMES || bucket.losses < COACH_MIN_RESULT_GAMES) {
    losses = (
      <Text>
        {t(
          'myStats.coach.lossesNeed',
          'Comparing needs {{needed}} wins and {{needed}} losses here. So far: {{wins}} and {{losses}}.',
          { needed: COACH_MIN_RESULT_GAMES, wins: bucket.wins, losses: bucket.losses },
        )}
      </Text>
    )
  } else {
    losses = (
      <Text>
        {t(
          'myStats.coach.lossesSame',
          "These games don't have numbers from the start of the game to compare.",
        )}
      </Text>
    )
  }

  const source = [
    t(
      'myStats.coach.sourceLine',
      'From your own replays: {{games}} games of {{players}} {{race}} players, up to 5 games each.',
      { games: bucket.poolGames, players: bucket.poolPlayers, race },
    ),
  ]
  if (sinceMs !== undefined) {
    source.push(
      t('myStats.coach.sourceSince', 'Only games since {{date}}, like yours.', {
        date: formatDate(sinceMs),
      }),
    )
  }
  if (isTeamGame(bucket.shape)) {
    source.push(t('myStats.coach.sourceTeammates', "Your regular teammates aren't counted."))
  }
  if (bucket.shape === '1v1') {
    // In a mirror, other players are mostly the user's own opponents; otherwise they can only come
    // from other people's games, so the benchmark means something different.
    source.push(
      t(
        'myStats.coach.poolSourceSplit',
        '{{fromYours}} of theirs are from your own games, {{fromOthers}} from other replays.',
        {
          fromYours: bucket.poolFromUserGames,
          fromOthers: bucket.poolGames - bucket.poolFromUserGames,
        },
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

  const { closestGap } = bucket
  const workOn = (
    <Column>
      <ColumnTitle $tone='bad'>{t('myStats.coach.workOn', 'Work on')}</ColumnTitle>
      {bucket.gaps.length ? (
        <CardsGrid>
          {bucket.gaps.map(finding => (
            <FindingCard key={finding.key} finding={finding} />
          ))}
        </CardsGrid>
      ) : (
        <Text>
          {closestGap
            ? t(
                'myStats.coach.noGapsClosest',
                'No number is clearly behind other players in most of your games. Closest: {{metric}}, {{you}} against {{them}}, better than {{percent}}. Your goals also come from your wins, losses and timings.',
                {
                  metric: getMetricText(closestGap.key, t)[0],
                  you: formatValue(closestGap.userValue, closestGap.unit),
                  them: formatValue(closestGap.poolValue, closestGap.unit),
                  percent: formatPercent(closestGap.beats),
                },
              )
            : t(
                'myStats.coach.noGapsClose',
                "You're even with or ahead of most other players on everything the coach checks.",
              )}
        </Text>
      )}
    </Column>
  )
  const keepDoing = (
    <Column>
      <ColumnTitle $tone='good'>{t('myStats.coach.keepDoing', 'Keep doing')}</ColumnTitle>
      {bucket.strengths.length ? (
        <CardsGrid>
          {bucket.strengths.map(finding => (
            <FindingCard key={finding.key} finding={finding} />
          ))}
        </CardsGrid>
      ) : (
        <Text>{t('myStats.coach.noStrengths', 'Nothing clearly ahead of other players yet.')}</Text>
      )}
    </Column>
  )

  return (
    <ComparePanel>
      <Column>
        <TitleLine>
          <PanelTitle>
            <TitleRace>
              <RaceTag race={bucket.race} />
              {t('myStats.coach.compareWithRace', 'How you compare with other {{race}} players', {
                race,
              })}
            </TitleRace>
          </PanelTitle>
          <TitleNote>
            {t('myStats.coach.againstWhere', '{{where}}, over {{floor}} EAPM', {
              where: getPoolPlace(bucket, t),
              floor: eapmFloor,
            })}
          </TitleNote>
        </TitleLine>
        <About>{source.join(' ')}</About>
      </Column>
      {bucket.gaps.length && bucket.strengths.length ? (
        <Columns>
          {workOn}
          {keepDoing}
        </Columns>
      ) : (
        <>
          {bucket.gaps.length ? workOn : keepDoing}
          {bucket.gaps.length ? keepDoing : workOn}
        </>
      )}
      {bucket.compared.length ? (
        <Column>
          <ColumnTitle>
            <HelpLabel
              label={t('myStats.coach.everything', 'Everything compared')}
              help={t(
                'myStats.coach.everythingHelp',
                "Every number the coach had enough games to compare, with your typical game, theirs, and the share of players you did better than. Green and red mark where you're clearly ahead or behind; the lists above only keep the ones that hold up in most of your games.",
              )}
            />
          </ColumnTitle>
          <ComparedTable findings={bucket.compared} />
          {bucket.compared.some(f => getMetricGroup(f.key) === 'speed') ? (
            <Text>
              {t(
                'myStats.coach.speedAnyEapm',
                'Speed is compared with every {{race}} player here, at any EAPM, since a floor would only keep the fast ones.',
                { race },
              )}
            </Text>
          ) : null}
        </Column>
      ) : null}
      <Columns>
        <Column>
          <ColumnTitle>
            <HelpLabel
              label={t('myStats.coach.lossesTitle', 'What changes in your losses')}
              help={t(
                'myStats.coach.lossesHelp',
                "Every number from the first 8 minutes, in your typical win and your typical loss. Red marks the ones that differ enough to matter, biggest first. They go together with losing, which doesn't mean they cause it.",
              )}
            />
          </ColumnTitle>
          {losses}
        </Column>
        <Column>
          <ColumnTitle>
            <HelpLabel
              label={t('myStats.coach.timingsTitle', 'Timings')}
              help={t(
                'myStats.coach.timingsHelp',
                "When you and other players usually start each building, tech and upgrade in the first 15 minutes, in build order. A dash means that side makes it in too few games. Bold: both sides usually make it, and the times are 15 seconds or more apart. Upgrade buildings and static defense are never bold, since they follow the plan. Earlier isn't always better: it depends on your build.",
              )}
            />
          </ColumnTitle>
          {bucket.timings.length ? (
            <TimingsTable timings={bucket.timings} />
          ) : (
            <Text>
              {t(
                'myStats.coach.noTimings',
                'No builds started in the first 15 minutes in enough of these games.',
              )}
            </Text>
          )}
        </Column>
      </Columns>
    </ComparePanel>
  )
}

function BucketView({
  bucket,
  eapmFloor,
  sinceMs,
  showTitle,
}: {
  bucket: CoachBucket
  eapmFloor: number
  sinceMs?: number
  showTitle: boolean
}) {
  const { t } = useTranslation()
  const ready = isReady(bucket)
  // Goals can come from the user's own wins and earlier games, before there are enough other
  // players to compare with.
  const showNextGame = ready || bucket.goals.length > 0
  const title = getBucketTitle(bucket, t)

  const where = {
    count: bucket.userGames,
    race: raceCharToLabel(bucket.race, t),
    where: getPoolPlace(bucket, t),
  }
  const about = [
    sinceMs === undefined
      ? t('myStats.coach.lookingAtAll', 'All {{count}} of your {{race}} games in {{where}}.', where)
      : t(
          'myStats.coach.lookingAtSince',
          'Your last {{count}} {{race}} games in {{where}}, since {{date}}.',
          { ...where, date: formatDate(sinceMs) },
        ),
  ]
  if (bucket.skippedGames) {
    about.push(
      t('myStats.coach.skippedQuit', {
        defaultValue:
          '{{count}} more of yours are left out, since someone quit in the first 5 minutes.',
        defaultValue_one:
          '{{count}} more of yours is left out, since someone quit in the first 5 minutes.',
        count: bucket.skippedGames,
      }),
    )
  }
  if (bucket.opening.length) {
    about.push(
      t('myStats.coach.opening', 'Your usual opening: {{opening}}.', {
        opening: bucket.opening.map(key => getBuildName(key, t)).join(', '),
      }),
    )
  }

  return (
    <Bucket>
      {showTitle && title ? <BucketTitle>{title}</BucketTitle> : null}
      <About>{about.join(' ')}</About>
      <PlanColumns>
        <SectionErrorBoundary>
          {showNextGame ? (
            <NextGame bucket={bucket} allGames={sinceMs === undefined} />
          ) : (
            <Unlock bucket={bucket} eapmFloor={eapmFloor} />
          )}
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <CoachNotes bucket={bucket} hideStrength={ready} />
        </SectionErrorBoundary>
      </PlanColumns>
      {ready ? (
        <SectionErrorBoundary>
          <Comparison bucket={bucket} eapmFloor={eapmFloor} sinceMs={sinceMs} />
        </SectionErrorBoundary>
      ) : null}
      {showNextGame && !ready ? <Unlock bucket={bucket} eapmFloor={eapmFloor} /> : null}
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
    menuLabel: t(
      'myStats.coach.floorMenuOption',
      'Players over {{floor}} EAPM, here and in My stats',
      {
        floor: value,
      },
    ),
  }))
  return (
    <SegmentMenu
      label={t('myStats.coach.them', 'Them')}
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
          menuLabel: t(
            'myStats.coach.windowFewMonths',
            'Last {{count}} games, since 3 months have fewer',
            { count: autoGames },
          ),
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
function CoachBody({ coach }: { coach: CoachResult }) {
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
  return (
    <>
      {shown.map(bucket => (
        <BucketView
          key={`${bucket.shape}${bucket.mapFamily ?? ''}`}
          bucket={bucket}
          eapmFloor={coach.eapmFloor}
          sinceMs={coach.sinceMs}
          showTitle={shown.length > 1 && bucket.mapFamily !== undefined}
        />
      ))}
      {rest.length ? (
        <Text>
          {t('myStats.coach.tooFew', 'Also {{games}}, too few to compare yet.', {
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
          })}
        </Text>
      ) : null}
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
  const [sentinelRef, stuck] = useStuck()
  const result = coach === 'error' ? undefined : coach
  const pickedShape = useAtomValue(coachLockedShapeAtom)
  const pickedLocked = result?.scopes.some(s => s.shape === pickedShape)
    ? undefined
    : counts.find(c => c.shape === pickedShape)
  const picked = result?.status === 'ready' ? result.scope : undefined
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
        <StuckSentinel ref={sentinelRef} />
        <Toolbar $stuck={stuck}>
          <ShapeMenu scopes={coach.scopes} picked={picked} counts={counts} />
          {picked && !pickedLocked ? (
            <>
              <MapPicker scopes={coach.scopes} picked={picked} />
              {coach.status === 'ready' ? (
                <MapNameMenu maps={coach.maps} picked={coach.mapKey} />
              ) : null}
              <RacePicker scopes={coach.scopes} picked={picked} />
            </>
          ) : null}
          <Spacer />
          {coach.status === 'ready' ? (
            <WindowMenu autoGames={coach.autoGames} autoMonths={coach.autoMonths} />
          ) : null}
          <FloorMenu floor={coach.eapmFloor} />
        </Toolbar>
        {picked && !pickedLocked ? <CoverageLine shape={picked.shape} counts={counts} /> : null}
        {pickedLocked ? <LockedView locked={pickedLocked} /> : <CoachBody coach={coach} />}
      </>
    )
  } else {
    content = <LoadingDotsArea />
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
        <Explainer>
          <ExplainerTop>
            <PanelTitle>{t('myStats.coach.howItWorks', 'How it works')}</PanelTitle>
            <TextButton label={t('common.actions.close', 'Close')} onClick={toggleExplainer} />
          </ExplainerTop>
          <ExplainerList>
            <li>
              {t(
                'myStats.coach.explain1',
                'Your recent games of one kind are compared with other players of your race, from your own replays and the same dates.',
              )}
            </li>
            <li>
              {t(
                'myStats.coach.explain2',
                'Your goals are the few numbers most worth fixing: where you trail most players, where your losses differ from your wins, and builds you start late.',
              )}
            </li>
            <li>
              {t(
                'myStats.coach.explain3',
                "It's a hint, not a rule. Your build may call for something else, and the meta changes what's right.",
              )}
            </li>
          </ExplainerList>
        </Explainer>
      )}
      {content}
    </Root>
  )
}

/** The Coach page, which needs the user's names to tell which games are theirs. */
export function CoachPage() {
  const state = useOwnGamesState()
  const { coach, retry } = useCoach()
  const demo = useDemoPlayer()

  if (!demo && !state) {
    return <LoadingDotsArea />
  }
  if (!demo && state && state !== 'found') {
    return <OwnGamesNeeded state={state} />
  }
  return <CoachView coach={coach} onRetry={retry} />
}
