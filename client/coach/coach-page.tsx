import { TFunction } from 'i18next'
import { useSetAtom } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  COACH_MIN_POOL_GAMES,
  COACH_MIN_RESULT_GAMES,
  COACH_MIN_USER_GAMES,
  CoachBucket,
  CoachFinding,
  CoachResult,
  CoachResultFinding,
  CoachScope,
  CoachTiming,
  EAPM_FLOORS,
} from '../../common/my-stats/coach'
import { raceCharToLabel } from '../../common/races'
import { SectionErrorBoundary } from '../games/game-stats-shared'
import { useMyPlayerNames } from '../games/my-player-names'
import { buttonReset } from '../material/button-reset'
import { RaceTag } from '../material/race-tag'
import { SegmentMenu, SegmentOption } from '../material/segmented'
import { AnalyzeMine } from '../my-stats/analyze-mine'
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
import { coachScopeAtom, useCoach, useEapmFloor } from './coach-data'
import { CoachNotes, NextGame, RecentForm } from './coach-plan'
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

const HowItWorks = styled.span`
  ${labelLarge};
  margin-left: auto;
  color: var(--theme-on-surface-variant);
`

/** The kinds of game to coach, and who to compare with. */
const Toolbar = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
`

/** Every kind of game the user plays, wrapping onto more rows as needed. */
const Scopes = styled.div`
  flex: 1;
  min-width: 0;

  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
  align-items: start;

  @container coach (width < 880px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const ComparePanel = styled(PaddedPanel)`
  gap: 18px;
`

const Message = styled(PaddedPanel)`
  padding: 24px;
  gap: 12px;
`

const ScopeChip = styled.button<{ $selected: boolean }>`
  ${buttonReset};
  ${labelLarge};
  height: 36px;
  padding: 0 14px 0 10px;

  display: inline-flex;
  align-items: center;
  gap: 6px;

  border: 1px solid
    ${props => (props.$selected ? 'var(--theme-outline)' : 'var(--theme-outline-variant)')};
  border-radius: var(--radius-full);
  background-color: ${props =>
    props.$selected ? 'var(--theme-container-highest)' : 'transparent'};
  color: var(--theme-on-surface);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background-color: ${props =>
      props.$selected ? 'var(--theme-container-highest)' : 'var(--theme-container)'};
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const ScopeCount = styled.span`
  margin-left: 4px;
  color: var(--theme-on-surface-variant);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
`

const UnlockTitle = styled.h4`
  ${titleSmall};
  margin: 0;
`

const Progress = styled.div`
  ${bodyMedium};
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr) 100px;
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

  border: 2px solid var(--theme-container);
  border-radius: var(--radius-full);
  background: ${props => toneColor(props.$tone)};
`

const StandingMiddle = styled.span`
  position: absolute;
  top: -3px;
  bottom: -3px;
  left: 50%;
  width: 2px;
  margin-left: -1px;
  background: var(--theme-outline);
`

/** A small version of the standing bar, for a table row. */
const MiniStanding = styled.span`
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

function isReady(bucket: CoachBucket) {
  return bucket.userGames >= COACH_MIN_USER_GAMES && bucket.poolGames >= COACH_MIN_POOL_GAMES
}

