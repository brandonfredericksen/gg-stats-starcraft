import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { MapFamily } from '../../common/games/map-family'
import { getTechName, getUpgradeName } from '../../common/games/research-types'
import { getUnitTypeInfo } from '../../common/games/unit-types'
import {
  CoachGoalBasis,
  CoachMetricKey,
  CoachScope,
  CoachUnit,
  getMetricFamily,
} from '../../common/my-stats/coach'
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
  gap: var(--space-4) var(--space-5);
  align-items: start;

  @container coach (width < ${STACK_BELOW_PX}px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

export const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
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

/** A table's heading row, or a group's within one: the first group sits flush with the top. */
export const GroupHead = styled.span<{ $end?: boolean; $first?: boolean }>`
  ${labelMedium};
  padding: ${props => (props.$first ? '0 0 var(--space-2)' : 'var(--space-5) 0 var(--space-2)')};
  ${columnSpace};
  color: var(--theme-on-surface-variant);
  font-weight: 600;
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
  padding-bottom: var(--space-2);
  ${columnSpace};
  color: var(--theme-on-surface-variant);
  font-weight: 600;
  white-space: nowrap;
  text-align: ${props => (props.$end ? 'right' : 'left')};
`

export const Cell = styled.span<{ $end?: boolean; $tone?: Tone | 'muted'; $strong?: boolean }>`
  padding: 10px 0;
  ${columnSpace};
  border-top: 1px solid var(--theme-outline-variant);
  text-align: ${props => (props.$end ? 'right' : 'left')};
  font-variant-numeric: tabular-nums;
  /* A number and its unit stay on one line; only a row's name wraps. */
  ${props => (props.$end ? 'white-space: nowrap;' : '')}
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
    t('myStats.coach.metric.unitsPerBuilding', 'Units queued per production building, {{phase}}', {
      phase: phases[phase],
    }),
    `${t('myStats.coach.help.productionPerBuilding', "Times a minute you ordered an army unit, for each production building you had, which shows how often they sat idle. Workers and Overlords don't count.")} ${phaseHelp}`,
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
    case 'workers12':
      return workers(12)
    case 'workers15':
      return workers(15)
    case 'larvaeFull10':
      return [
        t('myStats.coach.metric.larvaeFull', 'Hatcheries full of larvae, first 10 min'),
        t(
          'myStats.coach.help.larvaeFull',
          'The share of the first 10 minutes your Hatcheries, Lairs and Hives spent holding three larvae, when they stop making more. Every larva they would have made is one you never get.',
        ),
      ]
    case 'scoutTime':
      return [
        t('myStats.coach.metric.scoutTime', 'First scout'),
        t(
          'myStats.coach.help.scoutTime',
          "When one of your units first got near an enemy's starting base.",
        ),
      ]
    case 'detection':
      return [
        t('myStats.coach.metric.detection', 'First detection'),
        t(
          'myStats.coach.help.detection',
          'When you first started something that sees cloaked and burrowed units: an Observer or Photon Cannon, or a Missile Turret, Comsat Station or Science Vessel. Games without one are left out.',
        ),
      ]
    case 'workerProduction8':
      return [
        t('myStats.coach.metric.workerProduction', 'Worker production, first 8 min'),
        t(
          'myStats.coach.help.workerProduction',
          'The share of the first 8 minutes your Command Centers or Nexuses spent making workers, each from when it was done.',
        ),
      ]
    case 'workerLead8':
      return [
        t('myStats.coach.metric.workerLead', 'Worker lead at 8 min'),
        t(
          'myStats.coach.help.workerLead',
          "Your workers minus your opponent's at 8 minutes. Below 0 means they were ahead.",
        ),
      ]
    case 'baseLead10':
      return [
        t('myStats.coach.metric.baseLead', 'Base lead at 10 min'),
        t(
          'myStats.coach.help.baseLead',
          "Your bases minus your opponent's at 10 minutes. Below 0 means they were on more.",
        ),
      ]
    case 'income6':
      return mining(6)
    case 'income10':
      return mining(10)
    case 'income12':
      return mining(12)
    case 'income15':
      return mining(15)
    case 'production6':
      return production(6)
    case 'production8':
      return production(8)
    case 'production10':
      return production(10)
    case 'production12':
      return production(12)
    case 'production15':
      return production(15)
    case 'secondBase':
      return [
        t('myStats.coach.metric.secondBase', 'Second base'),
        t(
          'myStats.coach.help.secondBase',
          'When you started your second town hall. For Zerg, a Hatchery built for larvae counts too.',
        ),
      ]
    case 'thirdBase':
      return [
        t('myStats.coach.metric.thirdBase', 'Third base'),
        t(
          'myStats.coach.help.thirdBase',
          'When you started your third town hall. For Zerg, a Hatchery built for larvae counts too.',
        ),
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
        t('myStats.coach.metric.supplyBlockedTime', 'Supply blocked'),
        t(
          'myStats.coach.help.supplyBlocked',
          "How long you couldn't make units because you were out of supply, for every 10 minutes played. The first 3 minutes are left out, since early blocks are often part of a build, and so is time maxed out.",
        ),
      ]
    case 'army7':
    case 'army10':
    case 'army12':
    case 'army15':
      return [
        t('myStats.coach.metric.army', 'Army at {{minute}} min', {
          minute: Number(key.slice('army'.length)),
        }),
        t('myStats.coach.help.army', "What your army was worth then, in the game's score."),
      ]
    case 'armyKilled':
      return [
        t('myStats.macro.armyKilled', 'Army killed'),
        t(
          'myStats.help.armyKilled',
          "What the enemy army units you killed were worth, by StarCraft's score for each unit. Workers, buildings, Overlords, Interceptors, Scarabs and Spider Mines don't count.",
        ),
      ]
    case 'armyLost':
      return [
        t('myStats.macro.armyLost', 'Army lost'),
        t(
          'myStats.help.armyLost',
          "What the army units you lost were worth, by StarCraft's score for each unit. Workers, buildings, Overlords, Interceptors, Scarabs and Spider Mines don't count.",
        ),
      ]
    case 'armyTrade':
      return [
        t('myStats.coach.metric.armyKilledPerLost', 'Army killed per army lost'),
        t(
          'myStats.coach.help.armyTrade',
          "Army you killed for each army you lost, by the game's score. Above 1 means you traded well.",
        ),
      ]
    case 'workersLost':
      return [
        t('myStats.coach.metric.workersLost', 'Workers lost'),
        t(
          'myStats.coach.help.workersLostRate',
          "Workers of yours that died, for every 10 minutes you played, so a player who left early doesn't look careful.",
        ),
      ]
    case 'overlordsLost':
      return [
        t('myStats.coach.metric.overlordsLost', 'Overlords lost'),
        t(
          'myStats.coach.help.overlordsLostRate',
          'Overlords of yours that died, for every 10 minutes you played.',
        ),
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
    case 'productionForIncome10':
      return [
        t('myStats.coach.metric.productionForIncome', 'Production for your mining at 10 min'),
        t(
          'myStats.coach.help.productionForIncome',
          'Production buildings you had, against how many your mining at 10 minutes could keep busy making units nonstop. 100% means enough to spend it all.',
        ),
      ]
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
  return (shownValue: number, unit: CoachUnit) => {
    // Never "-0".
    const value = shownValue + 0
    const number = (n: number) =>
      Math.abs(n) < 10 && !Number.isInteger(n) ? n.toFixed(1) : format.format(n)
    switch (unit) {
      case 'time':
        return formatGameTime(value)
      case 'share':
        // Time supply blocked, which reads better as seconds than as a share of the game.
        return t('myStats.coach.secondsPerTen', '{{count}}s per 10 min', {
          count: Math.round(value * 600),
        })
      case 'perTenMinutes':
        return t('myStats.coach.perTen', '{{amount}} per 10 min', { amount: number(value) })
      case 'ratio':
        return value.toFixed(2)
      case 'percent':
        return `${Math.round(value * 100)}%`
      case 'perMinute':
        return t('myStats.macro.perMinute', '{{amount}} a min', { amount: number(value) })
      default:
        return number(value)
    }
  }
}

/** Armor, weapons and Plasma Shields, the upgrades with levels. The rest have only one. */
const LAST_LEVELED_UPGRADE_ID = 15

export function getBuildName(buildKey: string, t: TFunction) {
  const [, kind, id, level] = /^([utg])(\d+)(?:\.(\d+))?$/.exec(buildKey) ?? []
  switch (kind) {
    case 'u':
      return getUnitTypeInfo(Number(id), t).name
    case 't':
      return getTechName(Number(id), t)
    case 'g':
      return Number(id) <= LAST_LEVELED_UPGRADE_ID
        ? `${getUpgradeName(Number(id), t)} +${level}`
        : getUpgradeName(Number(id), t)
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
  if (scope.allyRace) {
    return t('myStats.coach.scopeAlly', '{{race}} with a {{ally}} ally in {{shape}}', {
      race,
      ally: raceCharToLabel(scope.allyRace, t),
      shape: scope.shape,
    })
  }
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
  if (
    (key.startsWith('workers') && key !== 'workersLost') ||
    key === 'workerProduction8' ||
    key === 'workerLead8'
  ) {
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
    key === 'baseLead10' ||
    key.startsWith('supply1') ||
    key === 'supply200'
  ) {
    return 'growth'
  }
  if (
    key.startsWith('bank') ||
    key === 'supplyBlocked' ||
    key === 'larvaeFull10' ||
    key.startsWith('productionCommands')
  ) {
    return 'spending'
  }
  if (key === 'scoutTime' || key === 'detection') {
    return 'fights'
  }
  if (key.startsWith('army') || key === 'workersLost' || key === 'overlordsLost') {
    return 'fights'
  }
  return 'speed'
}

/** The race's own words for what the tips talk about. */
export function getRaceWords(race: AssignedRaceChar, t: TFunction) {
  switch (race) {
    case 't':
      return {
        workers: t('myStats.coach.words.scvs', 'SCVs'),
        townHalls: t('myStats.coach.words.commandCenters', 'Command Centers'),
        townHall: t('myStats.coach.words.commandCenter', 'Command Center'),
        supply: t('myStats.coach.words.depots', 'Supply Depots'),
        production: t('myStats.coach.words.barracksFactories', 'Barracks and Factories'),
        defense: t('myStats.coach.words.bunkersTurrets', 'a Bunker or Turrets'),
        detector: t('myStats.coach.words.turretComsat', 'a Turret or a Comsat'),
      }
    case 'p':
      return {
        workers: t('myStats.coach.words.probes', 'Probes'),
        townHalls: t('myStats.coach.words.nexuses', 'Nexuses'),
        townHall: t('myStats.coach.words.nexus', 'Nexus'),
        supply: t('myStats.coach.words.pylons', 'Pylons'),
        production: t('myStats.coach.words.gateways', 'Gateways'),
        defense: t('myStats.coach.words.cannons', 'a few Cannons'),
        detector: t('myStats.coach.words.observerCannon', 'an Observer or a Cannon'),
      }
    case 'z':
      return {
        workers: t('myStats.coach.words.drones', 'Drones'),
        townHalls: t('myStats.coach.words.hatcheries', 'Hatcheries'),
        townHall: t('myStats.coach.words.hatchery', 'Hatchery'),
        supply: t('myStats.coach.words.overlords', 'Overlords'),
        production: t('myStats.coach.words.macroHatcheries', 'macro Hatcheries'),
        defense: t('myStats.coach.words.sunkens', 'a Sunken or Spores'),
        detector: t('myStats.coach.words.sporeOverlord', 'a Spore Colony'),
      }
    default:
      return race satisfies never
  }
}

/** A goal's target and the user's typical number, formatted for a sentence. */
export interface TipValues {
  target: string
  user: string
}

/** What a goal's headline needs: how far off the user is, and who they're compared with. */
export interface HeadlineValues {
  /** The difference between the user's typical number and the target, formatted. */
  gap: string
  /** The players compared with, like "Protoss players over 100 EAPM". */
  players: string
}

/**
 * A goal said the way a coach would open with it, in one sentence: what the user does less of, or
 * later, than the players they're compared with, and by how much. The numbers behind it follow in
 * {@link getTip}.
 */
export function getTipHeadline(
  key: CoachMetricKey | 'buildTiming',
  race: AssignedRaceChar,
  values: HeadlineValues & { build?: string },
  t: TFunction,
  basis: CoachGoalBasis = 'others',
): string {
  const words = { ...getRaceWords(race, t), ...values }
  if (basis === 'wins') {
    return t(
      'myStats.coach.headline.wins',
      'You fall short of this in your losses, but not in your wins.',
      words,
    )
  }
  if (basis === 'earlier') {
    return t(
      'myStats.coach.headline.earlier',
      'This got worse in your latest games, by {{gap}}.',
      words,
    )
  }

  switch (key === 'buildTiming' ? key : getMetricFamily(key)) {
    case 'buildTiming':
      return t(
        'myStats.coach.headline.timing',
        'You start {{build}} {{gap}} later than most {{players}}.',
        words,
      )
    case 'workers':
      return key === 'workerLead8'
        ? t(
            'myStats.coach.headline.workerLead',
            "Against your opponent's {{workers}}, you're {{gap}} further behind than most {{players}}.",
            words,
          )
        : t(
            'myStats.coach.headline.workers',
            'You have {{gap}} fewer {{workers}} than most {{players}} at this point.',
            words,
          )
    case 'workerProduction':
      return t(
        'myStats.coach.headline.workerProduction',
        "Your {{townHalls}} spend more time not making {{workers}} than most {{players}}'.",
        words,
      )
    case 'larvaeFull':
      return t(
        'myStats.coach.headline.larvaeFull',
        "Your Hatcheries sit on three larvae more of the time than most {{players}}'.",
        words,
      )
    case 'scoutTime':
      return t(
        'myStats.coach.headline.scoutTime',
        'You scout {{gap}} later than most {{players}}.',
        words,
      )
    case 'detection':
      return t(
        'myStats.coach.headline.detection',
        'You get detection {{gap}} later than most {{players}}.',
        words,
      )
    case 'income':
      return t(
        'myStats.coach.headline.income',
        'You mine {{gap}} less than most {{players}} at this point.',
        words,
      )
    case 'production':
      return t(
        'myStats.coach.headline.production',
        'You have {{gap}} fewer production buildings than most {{players}} at this point.',
        words,
      )
    case 'productionForIncome':
      return t(
        'myStats.coach.headline.productionForIncome',
        'For what you mine, you have fewer production buildings than most {{players}}.',
        words,
      )
    case 'base':
      return key === 'baseLead10'
        ? t(
            'myStats.coach.headline.baseLead',
            "Against your opponent's bases, you're {{gap}} further behind than most {{players}}.",
            words,
          )
        : t(
            'myStats.coach.headline.base',
            'You take this {{townHall}} {{gap}} later than most {{players}}.',
            words,
          )
    case 'supply':
      return t(
        'myStats.coach.headline.supply',
        'You reach this supply {{gap}} later than most {{players}}.',
        words,
      )
    case 'bank':
      return t(
        'myStats.coach.headline.bank',
        'You have {{gap}} more in the bank than most {{players}} at this point.',
        words,
      )
    case 'supplyBlocked':
      return t(
        'myStats.coach.headline.supplyBlocked',
        "You're supply blocked {{gap}} longer than most {{players}}.",
        words,
      )
    case 'army':
      return t(
        'myStats.coach.headline.army',
        "Your army is worth {{gap}} less than most {{players}}' at this point.",
        words,
      )
    case 'armyTrade':
      return t(
        'myStats.coach.headline.armyTrade',
        'You trade armies worse than most {{players}}.',
        words,
      )
    case 'workersLost':
      return t(
        'myStats.coach.headline.workersLost',
        'You lose more {{workers}} than most {{players}}.',
        words,
      )
    case 'overlordsLost':
      return t(
        'myStats.coach.headline.overlordsLost',
        'You lose more Overlords than most {{players}}.',
        words,
      )
    case 'speed':
      return t(
        'myStats.coach.headline.speed',
        'You play slower than most {{players}}, by {{gap}}.',
        words,
      )
    case 'productionCommands':
      return t(
        'myStats.coach.headline.productionCommands',
        "Your production buildings get fewer orders than most {{players}}'.",
        words,
      )
    default:
      return ''
  }
}

/**
 * What a goal's number means in the game, said as what most players do next to what the user does.
 * Only states what the numbers show: no advice on how to play, which can be wrong for the game.
 */
export function getTip(
  key: CoachMetricKey,
  race: AssignedRaceChar,
  values: TipValues,
  t: TFunction,
  basis: CoachGoalBasis = 'others',
): string {
  const words = { ...getRaceWords(race, t), race: raceCharToLabel(race, t), ...values }
  if (basis === 'wins') {
    return t(
      'myStats.coach.fact.wins',
      'In your wins you usually reach {{target}}. In your losses you usually reach {{user}}.',
      words,
    )
  }
  if (basis === 'earlier') {
    return t(
      'myStats.coach.fact.earlier',
      'Your older games reached {{target}}. Your latest ones usually reach {{user}}.',
      words,
    )
  }

  switch (getMetricFamily(key)) {
    case 'workers':
      if (key === 'workerLead8') {
        return t(
          'myStats.coach.fact.workerLead',
          "This is your {{workers}} minus your opponent's at 8 minutes. Most {{race}} players here are at {{target}} or more. You're usually at {{user}}.",
          words,
        )
      }
      return t(
        'myStats.coach.fact.workers',
        'Most {{race}} players here have {{target}} {{workers}} or more at this point. You usually have {{user}}.',
        words,
      )
    case 'workerProduction':
      return t(
        'myStats.coach.fact.workerProduction',
        'Up to 8 minutes, most {{race}} players here have their {{townHalls}} making {{workers}} {{target}} of the time or more. Yours are making them {{user}} of the time.',
        words,
      )
    case 'larvaeFull':
      return t(
        'myStats.coach.fact.larvaeFull',
        'Up to 10 minutes, most Zerg players here have Hatcheries sitting on three larvae {{target}} of the time or less. Yours sit on three {{user}} of the time.',
        words,
      )
    case 'scoutTime':
      return t(
        'myStats.coach.fact.scoutTime',
        'Most {{race}} players here send their first scout by {{target}}. You usually send yours at {{user}}.',
        words,
      )
    case 'detection':
      return t(
        'myStats.coach.fact.detection',
        'Most {{race}} players here have detection by {{target}}. You usually have it at {{user}}.',
        words,
      )
    case 'income':
      return t(
        'myStats.coach.fact.income',
        'Most {{race}} players here mine {{target}} or more at this point. You usually mine {{user}}.',
        words,
      )
    case 'production':
      return t(
        'myStats.coach.fact.production',
        'Most {{race}} players here have {{target}} or more production buildings at this point. You usually have {{user}}.',
        words,
      )
    case 'productionForIncome':
      return t(
        'myStats.coach.fact.productionForIncome',
        'Most {{race}} players here have enough production buildings to spend {{target}} or more of what they mine. Yours can spend {{user}}.',
        words,
      )
    case 'base':
      if (key === 'baseLead10') {
        return t(
          'myStats.coach.fact.baseLead',
          "This is your bases minus your opponent's at 10 minutes. Most {{race}} players here are at {{target}} or more. You're usually at {{user}}.",
          words,
        )
      }
      return t(
        'myStats.coach.fact.base',
        'Most {{race}} players here start this {{townHall}} by {{target}}. You usually start it at {{user}}.',
        words,
      )
    case 'supply':
      return t(
        'myStats.coach.fact.supply',
        'Most {{race}} players here reach this supply by {{target}}. You usually reach it at {{user}}.',
        words,
      )
    case 'bank':
      return t(
        'myStats.coach.fact.bank',
        'Most {{race}} players here have {{target}} or less in the bank at this point. You usually have {{user}}.',
        words,
      )
    case 'supplyBlocked':
      return t(
        'myStats.coach.fact.supplyBlocked',
        'Most {{race}} players here are supply blocked for {{target}} or less. You usually are for {{user}}.',
        words,
      )
    case 'army':
      return t(
        'myStats.coach.fact.army',
        'Most {{race}} players here have an army worth {{target}} or more at this point. Yours is usually worth {{user}}.',
        words,
      )
    case 'armyTrade':
      return t(
        'myStats.coach.fact.armyTrade',
        'Most {{race}} players here kill {{target}} or more army value for every 1 they lose. You usually kill {{user}}.',
        words,
      )
    case 'workersLost':
      return t(
        'myStats.coach.fact.workersLost',
        'Most {{race}} players here lose {{workers}} at {{target}} or less. You usually lose them at {{user}}.',
        words,
      )
    case 'overlordsLost':
      return t(
        'myStats.coach.fact.overlordsLost',
        'Most Zerg players here lose Overlords at {{target}} or less. You usually lose them at {{user}}.',
        words,
      )
    case 'speed':
      return t(
        'myStats.coach.fact.speed',
        'Most {{race}} players here are at {{target}} or more. You are usually at {{user}}.',
        words,
      )
    case 'productionCommands':
      return t(
        'myStats.coach.fact.productionCommands',
        'Most {{race}} players here give each production building orders at {{target}} or more. You usually give them at {{user}}.',
        words,
      )
    default:
      return ''
  }
}

/** When most players start something the user starts later. */
export function getTimingTip(
  build: string,
  race: AssignedRaceChar,
  values: TipValues,
  t: TFunction,
) {
  return t(
    'myStats.coach.fact.timing',
    'Most {{race}} players here who get {{build}} start it by {{target}}. You usually start it at {{user}}.',
    { build, race: raceCharToLabel(race, t), ...values },
  )
}
