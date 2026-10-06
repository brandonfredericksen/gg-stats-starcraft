import { TFunction } from 'i18next'
import { useAtom } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { MapFamily } from '../../common/games/map-family'
import { getTechName, getUpgradeName } from '../../common/games/research-types'
import { getUnitTypeInfo } from '../../common/games/unit-types'
import {
  COACH_MIN_POOL_GAMES,
  COACH_MIN_RESULT_GAMES,
  COACH_MIN_USER_GAMES,
  CoachBucket,
  CoachFinding,
  CoachMetricKey,
  CoachResult,
  CoachResultFinding,
  CoachScope,
  CoachTiming,
  CoachUnit,
  EAPM_FLOORS,
} from '../../common/my-stats/coach'
import { raceCharToLabel } from '../../common/races'
import { useStatFormat } from '../games/game-stats-shared'
import { useMyPlayerNames } from '../games/my-player-names'
import { buttonReset } from '../material/button-reset'
import { RaceTag } from '../material/race-tag'
import {
  bodyMedium,
  bodySmall,
  labelLarge,
  labelMedium,
  labelSmall,
  titleLarge,
  titleSmall,
} from '../styles/typography'
import { AnalyzeMine } from './analyze-mine'
import { myStatsFiltersAtom } from './my-stats-data'
import { formatPercent, HelpLabel, PaddedPanel, PanelTitle } from './my-stats-panels'

/** Below this panel width, side by side lists stack. */
const STACK_BELOW_PX = 720

type Tone = 'good' | 'bad'

function toneColor(tone: Tone | undefined) {
  if (tone === 'good') {
    return 'var(--theme-positive)'
  }
  return tone === 'bad' ? 'var(--theme-negative)' : 'var(--theme-on-surface-variant)'
}

const Root = styled(PaddedPanel)`
  container: coach / inline-size;
  gap: 18px;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
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

const Text = styled.p`
  ${bodyMedium};
  margin: 0;
  color: var(--theme-on-surface-variant);
`

/** One row of the kinds of game the user plays most. Ones that don't fit are left out. */
const Scopes = styled.div`
  max-height: 36px;
  overflow: hidden;

  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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

const Bucket = styled.section`
  display: flex;
  flex-direction: column;
  gap: 16px;

  & + & {
    padding-top: 18px;
    border-top: 1px solid var(--theme-outline-variant);
  }
`

const BucketTitle = styled.h3`
  ${titleSmall};
  margin: 0;
`

const Card = styled.div`
  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 12px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-md);
  background-color: var(--theme-container);
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

const Columns = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 20px;
  align-items: start;

  @container coach (width < ${STACK_BELOW_PX}px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const ColumnTitle = styled.h4<{ $tone?: Tone }>`
  ${titleSmall};
  margin: 0;

  display: flex;
  align-items: center;
  gap: 8px;

  ${props =>
    props.$tone
      ? css`
          &::before {
            content: '';
            width: 8px;
            height: 8px;
            border-radius: var(--radius-full);
            background: ${toneColor(props.$tone)};
          }
        `
      : ''}
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

/** The space between columns, inside the cells so each row's line runs unbroken. */
const columnSpace = css<{ $end?: boolean }>`
  ${props => (props.$end ? 'padding-left: 20px;' : '')}
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

const GroupHead = styled.span<{ $end?: boolean }>`
  ${labelMedium};
  padding: 14px 0 6px;
  ${columnSpace};
  color: var(--theme-on-surface-variant);
  font-weight: 700;
  text-align: ${props => (props.$end ? 'right' : 'left')};
`

/** A table laid out as one grid, so every row's columns line up. */
const Table = styled.div<{ $columns: string }>`
  ${bodyMedium};
  display: grid;
  grid-template-columns: ${props => props.$columns};
