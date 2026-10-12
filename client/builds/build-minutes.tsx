import { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ARMY_MIX_MINUTES } from '../../common/games/player-metrics'
import { getUnitSupply } from '../../common/games/unit-types'
import { BuildSide, isArmyMixUnit, WORKER_MINUTES } from '../../common/my-stats/builds'
import { AssignedRaceChar } from '../../common/races'
import { Cell, formatGameTime, getBuildName, GroupHead, Tone } from '../coach/coach-shared'
import { GameIcon } from '../games/game-icon'
import { Segmented, SegmentOption } from '../material/segmented'
import { Tooltip } from '../material/tooltip'
import {
  formatPercent,
  HelpLabel,
  PaddedPanel,
  PanelHead,
  PanelTitle,
} from '../my-stats/my-stats-panels'
import { labelMedium, labelSmall } from '../styles/typography'
import {
  BuildCompare,
  BuildsTable,
  IconName,
  Row,
  ROW_ICON_SIZE,
  ShownSide,
  SIDE_COLUMNS,
  SideKey,
  SMALL_ICON_SIZE,
} from './build-shared'

/** The user's workers are pointed out when this share more or fewer than who they're compared with. */
const WORKERS_OFF_SHARE = 0.1
/** An army count is pointed out when it differs by at least this many units and by this ratio. */
const ARMY_DIFF_MIN = 0.5
const ARMY_DIFF_RATIO = 1.3
/** An average count under this rounds to none. */
const NO_UNITS = 0.05

/** An average count of units, or a dash for a side with no games then. */
function formatCount(count: number | undefined) {
  if (count === undefined) {
    return '-'
  }
  return count < NO_UNITS ? '0' : count.toFixed(1)
}

/** A side's average count of a unit at one of {@link ARMY_MIX_MINUTES}, if its games got there. */
function countOf(side: BuildSide | undefined, unitId: number, i: number) {
  // Workers are counted in every game still going, so a minute without them is one no game reached.
  if (!side || side.workersAt[i] === null) {
    return undefined
  }
  return side.armyMix.find(entry => entry.unitId === unitId)?.counts[i] ?? 0
}

function getWorkersTone(mine: number | null | undefined, theirs: number | null | undefined) {
  if (!mine || !theirs) {
    return undefined
  }
  if (mine <= theirs * (1 - WORKERS_OFF_SHARE)) {
    return 'bad'
  }
  return mine >= theirs * (1 + WORKERS_OFF_SHARE) ? 'good' : undefined
}

function getArmyTone(mine: number | undefined, theirs: number | undefined): Tone | undefined {
  if (mine === undefined || theirs === undefined) {
    return undefined
  }
  if (mine - theirs >= ARMY_DIFF_MIN && mine >= theirs * ARMY_DIFF_RATIO) {
    return 'good'
  }
  return theirs - mine >= ARMY_DIFF_MIN && mine <= theirs / ARMY_DIFF_RATIO ? 'bad' : undefined
}

function getWorkerCutText(side: BuildSide | undefined, t: TFunction) {
  const stop = side?.workerStop
  if (!stop) {
    return '-'
  }
  if (stop.stopped * 2 < stop.games) {
    return t('builds.workersKeepGoing', 'Past 10 min')
  }
  return t('builds.workersCutAt', '{{workers}} at {{time}}', {
    workers: stop.workers,
    time: formatGameTime(stop.atMs),
  })
}

/** The army units worth a row for any side, the most made by 10 minutes first. */
function getArmyUnits(sides: ReadonlyArray<ShownSide>) {
  const units: number[] = []
  for (const { side } of sides) {
    for (const entry of side?.armyMix ?? []) {
      if (isArmyMixUnit(entry) && !units.includes(entry.unitId)) {
        units.push(entry.unitId)
      }
    }
  }
  return units
}

