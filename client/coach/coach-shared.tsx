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

/** A table's heading row, or a group's within one: the first group sits flush with the top. */
export const GroupHead = styled.span<{ $end?: boolean; $first?: boolean }>`
  ${labelMedium};
  padding: ${props => (props.$first ? '0 0 6px' : '16px 0 6px')};
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
  padding-bottom: 6px;
  ${columnSpace};
  color: var(--theme-on-surface-variant);
  font-weight: 600;
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
    t('myStats.coach.metric.unitsPerBuilding', 'Units queued per production building, {{phase}}', {
      phase: phases[phase],
    }),
    `${t('myStats.coach.help.productionPerBuilding', 'Times a minute you ordered a unit, for each production building you had, which shows how often they sat idle.')} ${phaseHelp}`,
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
  return (value: number, unit: CoachUnit) => {
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
  if ((key.startsWith('workers') && key !== 'workersLost') || key === 'workerProduction8') {
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
      }
    case 'p':
      return {
        workers: t('myStats.coach.words.probes', 'Probes'),
        townHalls: t('myStats.coach.words.nexuses', 'Nexuses'),
        townHall: t('myStats.coach.words.nexus', 'Nexus'),
        supply: t('myStats.coach.words.pylons', 'Pylons'),
        production: t('myStats.coach.words.gateways', 'Gateways'),
        defense: t('myStats.coach.words.cannons', 'a few Cannons'),
      }
    case 'z':
      return {
        workers: t('myStats.coach.words.drones', 'Drones'),
        townHalls: t('myStats.coach.words.hatcheries', 'Hatcheries'),
        townHall: t('myStats.coach.words.hatchery', 'Hatchery'),
        supply: t('myStats.coach.words.overlords', 'Overlords'),
        production: t('myStats.coach.words.macroHatcheries', 'macro Hatcheries'),
        defense: t('myStats.coach.words.sunkens', 'a Sunken or Spores'),
      }
    default:
      return race satisfies never
  }
}

/** The kind of game a tip is for, which changes what a coach would say. */
export interface TipContext {
  race: AssignedRaceChar
  opponentRace?: AssignedRaceChar
  teamGame: boolean
  mapFamily?: MapFamily
}

/**
 * What to do about a number, the way a coach would put it for this kind of game. A goal from the
 * user's own wins, or their own earlier games, gets advice about that rather than about other
 * players, who the user may already be ahead of.
 */
export function getTip(
  key: CoachMetricKey,
  context: TipContext,
  t: TFunction,
  basis: CoachGoalBasis = 'others',
): string {
  const words = getRaceWords(context.race, t)
  if (basis === 'wins') {
    return getWinsTip(key, context, t)
  }
  if (basis === 'earlier') {
    return t(
      'myStats.coach.tip.earlier',
      'You used to reach this. Watch one of your latest games next to an older one and look for what changed in the build.',
      words,
    )
  }
  const { teamGame, mapFamily } = context
  const bgh = mapFamily === 'bgh'
  const fastest = mapFamily === 'fastest'
  const mirror = !teamGame && context.opponentRace === context.race

  switch (getMetricFamily(key)) {
    case 'workers':
      if (key === 'workerLead8') {
        return t(
          'myStats.coach.tip.workerLead',
          "You fall behind your opponent's economy. Keep making {{workers}} through the early pressure instead of stopping to make units you don't need yet, and scout to know when you can.",
          words,
        )
      }
      return context.race === 'z'
        ? t(
            'myStats.coach.tip.workersZerg',
            "Spend larvae on Drones whenever you aren't under pressure. Scout, so you know when you can drone hard and when you need units.",
            words,
          )
        : t(
            'myStats.coach.tip.workers',
            'Keep your {{townHalls}} making {{workers}} without a break. Check on them every time you cycle through your hotkeys.',
            words,
          )
    case 'workerProduction':
      return t(
        'myStats.coach.tip.workerProduction',
        'Your {{townHalls}} sit idle between {{workers}}. Queue two at a time, and go back to them every time you return to your base.',
        words,
      )
    case 'income':
      if (bgh) {
        return t(
          'myStats.coach.tip.incomeBgh',
          'Fill your main and take both gases early. On this map gas, not minerals, holds back your tech and upgrades.',
          words,
        )
      }
      if (fastest) {
        return t(
          'myStats.coach.tip.incomeFastest',
          'Your main has more minerals than you can spend, so fill it with {{workers}} early and keep them mining while you fight.',
          words,
        )
      }
      return t(
        'myStats.coach.tip.income',
        'Mining follows workers and bases. Fill each base with {{workers}}, take your gas on time, and expand before your main runs dry.',
        words,
      )
    case 'production':
      if (context.race === 'z') {
        return t(
          'myStats.coach.tip.productionZerg',
          'Add a macro Hatchery when minerals pile up and you run out of larvae.',
          words,
        )
      }
      return context.race === 'p'
        ? t(
            'myStats.coach.tip.productionProtoss',
            'Build Gateways in pairs, with a Pylon next to them. Put them all on one hotkey and queue a round every time you come back to your base.',
            words,
          )
        : t(
            'myStats.coach.tip.production',
            'Add {{production}} sooner, so your money turns into units instead of sitting in the bank.',
            words,
          )
    case 'productionForIncome':
      return t(
        'myStats.coach.tip.productionForIncome',
        'Your mining pays for more {{production}} than you have. Add two every time your bank goes over 400, and keep them all on one hotkey.',
        words,
      )
    case 'base':
      if (key === 'baseLead10') {
        return t(
          'myStats.coach.tip.baseLead',
          'Your opponent is on more bases than you by 10 minutes. Take your next {{townHall}} as soon as you scout that you can hold it.',
          words,
        )
      }
      if (teamGame) {
        return t(
          'myStats.coach.tip.baseTeam',
          'Expand when your allies can cover you, or right after you hold the first push. Agree on it before the game.',
          words,
        )
      }
      return mirror
        ? t(
            'myStats.coach.tip.baseMirror',
            'Expand once you have scouted that they are not going all in. In a mirror, a one base build is often right, so this compares you with players who opened like you.',
            words,
          )
        : t(
            'myStats.coach.tip.base',
            'Plan your next {{townHall}} at a set supply in your build, and take it once you have scouted no rush is coming. A late base holds back everything after it.',
            words,
          )
    case 'supply':
      return bgh
        ? t(
            'myStats.coach.tip.supplyBgh',
            'Max out sooner: add production as your income grows, and keep every building busy so you reach 200 before the big fights.',
            words,
          )
        : t(
            'myStats.coach.tip.supply',
            'To grow faster, keep making {{workers}} and add production as your income grows.',
            words,
          )
    case 'bank':
      if ((bgh || fastest) && context.race === 'p') {
        return t(
          'myStats.coach.tip.bankMoneyProtoss',
          'Over 600 in the bank in the mid game means more Gateways, or a second tech like Templar Archives or a Robotics Support Bay. Start one before you reach 1,000.',
          words,
        )
      }
      return bgh || fastest
        ? t(
            'myStats.coach.tip.bankMoney',
            'When money piles up, add production or start your tech and upgrades. On this map there is always more to spend it on.',
            words,
          )
        : t(
            'myStats.coach.tip.bank',
            'When money piles up, spend it right away: make units, add {{production}}, or take another base.',
            words,
          )
    case 'supplyBlocked':
      return bgh || fastest
        ? t(
            'myStats.coach.tip.supplyBlockedMoneyRounds',
            'Build two {{supply}} every time you queue a round of units. Past 100 supply, build three or four at a time.',
            words,
          )
        : t(
            'myStats.coach.tip.supplyBlocked',
            'Keep one round of production ahead in supply: one of your {{supply}} on one base, two or three at a time once you have a lot of production.',
            words,
          )
    case 'army':
      return teamGame
        ? t(
            'myStats.coach.tip.armyTeam',
            'Your army is smaller than most at this point. Keep every production building busy, and move out with your allies rather than alone.',
            words,
          )
        : t(
            'myStats.coach.tip.army',
            'Your army is smaller than most at this point. If you lose to pressure, scout earlier and make units when you see it coming. Otherwise keep every production building busy.',
            words,
          )
    case 'armyTrade':
      return teamGame
        ? t(
            'myStats.coach.tip.armyTradeTeam',
            'You lose more than you kill in fights. Attack together with your allies: armies that hit one player at the same time trade far better than any one of them alone.',
            words,
          )
        : t(
            'myStats.coach.tip.armyTrade',
            "You lose more than you kill in fights. Fight where your units are strong, wait for your upgrades, and pull back from fights you're losing.",
            words,
          )
    case 'workersLost':
      return teamGame
        ? t(
            'myStats.coach.tip.workersLostWatch',
            'Watch two of those games and see what killed your {{workers}}: a drop, Zerglings, Dark Templar or Storm. Fix that one thing, and keep {{defense}} and detection at home.',
            words,
          )
        : t(
            'myStats.coach.tip.workersLost',
            'Protect your mineral lines. Keep {{defense}} or a few units near them, and pull {{workers}} away when harass comes.',
            words,
          )
    case 'overlordsLost':
      return t(
        'myStats.coach.tip.overlordsLost',
        "Spread your Overlords out, away from the paths your opponent's army and air units take.",
        words,
      )
    case 'speed':
      return t(
        'myStats.coach.tip.speed',
        "Speed comes from habits. Put your army and production on hotkeys, and cycle through your bases with them, even when nothing's happening.",
        words,
      )
    case 'productionCommands':
      return t(
        'myStats.coach.tip.productionCommands',
        'Your production buildings sit idle. Check every one each time you cycle through your hotkeys.',
        words,
      )
    default:
      return ''
  }
}

/** What to do about a number that's worse in the user's losses than in their wins. */
function getWinsTip(key: CoachMetricKey, context: TipContext, t: TFunction): string {
  const words = getRaceWords(context.race, t)
  switch (getMetricFamily(key)) {
    case 'army':
      return t(
        'myStats.coach.tip.winsArmy',
        'Your army is smaller in your losses than in your wins. Check whether you lost units early in those games or built fewer.',
        words,
      )
    case 'production':
      return t(
        'myStats.coach.tip.winsProduction',
        'You add {{production}} later in your losses. Make it part of the build, so it happens every game, not only the good ones.',
        words,
      )
    case 'bank':
      return t(
        'myStats.coach.tip.winsBank',
        'Money piles up in your losses. When you fall behind, spend first and think after: units now beat units later.',
        words,
      )
    case 'supplyBlocked':
      return t(
        'myStats.coach.tip.winsSupply',
        'You get supply blocked more in your losses. Keep building {{supply}} when the game gets busy, since that is when it slips.',
        words,
      )
    default:
      return t(
        'myStats.coach.tip.winsDefault',
        'You reach this in your wins but not your losses. Make it part of your build, so it happens every game.',
        words,
      )
  }
}

/** What to do about a build that starts later than most. */
export function getTimingTip(build: string, time: string, t: TFunction) {
  return t(
    'myStats.coach.tip.timing',
    'Put {{build}} at a set point in your build and start it by {{time}}. If your build saves it for later on purpose, ignore this.',
    { build, time },
  )
}
