import { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getUnitTypeInfo } from '../../common/games/unit-types'
import { BuildSide, BuildStepSummary } from '../../common/my-stats/builds'
import { Cell, formatGameTime, HeadCell, Text, Tone } from '../coach/coach-shared'
import { GameIcon } from '../games/game-icon'
import { TextButton } from '../material/button'
import { Segmented, SegmentMenu, SegmentOption } from '../material/segmented'
import { Tooltip } from '../material/tooltip'
import {
  formatPercent,
  HelpLabel,
  PaddedPanel,
  PanelHead,
  PanelHeadNote,
  PanelTitle,
} from '../my-stats/my-stats-panels'
import { push } from '../navigation/routing'
import { getGameStatsUrl } from '../replays/action-creators'
import { bodyMedium, labelMedium } from '../styles/typography'
import {
  BuildCompare,
  BuildsTable,
  formatStep,
  getBuildFamilyName,
  getStepName,
  IconName,
  Row,
  ROW_ICON_SIZE,
  ShownSide,
  SIDE_COLUMNS,
  SideHeads,
  SideKey,
  SMALL_ICON_SIZE,
  stepId,
} from './build-shared'

/** A step this much later or earlier than the players it's compared with is pointed out. */
const OFF_STEP_MS = 20_000
/** A step fewer games than this share take is marked as one only some players add. */
const OPTIONAL_STEP_SHARE = 0.8

const HeadControls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
`

/**
 * Reaches past the head's padding like the controls at its end do, so a build with a game to open
 * has a head as tall as one without.
 */
const OpenGameButton = styled(TextButton)`
  margin-block: -10px;
`

/** How often a step comes up, after its name. */
const StepShare = styled.span`
  margin-left: var(--space-2);
  color: var(--theme-on-surface-variant);