/** One group of rows: its name, then each side's name over its column. */
function GroupHeads({ title, sides }: { title: React.ReactNode; sides: ReadonlyArray<ShownSide> }) {
  return (
    <Row>
      <GroupHead>{title}</GroupHead>
      {sides.map(s => (
        <GroupHead key={s.key} $end={true}>
          {s.label}
        </GroupHead>
      ))}
    </Row>
  )
}

/** Workers and army units by minute, a row each, with every side's number. */
function MinutesTable({ compare, race }: { compare: BuildCompare; race: AssignedRaceChar }) {
  const { t } = useTranslation()
  const { sides, basis } = compare
  const you = sides.find(s => s.key === 'you')?.side
  const units = getArmyUnits(sides)
  const tone = (s: ShownSide, value: (side: BuildSide) => Tone | undefined) =>
    s.key === 'you' && you && basis?.side ? value(you) : undefined
  const cutHelp = [
    t(
      'builds.workersStopHelp',
      'Workers and time when a typical game stops making them: the first 1:30 or more without a new one after 3:00, other than out of supply.',
    ),
    race === 'z'
      ? t(
          'builds.zergWorkersNote',
          'Zerg often pause drones to save larvae for an army, then drone again, so a stop here can be a pause.',
        )
      : '',
  ].join(' ')

  return (
    <BuildsTable $columns={SIDE_COLUMNS}>
      <Row>
        <GroupHead $first={true}>{t('builds.workersTitle', 'Workers')}</GroupHead>
        {sides.map(s => (
          <GroupHead key={s.key} $first={true} $end={true}>
            <HelpLabel label={s.label} help={s.help} />
          </GroupHead>
        ))}
      </Row>
      {WORKER_MINUTES.map((minute, i) => (
        <Row key={`workers-${minute}`}>
          <Cell>{t('builds.atMinute', '{{minute}} min', { minute })}</Cell>
          {sides.map(s => (
            <Cell
              key={s.key}
              $end={true}
              $tone={
                tone(s, mine => getWorkersTone(mine.workersAt[i], basis?.side?.workersAt[i])) ??
                (s.muted || s.side?.workersAt[i] == null ? 'muted' : undefined)
              }>
              {s.side?.workersAt[i] ?? '-'}
            </Cell>
          ))}
        </Row>
      ))}
      <Row>
        <Cell>
          <HelpLabel quiet={true} label={t('builds.workersCut', 'Cut at')} help={cutHelp} />
        </Cell>
        {sides.map(s => (
          <Cell
            key={s.key}
            $end={true}
            $tone={s.muted || !s.side?.workerStop ? 'muted' : undefined}>
            {getWorkerCutText(s.side, t)}
          </Cell>
        ))}
      </Row>
      <Row>
        <Cell>
          <HelpLabel
            quiet={true}
            label={t('builds.workersGamesHead', 'Games that cut')}
            help={t(
              'builds.workersGamesHelp',
              'Of the games that stopped or went on past 10 minutes. Games over before either are left out.',
            )}
          />
        </Cell>
        {sides.map(s => (
          <Cell key={s.key} $end={true} $tone='muted'>
            {s.side?.workerStop
              ? t('builds.workersGames', '{{stopped}} of {{games}}', {
                  stopped: s.side.workerStop.stopped,
                  games: s.side.workerStop.games,
                })
              : '-'}
          </Cell>
        ))}
      </Row>
      {ARMY_MIX_MINUTES.map((minute, i) => {
        const shown = units.filter(unitId =>
          sides.some(s => (countOf(s.side, unitId, i) ?? 0) >= NO_UNITS),
        )
        return [
          <GroupHeads
            key={`army-${minute}-head`}
            title={t('builds.armyAt', 'Army at {{minute}} min', { minute })}
            sides={sides}
          />,
          ...(shown.length
            ? shown.map(unitId => (
                <Row key={`army-${minute}-${unitId}`}>
                  <Cell>
                    <IconName>
                      <GameIcon buildKey={`u${unitId}`} size={ROW_ICON_SIZE} />
                      {getBuildName(`u${unitId}`, t)}
                    </IconName>
                  </Cell>
                  {sides.map(s => {
                    const count = countOf(s.side, unitId, i)
                    return (
                      <Cell
                        key={s.key}
                        $end={true}
                        $tone={
                          tone(s, () => getArmyTone(count, countOf(basis?.side, unitId, i))) ??
                          (s.muted || count === undefined || count < NO_UNITS ? 'muted' : undefined)
                        }>
                        {formatCount(count)}
                      </Cell>
                    )
                  })}
                </Row>
              ))
            : [
                <Row key={`army-${minute}-none`}>
                  <Cell $tone='muted'>{t('builds.noArmyYet', 'No army units yet')}</Cell>
                  {sides.map(s => (
                    <Cell key={s.key} $end={true} $tone='muted'>
                      -
                    </Cell>
                  ))}
                </Row>,
              ]),
        ]
      })}
    </BuildsTable>
  )
}