`

const HeadCell = styled.span<{ $end?: boolean }>`
  ${labelMedium};
  padding-bottom: 6px;
  ${columnSpace};
  color: var(--theme-on-surface-variant);
  text-align: ${props => (props.$end ? 'right' : 'left')};
`

const Cell = styled.span<{ $end?: boolean; $tone?: Tone | 'muted'; $strong?: boolean }>`
  padding: 9px 0;
  ${columnSpace};
  border-top: 1px solid var(--theme-outline-variant);
  text-align: ${props => (props.$end ? 'right' : 'left')};
  font-variant-numeric: tabular-nums;
  color: ${props =>
    props.$tone === 'muted' ? 'var(--theme-on-surface-variant)' : toneColor(props.$tone)};
  ${props =>
    props.$tone === undefined
      ? css`
          color: var(--theme-on-surface);
        `
      : ''}
  ${props =>
    props.$tone === 'bad' || props.$tone === 'good' || props.$strong
      ? css`
          font-weight: 600;
        `
      : ''}
  ${props =>
    props.$strong && props.$tone === 'muted'
      ? css`
          color: var(--theme-on-surface);
        `
      : ''}
`

function getMetricText(key: CoachMetricKey, t: TFunction): [label: string, help: string] {
  const workers = (minute: number): [string, string] => [
    t('myStats.coach.metric.workers', 'Workers at {{minute}} min', { minute }),
    t('myStats.coach.help.workers', 'Finished workers you had at that point.'),
  ]
  const mining = (minute: number): [string, string] => [
    t('myStats.coach.metric.mining', 'Mining at {{minute}} min', { minute }),
    t('myStats.coach.help.mining', 'Minerals and gas you mined in the minute before that point.'),
  ]
  const production = (minute: number): [string, string] => [
    t('myStats.coach.metric.production', 'Production at {{minute}} min', { minute }),
    t(
      'myStats.coach.help.production',
      'Barracks, Factories, Starports, Gateways, Stargates, Robotics Facilities and Hatcheries you had started by then.',
    ),
  ]
  const supply = (amount: number): [string, string] => [
    t('myStats.coach.metric.supply', '{{amount}} supply', { amount }),
    t('myStats.coach.help.supply', 'When you first had that much supply in use.'),
  ]
  const phases = {
    early: t('myStats.coach.phase.early', 'early game'),
    mid: t('myStats.coach.phase.mid', 'mid game'),
    late: t('myStats.coach.phase.late', 'late game'),
  }
  const phaseHelp = t(
    'myStats.coach.help.phases',
    'The early game is up to 6 minutes, the mid game 6 to 12, and the late game after that.',
  )
  const unspent = (phase: keyof typeof phases): [string, string] => [
    t('myStats.coach.metric.unspent', 'Unspent, {{phase}}', { phase: phases[phase] }),
    `${t('myStats.coach.help.unspent', 'Minerals and gas you had banked, on average. Lower means you spent faster.')} ${phaseHelp}`,
  ]
  const apm = (phase: keyof typeof phases): [string, string] => [
    t('myStats.coach.metric.apm', 'APM, {{phase}}', { phase: phases[phase] }),
    `${t('myStats.coach.help.apm', 'Actions per minute, from the replay.')} ${phaseHelp}`,
  ]
  const eapm = (phase: keyof typeof phases): [string, string] => [
    t('myStats.coach.metric.eapmPhase', 'EAPM, {{phase}}', { phase: phases[phase] }),
    `${t('myStats.coach.help.eapmPhase', 'Effective actions per minute: actions that did something, leaving out spam.')} ${phaseHelp}`,
  ]
  const hotkeys = (phase: keyof typeof phases): [string, string] => [
    t('myStats.coach.metric.hotkeys', 'Hotkey use, {{phase}}', { phase: phases[phase] }),
    `${t('myStats.coach.help.hotkeys', 'Times a minute you selected a hotkeyed group, from the replay.')} ${phaseHelp}`,
  ]
  const productionCommands = (phase: keyof typeof phases): [string, string] => [
    t('myStats.coach.metric.productionCommands', 'Production orders, {{phase}}', {
      phase: phases[phase],
    }),
    `${t('myStats.coach.help.productionCommands', 'Times a minute you ordered a unit or building, which shows how steadily you produce.')} ${phaseHelp}`,
  ]
  switch (key) {
    case 'workers4':
      return workers(4)
    case 'workers6':
      return workers(6)
    case 'workers8':
      return workers(8)
    case 'workers10':
      return workers(10)
    case 'income6':
      return mining(6)
    case 'income10':
      return mining(10)
    case 'production6':
      return production(6)
    case 'production8':
      return production(8)
    case 'production10':
      return production(10)
    case 'secondBase':
      return [
        t('myStats.coach.metric.secondBase', 'Second base'),
        t('myStats.coach.help.secondBase', 'When you started your second town hall.'),
      ]
    case 'thirdBase':
      return [
        t('myStats.coach.metric.thirdBase', 'Third base'),
        t('myStats.coach.help.thirdBase', 'When you started your third town hall.'),
      ]
    case 'supply100':
      return supply(100)
    case 'supply150':
      return supply(150)
    case 'supply200':
      return supply(200)
    case 'bankEarly':
      return unspent('early')
    case 'bankMid':
      return unspent('mid')
    case 'bankLate':
      return unspent('late')
    case 'supplyBlocked':
      return [
        t('myStats.coach.metric.supplyBlocked', 'Time supply blocked'),
        t(
          'myStats.help.supplyBlocked',
          "The share of the game you couldn't make units because you were out of supply. The first 3 minutes are left out, since early blocks are often part of a build.",
        ),
      ]
    case 'army7':
    case 'army10':
      return [
        t('myStats.coach.metric.army', 'Army at {{minute}} min', {
          minute: key === 'army7' ? 7 : 10,
        }),
        t('myStats.coach.help.army', "What your army was worth then, in the game's score."),
      ]
    case 'armyTrade':
      return [
        t('myStats.coach.metric.armyTrade', 'Army trades'),
        t(
          'myStats.coach.help.armyTrade',
          "Army you killed for each army you lost, by the game's score. Above 1 means you traded well.",
        ),
      ]
    case 'workersLost':
      return [
        t('myStats.coach.metric.workersLost', 'Workers lost'),
        t('myStats.coach.help.workersLost', 'Workers of yours that died, over the whole game.'),
      ]
    case 'overlordsLost':
      return [
        t('myStats.coach.metric.overlordsLost', 'Overlords lost'),
        t('myStats.coach.help.overlordsLost', 'Overlords of yours that died, over the whole game.'),
      ]
    case 'eapm':
      return [
        t('myStats.coach.metric.eapm', 'EAPM'),
        t(
          'myStats.help.eapm',
          'Effective actions per minute. Like APM, but without spam, like the same order clicked again right away.',
        ),
      ]
    case 'eapmEarly':
      return eapm('early')
    case 'eapmMid':
      return eapm('mid')
    case 'eapmLate':
      return eapm('late')
    case 'apmEarly':
      return apm('early')
    case 'apmMid':
      return apm('mid')
    case 'apmLate':
      return apm('late')
    case 'hotkeysEarly':
      return hotkeys('early')
    case 'hotkeysMid':
      return hotkeys('mid')
    case 'hotkeysLate':
      return hotkeys('late')
    case 'productionCommandsMid':
      return productionCommands('mid')
    case 'productionCommandsLate':
      return productionCommands('late')
  }
  return [key, '']
}

function useFormatValue() {
  const { t } = useTranslation()
  const format = useStatFormat()
  return (value: number, unit: CoachUnit) => {
    const number = (n: number) =>
      Math.abs(n) < 10 && !Number.isInteger(n) ? n.toFixed(1) : format.format(n)
    switch (unit) {
      case 'time':
        return formatGameTime(value)
      case 'share':
        return `${(value * 100).toFixed(1)}%`
      case 'ratio':
        return value.toFixed(2)
      case 'perMinute':
        return t('myStats.macro.perMinute', '{{amount}} a min', { amount: number(value) })
      default:
        return number(value)
    }
  }
}

function getBuildName(buildKey: string, t: TFunction) {
  const [, kind, id, level] = /^([utg])(\d+)(?:\.(\d+))?$/.exec(buildKey) ?? []
  switch (kind) {
    case 'u':
      return getUnitTypeInfo(Number(id), t).name
    case 't':
      return getTechName(Number(id), t)
    case 'g':
      return `${getUpgradeName(Number(id), t)} +${level}`
    default:
      return buildKey
  }
}

/** A time in the game as minutes and seconds, like 4:05. */
function formatGameTime(ms: number) {
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** How far apart two times are: seconds under a minute, like 40s, then 1:05. */
function formatTimeDiff(ms: number, t: TFunction) {
  const seconds = Math.round(ms / 1000)
  return seconds < 60
    ? t('myStats.coach.seconds', '{{count}}s', { count: seconds })
    : formatGameTime(ms)
}

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

function getMapFamilyShortName(family: MapFamily, t: TFunction) {
  switch (family) {
    case 'bgh':
      return t('myStats.filters.bghShort', 'BGH')
    case 'fastest':
      return t('myStats.filters.fastest', 'Fastest')
    case 'standard':
      return t('myStats.filters.otherMapsShort', 'other maps')
    default:
      return family satisfies never
  }
}

function getScopeName(scope: CoachScope, t: TFunction) {
  const race = raceCharToLabel(scope.race, t)
  if (scope.mapFamily) {
    return t('myStats.coach.scopeTeamMap', '{{race}} in {{shape}} on {{map}}', {
      race,
      shape: scope.shape,
      map: getMapFamilyShortName(scope.mapFamily, t),
    })
  }
  if (scope.opponentRace) {
    return t('myStats.coach.scope1v1', '{{race}} against {{opponent}}', {
      race,
      opponent: raceCharToLabel(scope.opponentRace, t),
    })
  }
  return t('myStats.coach.scopeTeam', '{{race}} in {{shape}}', {
    race,
    shape: scope.shape === 'ffa' ? t('myStats.ffa', 'FFA') : scope.shape,
  })
}

/**
 * The kinds of game the user plays most, one click each. Picking one sets the page's filters, so
 * the rest of the page shows the same games the coach looks at.
 */
function ScopePicker({ scopes }: { scopes: ReadonlyArray<CoachScope> }) {
  const { t } = useTranslation()
  const [filters, setFilters] = useAtom(myStatsFiltersAtom)

  return (
    <Scopes role='group' aria-label={t('myStats.coach.scopes', 'Your games to look at')}>
      {scopes.map(scope => {
        const selected =
          filters.shape === scope.shape &&
          filters.race === scope.race &&
          (scope.shape !== '1v1' || filters.opponentRace === scope.opponentRace) &&
          filters.mapFamily === scope.mapFamily
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
              setFilters(f => ({
                ...f,
                shape: scope.shape,
                race: scope.race,
                opponentRace: scope.opponentRace,
                mapFamily: scope.mapFamily,
              }))
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
    </Scopes>
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

type MetricGroup = 'economy' | 'growth' | 'spending' | 'fights' | 'speed'

function getMetricGroup(key: CoachMetricKey): MetricGroup {
  if (key.startsWith('workers') && key !== 'workersLost') {
    return 'economy'
  }
  if (key.startsWith('income')) {
    return 'economy'
  }
  if (key.startsWith('production') && !key.startsWith('productionCommands')) {
    return 'growth'
  }
  if (
    key === 'secondBase' ||
    key === 'thirdBase' ||
    key.startsWith('supply1') ||
    key === 'supply200'
  ) {
    return 'growth'
  }
  if (key.startsWith('bank') || key === 'supplyBlocked') {
    return 'spending'
  }
  if (key.startsWith('army') || key === 'workersLost' || key === 'overlordsLost') {
    return 'fights'
  }
  return 'speed'
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

/** How far the user is from enough games to compare, with a way to get there. */
function Unlock({ bucket, eapmFloor }: { bucket: CoachBucket; eapmFloor: number }) {
  const { t } = useTranslation()
  const names = useMyPlayerNames() ?? []
  const [filters] = useAtom(myStatsFiltersAtom)
  const userShort = Math.max(0, COACH_MIN_USER_GAMES - bucket.userGames)
  const poolShort = bucket.poolGames < COACH_MIN_POOL_GAMES
  const progressText = (count: number, needed: number) =>
    count >= needed
      ? t('myStats.coach.progressEnough', '{{count}}, enough', { count })
      : t('myStats.coach.progress', '{{count}} of {{needed}}', { count, needed })

  return (
    <Card>
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
        <AnalyzeMine names={names} filters={filters} />
      </UnlockActions>
    </Card>
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
  const ready = bucket.userGames >= COACH_MIN_USER_GAMES && bucket.poolGames >= COACH_MIN_POOL_GAMES
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
    <Bucket>
      {showTitle && title ? <BucketTitle>{title}</BucketTitle> : null}
      <Text>{about.join(' ')}</Text>
      {ready ? (
        <>
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
        </>
      ) : (
        <Unlock bucket={bucket} eapmFloor={eapmFloor} />
      )}
    </Bucket>
  )
}

/**
 * The experimental coach: what the user does worse and better than other players of their race in
 * the same kind of game, from every replay they've analyzed.
 */
export function CoachPanel({ coach }: { coach: CoachResult }) {
  const { t } = useTranslation()
  const names = useMyPlayerNames() ?? []
  const [filters] = useAtom(myStatsFiltersAtom)

  let body: React.ReactNode
  if (coach.status === 'pickFilters') {
    body = coach.scopes.length ? (
      <Text>
        {t(
          'myStats.coach.pick',
          "Pick one of the kinds of game you play, and the coach shows where you're behind other players and where you're ahead.",
        )}
      </Text>
    ) : (
      <>
        <Text>
          {t(
            'myStats.coach.nothingToPick',
            'None of your analyzed games can be compared yet. Analyze a few more of yours.',
          )}
        </Text>
        <UnlockActions>
          <AnalyzeMine names={names} filters={filters} />
        </UnlockActions>
      </>
    )
  } else if (coach.buckets.length) {
    // Every group that's ready gets its own section. Short of that, only the biggest does, so a
    // stray game on another kind of map doesn't get a whole section to itself. Buckets come
    // biggest first.
    const ready = coach.buckets.filter(isReady)
    const shown = ready.length ? ready : coach.buckets.slice(0, 1)
    const rest = coach.buckets.filter(bucket => !shown.includes(bucket))
    body = (
      <>
        {shown.map(bucket => (
          <BucketView
            key={`${bucket.shape}${bucket.mapFamily ?? ''}`}
            bucket={bucket}
            eapmFloor={coach.eapmFloor}
            showTitle={bucket.mapFamily !== undefined}
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
  } else {
    body = (
      <>
        <Text>
          {t('myStats.coach.noneOfKind', 'None of your analyzed games are of this kind yet.')}
        </Text>
        <UnlockActions>
          <AnalyzeMine names={names} filters={filters} />
        </UnlockActions>
      </>
    )
  }

  return (
    <Root>
      <Header>
        <PanelTitle>{t('myStats.coach.title', 'Coach')}</PanelTitle>
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
      {coach.scopes.length ? <ScopePicker scopes={coach.scopes} /> : null}
      {body}
    </Root>
  )
}