`

/** A timeline tooltip's lines, one under another rather than side by side in the tooltip's row. */
const TipLines = styled.span`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
`

const TipLine = styled.span`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-variant-numeric: tabular-nums;
`

type StepsOf = (side: BuildSide) => ReadonlyArray<BuildStepSummary>

/**
 * Each side's steps by `stepId`, and every side's steps in one list, by when the first side that
 * takes each takes it. The first side's steps keep their order, and a step only a later side takes
 * sits where it comes in the game.
 */
function getSideSteps(sides: ReadonlyArray<ShownSide>, stepsOf: StepsOf) {
  const lists = sides.map(s => (s.side ? stepsOf(s.side) : []))
  const first = new Map<string, BuildStepSummary>()
  for (const step of lists.flat()) {
    if (!first.has(stepId(step))) {
      first.set(stepId(step), step)
    }
  }
  return {
    steps: Array.from(first.values()).sort((a, b) => a.timeMs - b.timeMs),
    byId: new Map(
      sides.map((s, i) => [s.key, new Map(lists[i].map(step => [stepId(step), step]))] as const),
    ),
  }
}

/** When a side's middle half of games take a step, and how many of its games take it at all. */
function getStepTip(step: BuildStepSummary, t: TFunction) {
  const range = t('builds.stepRange', 'Half of games {{early}} to {{late}}', {
    early: formatGameTime(step.earlyMs),
    late: formatGameTime(step.lateMs),
  })
  return step.share < OPTIONAL_STEP_SHARE
    ? `${range}, ${t('builds.stepShare', 'in {{share}} of games', { share: formatPercent(step.share) })}`
    : range
}

/** A side's supply and time for a step, with when its middle half of games take it when hovered. */
function StepCell({
  step,
  side,
  tone,
}: {
  step: BuildStepSummary | undefined
  side: ShownSide
  tone?: Tone
}) {
  const { t } = useTranslation()
  if (!step) {
    return (
      <Cell $end={true} $tone='muted'>
        -
      </Cell>
    )
  }
  return (
    <Cell $end={true} $tone={tone ?? (side.muted ? 'muted' : undefined)}>
      <Tooltip position='top' text={getStepTip(step, t)}>
        {formatStep(step)}
      </Tooltip>
    </Cell>
  )
}

/** A build's steps, a row each, with every side's supply and time. */
function StepsTable({ compare }: { compare: BuildCompare }) {
  const { t } = useTranslation()
  const { steps, byId } = getSideSteps(compare.sides, side => side.steps)
  // How often a step comes up, among the players whose order the rows follow.
  const order = compare.sides.find(s => s.side && s.key !== 'you')?.key

  return (
    <BuildsTable $columns={SIDE_COLUMNS}>
      <Row>
        <HeadCell>{t('builds.step', 'Step')}</HeadCell>
        <SideHeads sides={compare.sides} />
      </Row>
      <Row>
        <Cell $tone='muted'>{t('builds.gamesRow', 'Games')}</Cell>
        {compare.sides.map(s => (
          <Cell key={s.key} $end={true} $tone='muted'>
            {s.side?.games ?? '-'}
          </Cell>
        ))}
      </Row>
      {steps.map(step => {
        const id = stepId(step)
        const usual = order ? byId.get(order)?.get(id) : undefined
        const mine = byId.get('you')?.get(id)
        const theirs = compare.basis ? byId.get(compare.basis.key)?.get(id) : undefined
        const diff = mine && theirs ? mine.timeMs - theirs.timeMs : 0
        let tone: Tone | undefined
        if (diff >= OFF_STEP_MS) {
          tone = 'bad'
        } else if (diff <= -OFF_STEP_MS) {
          tone = 'good'
        }
        return (
          <Row key={id}>
            <Cell>
              <IconName>
                <GameIcon buildKey={step.key} size={ROW_ICON_SIZE} />
                {getStepName(step, t)}
              </IconName>
              {usual && usual.share < OPTIONAL_STEP_SHARE ? (
                <StepShare>
                  {t('builds.stepShare', 'in {{share}} of games', {
                    share: formatPercent(usual.share),
                  })}
                </StepShare>
              ) : null}
            </Cell>
            {compare.sides.map(s => (
              <StepCell
                key={s.key}
                step={byId.get(s.key)?.get(id)}
                side={s}
                tone={s.key === 'you' ? tone : undefined}
              />
            ))}
          </Row>
        )
      })}
    </BuildsTable>
  )
}

/** Each side's color in the timeline. Players at the user's level are a band, the rest marks. */
const SIDE_COLORS: Record<SideKey, string> = {
  top: 'var(--theme-data-4)',
  level: 'var(--theme-data-1)',
  winners: 'var(--theme-best)',
  you: 'var(--theme-tab-builds)',
}

type MarkShape = 'circle' | 'diamond' | 'square'

/** Each side's mark in the timeline. Players at the user's level are drawn as a band instead. */
const SIDE_SHAPES: Record<SideKey, MarkShape | undefined> = {
  top: 'circle',
  level: undefined,
  winners: 'diamond',
  you: 'square',
}

const ROW_HEIGHT = 32
/** The stretches of a game the timeline can zoom to, each from and to a time. */
const TIME_WINDOWS: ReadonlyArray<readonly [fromMs: number, toMs: number]> = [
  [0, 3 * 60_000],
  [3 * 60_000, 6 * 60_000],
  [6 * 60_000, 9 * 60_000],
  [9 * 60_000, 12 * 60_000],
  [12 * 60_000, 15 * 60_000],
]
/** Overlords are supply, so they sit with the buildings rather than the army. */
const OVERLORD_ID = 42
/** With more rows than this, the times run along the bottom of the timeline as well as the top. */
const BOTTOM_AXIS_ROWS = 15

/** What the timeline shows: the build's steps, the rows of the table, or every unit of a kind. */
type TimelineKind = 'steps' | 'workers' | 'army'

/** Whether a unit step is a worker or an army unit. Overlords count as neither. */
function getUnitKind(key: string, t: TFunction): TimelineKind | undefined {
  const [, id] = /^u(\d+)$/.exec(key) ?? []
  const unit = id !== undefined ? getUnitTypeInfo(Number(id), t) : undefined
  if (!unit || unit.isBuilding || Number(id) === OVERLORD_ID) {
    return undefined
  }
  return unit.isWorker ? 'workers' : 'army'
}

const TimelineLegend = styled.div`
  ${labelMedium};
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  color: var(--theme-on-surface-variant);
`

const LegendItem = styled.span<{ $muted?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  opacity: ${props => (props.$muted ? 0.5 : 1)};
`

