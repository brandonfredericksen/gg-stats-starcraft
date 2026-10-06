import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { MapFamily } from '../../common/games/map-family'
import { getTechName, getUpgradeName } from '../../common/games/research-types'
import { getUnitTypeInfo } from '../../common/games/unit-types'
import { CoachMetricKey, CoachScope, CoachUnit } from '../../common/my-stats/coach'
import { AssignedRaceChar, raceCharToLabel } from '../../common/races'
import { useStatFormat } from '../games/game-stats-shared'
import { bodyMedium, labelMedium, titleSmall } from '../styles/typography'

/** Below this panel width, side by side lists stack. */
const STACK_BELOW_PX = 720

export type Tone = 'good' | 'bad'

export function toneColor(tone: Tone | undefined) {
  if (tone === 'good') {
    return 'var(--theme-positive)'
  }
  return tone === 'bad' ? 'var(--theme-negative)' : 'var(--theme-on-surface-variant)'
}

export const Text = styled.p`
  ${bodyMedium};
  margin: 0;
  color: var(--theme-on-surface-variant);
`

export const Card = styled.div`
  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 12px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-md);
  background-color: var(--theme-container);
`

export const Columns = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 20px;
  align-items: start;

  @container coach (width < ${STACK_BELOW_PX}px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

export const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

export const ColumnTitle = styled.h4<{ $tone?: Tone }>`
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

/** The space between columns, inside the cells so each row's line runs unbroken. */
const columnSpace = css<{ $end?: boolean }>`
  ${props => (props.$end ? 'padding-left: 20px;' : '')}
`

export const GroupHead = styled.span<{ $end?: boolean }>`
  ${labelMedium};
  padding: 14px 0 6px;
  ${columnSpace};
  color: var(--theme-on-surface-variant);
  font-weight: 700;
  text-align: ${props => (props.$end ? 'right' : 'left')};
`

/** A table laid out as one grid, so every row's columns line up. */
export const Table = styled.div<{ $columns: string }>`
  ${bodyMedium};
  display: grid;
  grid-template-columns: ${props => props.$columns};
`

export const HeadCell = styled.span<{ $end?: boolean }>`
  ${labelMedium};
  padding-bottom: 6px;
  ${columnSpace};
  color: var(--theme-on-surface-variant);
  text-align: ${props => (props.$end ? 'right' : 'left')};
`

export const Cell = styled.span<{ $end?: boolean; $tone?: Tone | 'muted'; $strong?: boolean }>`
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

export function getMetricText(key: CoachMetricKey, t: TFunction): [label: string, help: string] {
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

export function useFormatValue() {
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

export function getBuildName(buildKey: string, t: TFunction) {
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
export function formatGameTime(ms: number) {
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** How far apart two times are: seconds under a minute, like 40s, then 1:05. */
export function formatTimeDiff(ms: number, t: TFunction) {
  const seconds = Math.round(ms / 1000)
  return seconds < 60
    ? t('myStats.coach.seconds', '{{count}}s', { count: seconds })
    : formatGameTime(ms)
}

export function getMapFamilyShortName(family: MapFamily, t: TFunction) {
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

export function getScopeName(scope: Omit<CoachScope, 'games'>, t: TFunction) {
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

export type MetricGroup = 'economy' | 'growth' | 'spending' | 'fights' | 'speed'

export function getMetricGroup(key: CoachMetricKey): MetricGroup {
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

/** The race's own words for what the tips talk about. */
function getRaceWords(race: AssignedRaceChar, t: TFunction) {
  switch (race) {
    case 't':
      return {
        workers: t('myStats.coach.words.scvs', 'SCVs'),
        townHalls: t('myStats.coach.words.commandCenters', 'Command Centers'),
        townHall: t('myStats.coach.words.commandCenter', 'Command Center'),
        supply: t('myStats.coach.words.depots', 'Supply Depots'),
        production: t('myStats.coach.words.barracksFactories', 'Barracks and Factories'),
      }
    case 'p':
      return {
        workers: t('myStats.coach.words.probes', 'Probes'),
        townHalls: t('myStats.coach.words.nexuses', 'Nexuses'),
        townHall: t('myStats.coach.words.nexus', 'Nexus'),
        supply: t('myStats.coach.words.pylons', 'Pylons'),
        production: t('myStats.coach.words.gateways', 'Gateways'),
      }
    case 'z':
      return {
        workers: t('myStats.coach.words.drones', 'Drones'),
        townHalls: t('myStats.coach.words.hatcheries', 'Hatcheries'),
        townHall: t('myStats.coach.words.hatchery', 'Hatchery'),
        supply: t('myStats.coach.words.overlords', 'Overlords'),
        production: t('myStats.coach.words.hatcheriesProduction', 'Hatcheries'),
      }
    default:
      return race satisfies never
  }
}

/** What to do about a number, the way a coach would put it. */
export function getTip(key: CoachMetricKey, race: AssignedRaceChar, t: TFunction): string {
  const words = getRaceWords(race, t)
  switch (getMetricFamily(key)) {
    case 'workers':
      return t(
        'myStats.coach.tip.workers',
        'Keep your {{townHalls}} making {{workers}} without a break. Queue one or two, and check on them every time you cycle through your hotkeys.',
        words,
      )
    case 'income':
      return t(
        'myStats.coach.tip.income',
        'Mining follows workers and bases. Fill each base with {{workers}}, take your gas on time, and expand before your main runs dry.',
        words,
      )
    case 'production':
      return t(
        'myStats.coach.tip.production',
        'Add {{production}} sooner, so your money turns into units instead of sitting in the bank.',
        words,
      )
    case 'base':
      return t(
        'myStats.coach.tip.base',
        'Plan your next {{townHall}} at a set supply in your build, and take it even when you feel unsafe. A late base holds back everything after it.',
        words,
      )
    case 'supply':
      return t(
        'myStats.coach.tip.supply',
        'To max out sooner, keep making {{workers}} and add production as your income grows.',
        words,
      )
    case 'bank':
      return t(
        'myStats.coach.tip.bank',
        'When money piles up, spend it right away: queue units, add {{production}}, or take another base.',
        words,
      )
    case 'supplyBlocked':
      return t(
        'myStats.coach.tip.supplyBlocked',
        'Build {{supply}} ahead of time. Start one whenever you get within about 8 supply of your cap, and two at once once you have a lot of production.',
        words,
      )
    case 'army':
      return t(
        'myStats.coach.tip.army',
        'Your army is smaller than most at this point. Keep every production building busy and spend your money on units.',
        words,
      )
    case 'armyTrade':
      return t(
        'myStats.coach.tip.armyTrade',
        "You lose more than you kill in fights. Fight where your units are strong, wait for your upgrades, and pull back from fights you're losing.",
        words,
      )
    case 'workersLost':
      return t(
        'myStats.coach.tip.workersLost',
        'Protect your mineral lines. Keep a few units or some static defense near them, and pull {{workers}} away when harass comes.',
        words,
      )
    case 'overlordsLost':
      return t(
        'myStats.coach.tip.overlordsLost',
        "Spread your Overlords out, away from the paths your opponent's army and air units take.",
        words,
      )
    case 'eapm':
    case 'apm':
      return t(
        'myStats.coach.tip.speed',
        "Speed comes from habits. Cycle through your bases and production with hotkeys, even when nothing's happening.",
        words,
      )
    case 'hotkeys':
      return t(
        'myStats.coach.tip.hotkeys',
        'Put your army and your production on hotkeys, and use them instead of clicking on the screen.',
        words,
      )
    case 'productionCommands':
      return t(
        'myStats.coach.tip.productionCommands',
        'Produce more steadily: check every production building each time you cycle through your hotkeys.',
        words,
      )
    default:
      return ''
  }
}

/**
 * Numbers that come from the same thing, like workers at 6 and at 8 minutes, which share a tip.
 */
function getMetricFamily(key: CoachMetricKey) {
  return key.endsWith('Base') ? 'base' : key.replace(/(\d+|Early|Mid|Late)$/, '')
}

/**
 * A target to reach, rounded the way that still reaches it: up for numbers where more is better,
 * down where less is.
 */
export function roundTarget(value: number, unit: CoachUnit, higherIsBetter: boolean) {
  if (unit !== 'count' && unit !== 'perMinute') {
    return value
  }
  if (Math.abs(value) < 10) {
    const tenths = value * 10
    return (higherIsBetter ? Math.ceil(tenths) : Math.floor(tenths)) / 10
  }
  return higherIsBetter ? Math.ceil(value) : Math.floor(value)
}