/** Colors for the units in the army makeup, in order. Units past these share the last, as others. */
const UNIT_COLORS = [
  'var(--theme-data-1)',
  'var(--theme-data-2)',
  'var(--theme-data-3)',
  'var(--theme-data-4)',
  'var(--theme-data-5)',
  'var(--theme-data-6)',
  'var(--theme-data-7)',
]
const OTHER_UNITS_COLOR = 'var(--theme-data-8)'
/** The size of a unit's icon on its part of a bar. */
const MAKEUP_ICON_SIZE = 30

const MakeupGrid = styled.div`
  ${labelMedium};
  display: grid;
  grid-template-columns: 96px repeat(${ARMY_MIX_MINUTES.length}, minmax(0, 1fr));
  align-items: center;
  gap: var(--space-2) var(--space-3);
  color: var(--theme-on-surface-variant);
`

const MakeupHead = styled.span`
  font-weight: 600;
  text-align: center;
`

const MakeupBar = styled.div`
  height: 44px;
  display: flex;
  gap: 2px;
`

const MakeupPart = styled.span<{ $color: string; $muted?: boolean }>`
  ${labelSmall};
  min-width: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  overflow: hidden;
  border-radius: 4px;
  /* Neutral, with the unit's color only along the bottom, so the light icon and share on it stand
     out. The padding keeps the icon clear of the color. */
  padding-bottom: 3px;
  background: var(--theme-container-high);
  box-shadow: inset 0 -3px 0 ${props => props.$color};
  color: var(--theme-on-surface);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  opacity: ${props => (props.$muted ? 0.5 : 1)};
  /* A part shows what fits of its icon and share, by its own width. */
  container-type: inline-size;

  &:hover {
    background: var(--theme-container-highest);
  }
`

const MakeupTooltip = styled(Tooltip)`
  display: block;
`

const MakeupTip = styled.div`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  font-variant-numeric: tabular-nums;
`

const MakeupTipTitle = styled.span`
  ${labelMedium};
  grid-column: 1 / -1;
  font-weight: 600;
`

const MakeupTipName = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
`

const MakeupTipValue = styled.span`
  font-weight: 600;
  text-align: right;
`

const MakeupTipCount = styled.span`
  color: var(--theme-on-surface-variant);
  text-align: right;
`

const MakeupTipNote = styled.span`
  ${labelSmall};
  grid-column: 1 / -1;
  color: var(--theme-on-surface-variant);
`

const MakeupPartIcon = styled.span`
  display: flex;

  @container (max-width: ${MAKEUP_ICON_SIZE + 4}px) {
    display: none;
  }
`

/** A part's share, after its icon when that's there too. */
const MakeupPartShare = styled.span<{ $withIcon: boolean }>`
  @container (max-width: ${props => (props.$withIcon ? MAKEUP_ICON_SIZE + 48 : 40)}px) {
    display: none;
  }