const Mark = styled.span<{ $color: string; $shape: MarkShape }>`
  width: 10px;
  height: 10px;
  flex: none;
  background: ${props => props.$color};
  border-radius: ${props => (props.$shape === 'circle' ? '50%' : '2px')};
  transform: ${props => (props.$shape === 'diamond' ? 'rotate(45deg) scale(0.9)' : 'none')};
`

/** The band of the middle half of games at the user's level, with a line where most take a step. */
const BandSwatch = styled.span`
  position: relative;
  width: 22px;
  height: 10px;
  flex: none;
  border-radius: 4px;
  background: color-mix(in srgb, var(--theme-data-1) 32%, transparent);

  &::after {
    content: '';
    position: absolute;
    left: 50%;
    top: -2px;
    bottom: -2px;
    width: 2px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--theme-data-1);
  }
`

const TimelineGrid = styled.div`
  ${bodyMedium};
  display: grid;
  grid-template-columns: minmax(120px, 216px) minmax(0, 1fr);
`

/** A step's name and track, which highlight together when either is hovered. */
const TimelineRow = styled.div`
  display: contents;

  & > :first-child {
    border-radius: 4px 0 0 4px;
  }

  & > :last-child {
    border-radius: 0 4px 4px 0;
  }

  &:hover > * {
    background: var(--theme-container-high);
  }
`

const TimelineName = styled.span`
  height: ${ROW_HEIGHT}px;
  padding-inline: var(--space-2) var(--space-4);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  overflow: hidden;
  white-space: nowrap;
`

const TrackTooltip = styled(Tooltip)`
  display: block;
`

const Track = styled.div`
  position: relative;
  height: ${ROW_HEIGHT}px;
`

/** A minute's gridline down a row's track. */
const GridLine = styled.span`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--theme-outline-variant);
  opacity: 0.6;
`

const Band = styled.span`
  position: absolute;
  top: 50%;
  height: 10px;
  min-width: 4px;
  margin-top: -5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--theme-data-1) 32%, transparent);
`

const Median = styled.span`
  position: absolute;
  top: 50%;
  height: 14px;
  width: 2px;
  margin: -7px 0 0 -1px;
  border-radius: 1px;
  background: var(--theme-data-1);
`

const PlacedMark = styled(Mark)<{ $muted?: boolean }>`
  position: absolute;
  top: 50%;
  margin: -5px 0 0 -5px;
  box-shadow: 0 0 0 2px var(--theme-container-low);
  opacity: ${props => (props.$muted ? 0.5 : 1)};
`