/** Every kind of game the user plays enough of, one click each, with the coached one picked. */
function ScopePicker({
  scopes,
  picked,
}: {
  scopes: ReadonlyArray<CoachScope>
  picked: Omit<CoachScope, 'games'> | undefined
}) {
  const { t } = useTranslation()
  const setScope = useSetAtom(coachScopeAtom)

  return (
    <>
      {scopes.map(scope => {
        const selected =
          picked?.shape === scope.shape &&
          picked.race === scope.race &&
          picked.opponentRace === scope.opponentRace &&
          picked.mapFamily === scope.mapFamily
        return (
          <ScopeChip
            key={`${scope.shape}${scope.race}${scope.opponentRace ?? ''}${scope.mapFamily ?? ''}`}
            type='button'
            $selected={selected}
            aria-pressed={selected}
            aria-label={t('myStats.coach.scopeLabel', {
              defaultValue: '{{name}}, {{count}} games',
              defaultValue_one: '{{name}}, {{count}} game',
              name: getScopeName(scope, t),
              count: scope.games,
            })}
            onClick={() =>
              setScope({
                shape: scope.shape,
                race: scope.race,
                opponentRace: scope.opponentRace,
                mapFamily: scope.mapFamily,
              })
            }>
            <RaceTag race={scope.race} />
            {scope.opponentRace ? (
              <>
                {t('myStats.vs', 'vs')}
                <RaceTag race={scope.opponentRace} />
              </>
            ) : (
              <span>{scope.shape === 'ffa' ? t('myStats.ffa', 'FFA') : scope.shape}</span>
            )}
            {scope.mapFamily ? <span>{getMapFamilyShortName(scope.mapFamily, t)}</span> : null}
            <ScopeCount>
              {t('myStats.coach.scopeGames', {
                defaultValue: '{{count}} games',
                defaultValue_one: '{{count}} game',
                count: scope.games,
              })}
            </ScopeCount>
          </ScopeChip>
        )
      })}
    </>
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
          <Caption>{t('myStats.coach.youTypically', 'You, typically')}</Caption>
        </NumberBlock>
        <NumberBlock>
          <Big>{formatValue(finding.poolValue, finding.unit)}</Big>
          <Caption>{t('myStats.coach.themTypically', 'Them, typically')}</Caption>
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
}: {
  title: string
  findings: ReadonlyArray<CoachFinding>
}) {
  const { t } = useTranslation()
  const formatValue = useFormatValue()
  return (
    <>
      <GroupHead>{title}</GroupHead>
      <GroupHead $end={true}>{t('myStats.coach.you', 'You')}</GroupHead>
      <GroupHead $end={true}>{t('myStats.coach.them', 'Them')}</GroupHead>
      <GroupHead $end={true}>{t('myStats.coach.betterThan', 'Better than')}</GroupHead>
      {findings.map(finding => {
        const [label, help] = getMetricText(finding.key, t)
        const tone = getStandingTone(finding.beats)
        return [
          <Cell key={`${finding.key}-label`}>
            <HelpLabel
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
        <Table key={groups.join()} $columns='minmax(0, 1fr) auto auto auto'>
          {groups.map(group => {
            const inGroup = findings.filter(f => getMetricGroup(f.key) === group)
            return inGroup.length ? (
              <ComparedGroup key={group} title={titles[group]} findings={inGroup} />
            ) : null
          })}
        </Table>
      ))}
    </Columns>
  )
}

function LossesTable({ findings }: { findings: ReadonlyArray<CoachResultFinding> }) {
  const { t } = useTranslation()
  const formatValue = useFormatValue()
  return (
    <Table $columns='minmax(0, 1fr) auto auto'>
      <HeadCell>{t('myStats.coach.number', 'Number')}</HeadCell>
      <HeadCell $end={true}>{t('myStats.coach.inWinsHead', 'In wins')}</HeadCell>
      <HeadCell $end={true}>{t('myStats.coach.inLossesHead', 'In losses')}</HeadCell>
      {findings.map(finding => {
        const [label, help] = getMetricText(finding.key, t)
        return [
          <Cell key={`${finding.key}-label`}>
            <HelpLabel label={label} help={help} />
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
    <Table $columns='minmax(0, 1fr) auto auto auto'>
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
  const names = useMyPlayerNames() ?? []
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
function Comparison({ bucket }: { bucket: CoachBucket }) {
  const { t } = useTranslation()

  let losses: React.ReactNode
  if (bucket.inLosses.length) {
    losses = <LossesTable findings={bucket.inLosses} />
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
          "These games don't have numbers from the first 8 minutes to compare.",
        )}
      </Text>
    )
  }

  return (
    <ComparePanel>
      <PanelTitle>
        {t('myStats.coach.againstOthers', 'Against other {{race}} players', {
          race: raceCharToLabel(bucket.race, t),
        })}
      </PanelTitle>
      <Columns>
        <Column>
          <ColumnTitle $tone='bad'>{t('myStats.coach.workOn', 'Work on')}</ColumnTitle>
          {bucket.gaps.length ? (
            bucket.gaps.map(finding => <FindingCard key={finding.key} finding={finding} />)
          ) : (
            <Text>
              {t(
                'myStats.coach.noGaps',
                "Nothing stands out. You're close to other players on everything the coach checks.",
              )}
            </Text>
          )}
        </Column>
        <Column>
          <ColumnTitle $tone='good'>{t('myStats.coach.keepDoing', 'Keep doing')}</ColumnTitle>
          {bucket.strengths.length ? (
            bucket.strengths.map(finding => <FindingCard key={finding.key} finding={finding} />)
          ) : (
            <Text>
              {t('myStats.coach.noStrengths', 'Nothing clearly ahead of other players yet.')}
            </Text>
          )}
        </Column>
      </Columns>
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
                "When you and other players usually start each building, tech and upgrade in the first 15 minutes, in build order. A dash means that side makes it in too few games. Bold differences are far enough apart to matter. Earlier isn't always better: it depends on your build.",
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
  showTitle,
}: {
  bucket: CoachBucket
  eapmFloor: number
  showTitle: boolean
}) {
  const { t } = useTranslation()
  const ready = isReady(bucket)
  // Goals can come from the user's own wins and earlier games, before there are enough other
  // players to compare with.
  const showNextGame = ready || bucket.goals.length > 0
  const title = getBucketTitle(bucket, t)

  const about = [
    t(
      'myStats.coach.about',
      '{{userGames}} of your games, compared with {{poolGames}} games of other {{race}} players over {{floor}} EAPM.',
      {
        userGames: bucket.userGames,
        poolGames: bucket.poolGames,
        race: raceCharToLabel(bucket.race, t),
        floor: eapmFloor,
      },
    ),
  ]
  if (bucket.skippedGames) {
    about.push(
      t('myStats.coach.skipped', {
        defaultValue:
          '{{count}} more of yours are left out, since someone left in the first 5 minutes.',
        defaultValue_one:
          '{{count}} more of yours is left out, since someone left in the first 5 minutes.',
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
      <Text>{about.join(' ')}</Text>
      <PlanColumns>
        <SectionErrorBoundary>
          {showNextGame ? (
            <NextGame bucket={bucket} />
          ) : (
            <Unlock bucket={bucket} eapmFloor={eapmFloor} />
          )}
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <CoachNotes bucket={bucket} />
        </SectionErrorBoundary>
      </PlanColumns>
      <SectionErrorBoundary>
        <RecentForm bucket={bucket} />
      </SectionErrorBoundary>
      {ready ? (
        <SectionErrorBoundary>
          <Comparison bucket={bucket} />
        </SectionErrorBoundary>
      ) : null}
      {showNextGame && !ready ? <Unlock bucket={bucket} eapmFloor={eapmFloor} /> : null}
    </Bucket>
  )
}

/** Who the coach compares the user with, picked by EAPM. My stats compares with the same players. */
function FloorMenu() {
  const { t } = useTranslation()
  const setFilters = useSetAtom(myStatsFiltersAtom)
  const floor = useEapmFloor()
  const floors: Array<SegmentOption<number>> = EAPM_FLOORS.map(value => ({
    value,
    label: t('myStats.filters.floorOption', '{{floor}}+ EAPM', { floor: value }),
  }))
  return (
    <SegmentMenu
      label={t('myStats.filters.floor', 'Compared with')}
      showLabel={false}
      options={floors}
      value={floor}
      onChange={eapmFloor => setFilters(f => ({ ...f, eapmFloor }))}
    />
  )
}

/** Every group of the coached kind of game that's ready, then the rest in a line. */
function CoachBody({ coach }: { coach: CoachResult }) {
  const { t } = useTranslation()
  const names = useMyPlayerNames() ?? []

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

/**
 * The experimental coach: what to work on in the next game, how the user has played lately, and
 * where they stand against other players of their race in the same kind of game.
 */
export function CoachView({ coach }: { coach: CoachResult | undefined }) {
  const { t } = useTranslation()
  return (
    <Root>
      <Header>
        <Title>{t('myStats.coach.title', 'Coach')}</Title>
        <Badge>{t('myStats.coach.experimental', 'Experimental')}</Badge>
        <HowItWorks>
          <HelpLabel
            label={t('myStats.coach.howItWorks', 'How it works')}
            help={t(
              'myStats.coach.intro',
              "Compares your games with other players of your race in the same kind of game, from every replay you've analyzed. It only points out differences that show up in most of your games. Treat it as a hint, not a rule: builds and the meta change what's right.",
            )}
          />
        </HowItWorks>
      </Header>
      {coach ? (
        <>
          <Toolbar>
            <Scopes role='group' aria-label={t('myStats.coach.scopes', 'Your games to look at')}>
              <ScopePicker
                scopes={coach.scopes}
                picked={coach.status === 'ready' ? coach.scope : undefined}
              />
            </Scopes>
            <FloorMenu />
          </Toolbar>
          <CoachBody coach={coach} />
        </>
      ) : (
        <LoadingDotsArea />
      )}
    </Root>
  )
}

/** The Coach page, which needs the user's names to tell which games are theirs. */
export function CoachPage() {
  const state = useOwnGamesState()
  const coach = useCoach()

  if (!state) {
    return <LoadingDotsArea />
  }
  if (state !== 'found') {
    return <OwnGamesNeeded state={state} />
  }
  return <CoachView coach={coach} />
}