`

const MakeupEmpty = styled.span`
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  border: 1px dashed var(--theme-outline-variant);
`

const MakeupLegend = styled.div`
  ${labelMedium};
  margin-top: var(--space-1);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  color: var(--theme-on-surface-variant);
`

const LegendItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
`

const UnitSwatch = styled.span<{ $color: string }>`
  width: 10px;
  height: 10px;
  flex: none;
  border-radius: 2px;
  background: ${props => props.$color};
`

/**
 * What each side's army is made of at each minute, by the supply each unit takes, so a pair of
 * Zerglings weighs what one Hydralisk does.
 */
function ArmyMakeup({ sides }: { sides: ReadonlyArray<ShownSide> }) {
  const { t } = useTranslation()
  const units = getArmyUnits(sides)
  const named = units.slice(0, UNIT_COLORS.length)
  const hasOthers = sides.some(({ side }) =>
    side?.armyMix.some(entry => !named.includes(entry.unitId) && entry.counts.some(Boolean)),
  )
  const colorOf = (unitId: number | undefined) =>
    unitId === undefined
      ? OTHER_UNITS_COLOR
      : (UNIT_COLORS[named.indexOf(unitId)] ?? OTHER_UNITS_COLOR)
  const nameOf = (unitId: number | undefined) =>
    unitId === undefined ? t('builds.otherUnits', 'Other') : getBuildName(`u${unitId}`, t)

  const partsOf = (side: BuildSide | undefined, i: number) => {
    const supplies = new Map<number | undefined, { supply: number; count: number }>()
    for (const entry of side?.armyMix ?? []) {
      const count = countOf(side, entry.unitId, i) ?? 0
      const supply = count * getUnitSupply(entry.unitId)
      if (supply > 0) {
        const unitId = named.includes(entry.unitId) ? entry.unitId : undefined
        const sum = supplies.get(unitId) ?? { supply: 0, count: 0 }
        supplies.set(unitId, { supply: sum.supply + supply, count: sum.count + count })
      }
    }
    const total = Array.from(supplies.values()).reduce((sum, part) => sum + part.supply, 0)
    const order = (unitId: number | undefined) =>
      unitId === undefined ? named.length : named.indexOf(unitId)
    return Array.from(supplies, ([unitId, { supply, count }]) => ({
      unitId,
      count,
      share: supply / total,
    }))
      .filter(part => part.share > 0)
      .sort((a, b) => order(a.unitId) - order(b.unitId))
  }

  return (
    <>
      <MakeupGrid>
        <span />
        {ARMY_MIX_MINUTES.map(minute => (
          <MakeupHead key={minute}>{t('builds.atMinute', '{{minute}} min', { minute })}</MakeupHead>
        ))}
        {sides.map(s => [
          <span key={`${s.key}-label`}>{s.label}</span>,
          ...ARMY_MIX_MINUTES.map((minute, i) => {
            const parts = partsOf(s.side, i)
            if (!parts.length) {
              return <MakeupEmpty key={`${s.key}-${minute}`}>-</MakeupEmpty>
            }
            return (
              <MakeupTooltip
                key={`${s.key}-${minute}`}
                position='top'
                text={
                  <MakeupTip>
                    <MakeupTipTitle>
                      {t('builds.makeupTipTitle', '{{side}} at {{minute}} min', {
                        side: s.label,
                        minute,
                      })}
                    </MakeupTipTitle>
                    {parts.map(part => [
                      <UnitSwatch key={`${part.unitId}-swatch`} $color={colorOf(part.unitId)} />,
                      <MakeupTipName key={`${part.unitId}-name`}>
                        {part.unitId !== undefined ? (
                          <GameIcon buildKey={`u${part.unitId}`} size={SMALL_ICON_SIZE} />
                        ) : null}
                        {nameOf(part.unitId)}
                      </MakeupTipName>,
                      <MakeupTipValue key={`${part.unitId}-share`}>
                        {formatPercent(part.share)}
                      </MakeupTipValue>,
                      <MakeupTipCount key={`${part.unitId}-count`}>
                        {t('builds.makeupTipCount', '{{made}} made', {
                          made: formatCount(part.count),
                        })}
                      </MakeupTipCount>,
                    ])}
                    <MakeupTipNote>
                      {t(
                        'builds.makeupTipNote',
                        'Share of army supply, and units made on average.',
                      )}
                    </MakeupTipNote>
                  </MakeupTip>
                }>
                <MakeupBar>
                  {parts.map(part => (
                    <MakeupPart
                      key={part.unitId ?? 'other'}
                      $color={colorOf(part.unitId)}
                      $muted={s.muted}
                      style={{ flex: `${part.share} 1 0` }}>
                      {part.unitId !== undefined ? (
                        <MakeupPartIcon>
                          <GameIcon buildKey={`u${part.unitId}`} size={MAKEUP_ICON_SIZE} />
                        </MakeupPartIcon>
                      ) : null}
                      <MakeupPartShare $withIcon={part.unitId !== undefined}>
                        {formatPercent(part.share)}
                      </MakeupPartShare>
                    </MakeupPart>
                  ))}
                </MakeupBar>
              </MakeupTooltip>
            )
          }),
        ])}
      </MakeupGrid>
      <MakeupLegend>
        {named.map(unitId => (
          <LegendItem key={unitId}>
            <UnitSwatch $color={colorOf(unitId)} />
            <GameIcon buildKey={`u${unitId}`} size={SMALL_ICON_SIZE} />
            {nameOf(unitId)}
          </LegendItem>
        ))}
        {hasOthers ? (
          <LegendItem>
            <UnitSwatch $color={OTHER_UNITS_COLOR} />
            {nameOf(undefined)}
          </LegendItem>
        ) : null}
      </MakeupLegend>
    </>
  )
}