const AxisLabels = styled.div`
  ${labelMedium};
  position: relative;
  height: 20px;
  margin-block: var(--space-1);
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const AxisLabel = styled.span`
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  white-space: nowrap;
`

/** A side's swatch in the legend and the tooltips: a band or its mark. */
function SideSwatch({ side }: { side: SideKey }) {
  const shape = SIDE_SHAPES[side]
  return shape ? <Mark $color={SIDE_COLORS[side]} $shape={shape} /> : <BandSwatch />
}

/**
 * The steps the timeline shows, by when the first side that takes each takes it, and the stretches
 * of the game that have any of them, to zoom to.
 */
function getTimelineSteps(compare: BuildCompare, kind: TimelineKind, t: TFunction) {
  const shown = compare.sides.filter(s => s.side)
  const { steps, byId } = getSideSteps(
    shown,
    kind === 'steps'
      ? side => side.steps
      : side => side.unitSteps.filter(step => getUnitKind(step.key, t) === kind),
  )
  const timeOf = (step: BuildStepSummary) =>
    Math.min(...shown.flatMap(s => byId.get(s.key)?.get(stepId(step))?.timeMs ?? []))
  steps.sort((a, b) => timeOf(a) - timeOf(b))
  const windows = TIME_WINDOWS.filter(([from, to]) =>
    steps.some(step => timeOf(step) >= from && timeOf(step) < to),
  )
  return { shown, steps, byId, timeOf, windows }
}

/**
 * A build's steps on a game clock, or every worker or army unit: when the middle half of games at
 * the user's level take each, and when the other sides typically do.
 */
function Timeline({
  compare,
  kind,
  window: picked,
}: {
  compare: BuildCompare
  kind: TimelineKind
  window: readonly [fromMs: number, toMs: number] | undefined
}) {
  const { t } = useTranslation()
  const { shown, steps: kindSteps, byId, timeOf } = getTimelineSteps(compare, kind, t)
  const steps = picked
    ? kindSteps.filter(step => timeOf(step) >= picked[0] && timeOf(step) < picked[1])
    : kindSteps

  const latest = Math.max(
    (picked?.[1] ?? 0) || 60_000,
    ...steps.flatMap(step =>
      shown.map(s => {
        const taken = byId.get(s.key)?.get(stepId(step))
        return taken ? Math.max(taken.timeMs, taken.lateMs) : 0
      }),
    ),
  )
  const every = picked || latest <= 12 * 60_000 ? 1 : 2
  const start = picked ? picked[0] / 60_000 : 0
  const end = picked ? picked[1] / 60_000 : Math.ceil(latest / (every * 60_000)) * every
  const ticks = Array.from({ length: (end - start) / every + 1 }, (_, i) => start + i * every)
  const at = (ms: number) => {
    const clamped = Math.min(Math.max(ms, start * 60_000), end * 60_000)
    return `${((clamped - start * 60_000) / ((end - start) * 60_000)) * 100}%`
  }
  // A side's step outside the picked stretch sits faded at its edge, before or after it.
  const inWindow = (ms: number) => ms >= start * 60_000 && ms <= end * 60_000

  const axis = (place: string) => [
    <span key={`${place}-gap`} />,
    <AxisLabels key={place}>
      {ticks.map(minute => (
        <AxisLabel key={minute} style={{ left: at(minute * 60_000) }}>
          {formatGameTime(minute * 60_000)}
        </AxisLabel>
      ))}
    </AxisLabels>,
  ]

  return (
    <>
      <TimelineLegend>
        {shown.map(s => (
          <LegendItem key={s.key} $muted={s.muted}>
            <SideSwatch side={s.key} />
            {SIDE_SHAPES[s.key]
              ? s.label
              : t('builds.timelineBandLegend', '{{side}}, the middle half of games', {
                  side: s.label,
                })}
          </LegendItem>
        ))}
      </TimelineLegend>
      {steps.length ? (
        <TimelineGrid>
          {axis('top')}
          {steps.map(step => {
            const id = stepId(step)
            const taken = shown.map(s => ({ s, step: byId.get(s.key)?.get(id) }))
            const band = taken.find(({ s }) => !SIDE_SHAPES[s.key])?.step
            return (
              <TimelineRow key={id}>
                <TimelineName>
                  <GameIcon buildKey={step.key} size={ROW_ICON_SIZE} />
                  {getStepName(step, t)}
                </TimelineName>
                <TrackTooltip
                  position='top'
                  tabIndex={-1}
                  text={
                    <TipLines>
                      <TipLine>
                        <GameIcon buildKey={step.key} size={SMALL_ICON_SIZE} />
                        {getStepName(step, t)}
                      </TipLine>
                      {taken.map(({ s, step: sideStep }) => (
                        <TipLine key={s.key}>
                          <SideSwatch side={s.key} />
                          {s.label} {formatStep(sideStep)}
                          {sideStep ? ` (${getStepTip(sideStep, t)})` : ''}
                        </TipLine>
                      ))}
                    </TipLines>
                  }>
                  <Track>
                    {ticks.map(minute => (
                      <GridLine key={minute} style={{ left: at(minute * 60_000) }} />
                    ))}
                    {band ? (
                      <>
                        <Band
                          style={{
                            left: at(band.earlyMs),
                            width: `calc(${at(band.lateMs)} - ${at(band.earlyMs)})`,
                          }}
                        />
                        <Median style={{ left: at(band.timeMs) }} />
                      </>
                    ) : null}
                    {taken.map(({ s, step: sideStep }) => {
                      const shape = SIDE_SHAPES[s.key]
                      return sideStep && shape ? (
                        <PlacedMark
                          key={s.key}
                          $color={SIDE_COLORS[s.key]}
                          $shape={shape}
                          $muted={s.muted || !inWindow(sideStep.timeMs)}
                          style={{ left: at(sideStep.timeMs) }}
                        />
                      ) : null
                    })}
                  </Track>
                </TrackTooltip>
              </TimelineRow>
            )
          })}
          {steps.length > BOTTOM_AXIS_ROWS ? axis('bottom') : null}
        </TimelineGrid>
      ) : (
        <Text>{t('builds.timingsNone', 'None of these in most games of this build.')}</Text>
      )}
    </>
  )
}

type View = 'table' | 'timeline'

/**
 * The picked build's steps as each side takes them, as a table of supply and time or on a game
 * clock.
 */
export function BuildOrder({
  compare,
  note,
  typicalGame,
}: {
  compare: BuildCompare
  /** Which builds stand in for sides that don't play the picked one. */
  note: string | undefined
  /** A top player's game in the user's replays, the one closest to how top players play it. */
  typicalGame: string | undefined
}) {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('table')
  const [kind, setKind] = useState<TimelineKind>('steps')
  const [windowFrom, setWindowFrom] = useState<number>()

  const viewOptions: Array<SegmentOption<View>> = [
    { value: 'table', label: t('builds.viewTable', 'Table') },
    { value: 'timeline', label: t('builds.viewTimeline', 'Timeline') },
  ]
  const kindOptions: Array<SegmentOption<TimelineKind>> = [
    { value: 'steps', label: t('builds.timelineSteps', 'Build order') },
    { value: 'workers', label: t('builds.timelineWorkers', 'Every worker') },
    { value: 'army', label: t('builds.timelineArmy', 'Every army unit') },
  ]
  const { windows } = getTimelineSteps(compare, kind, t)
  const picked = windows.find(([from]) => from === windowFrom)
  const windowOptions: Array<SegmentOption<number>> = [
    { value: -1, label: t('builds.timingsWholeGame', 'Whole game') },
    ...windows.map(([from, to]) => ({
      value: from,
      label: t('builds.timingsWindow', '{{from}} to {{to}}', {
        from: formatGameTime(from),
        to: formatGameTime(to),
      }),
    })),
  ]
  const fewWinners = compare.sides.some(s => s.key === 'winners' && !s.side)

  return (
    <PaddedPanel>
      <PanelHead $spread={true}>
        <PanelTitle>
          <HelpLabel
            label={getBuildFamilyName(compare.family, t)}
            help={[
              t(
                'builds.stepsHelp',
                'The usual supply and time of each step. A side shows a step when most of its games take it, up to 10 minutes for buildings and tech and 15 for units.',
              ),
              fewWinners
                ? t('builds.fewWinners', 'Too few won games to show how winners play it.')
                : '',
            ].join(' ')}
          />
        </PanelTitle>
        {note ? <PanelHeadNote>{note}</PanelHeadNote> : null}
        {typicalGame ? (
          <OpenGameButton
            label={t('builds.metaOpenGame', "Open a top player's game")}
            onClick={() => push(getGameStatsUrl(typicalGame))}
          />
        ) : null}
        <HeadControls>
          {view === 'timeline' ? (
            <>
              <SegmentMenu
                label={t('builds.timingsShow', 'What to show')}
                showLabel={false}
                options={kindOptions}
                value={kind}
                onChange={setKind}
              />
              {windows.length > 1 ? (
                <SegmentMenu
                  label={t('builds.timingsWhen', 'When in the game')}
                  showLabel={false}
                  options={windowOptions}
                  value={picked ? picked[0] : -1}
                  onChange={value => setWindowFrom(value < 0 ? undefined : value)}
                />
              ) : null}
            </>
          ) : null}
          <Segmented
            label={t('builds.view', 'View')}
            options={viewOptions}
            value={view}
            onChange={setView}
          />
        </HeadControls>
      </PanelHead>
      {view === 'table' ? (
        <StepsTable compare={compare} />
      ) : (
        <Timeline compare={compare} kind={kind} window={picked} />
      )}
    </PaddedPanel>
  )
}