type View = 'table' | 'chart'

/** Who the user's numbers are compared with, for the legends that say so. */
export function getBasisName(basis: SideKey | undefined, t: TFunction) {
  switch (basis) {
    case 'top':
      return t('builds.basisTop', 'top players')
    case 'winners':
      return t('builds.basisWinners', 'the winners')
    case 'level':
      return t('builds.basisLevel', 'players at your level')
    default:
      return undefined
  }
}

/**
 * Workers and army at a few minutes into the game, for every side of the picked build, as a table
 * or as what each army is made of.
 */
export function WorkersAndArmy({
  compare,
  race,
}: {
  compare: BuildCompare
  race: AssignedRaceChar
}) {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('table')
  const basis = getBasisName(compare.basis?.key, t)
  const viewOptions: Array<SegmentOption<View>> = [
    { value: 'table', label: t('builds.viewTable', 'Table') },
    { value: 'chart', label: t('builds.viewMakeup', 'Army makeup') },
  ]
  return (
    <PaddedPanel>
      <PanelHead $spread={true}>
        <PanelTitle>
          <HelpLabel
            label={t('builds.workersArmyTitle', 'Workers and army')}
            help={[
              t(
                'builds.armyNote',
                'Units one player started by each minute, on average, in games still going then.',
              ),
              basis
                ? t(
                    'builds.minutesLegend',
                    'Your numbers in red are well under {{basis}}, in green well over.',
                    { basis },
                  )
                : '',
            ].join(' ')}
          />
        </PanelTitle>
        <Segmented
          label={t('builds.view', 'View')}
          options={viewOptions}
          value={view}
          onChange={setView}
        />
      </PanelHead>
      {view === 'table' ? (
        <MinutesTable compare={compare} race={race} />
      ) : (
        <ArmyMakeup sides={compare.sides} />
      )}
    </PaddedPanel>
  )
}
