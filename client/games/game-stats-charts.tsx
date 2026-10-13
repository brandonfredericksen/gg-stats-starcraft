import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  XAxisTickContentProps,
  YAxis,
} from 'recharts'
import styled from 'styled-components'
import { getGameDurationString } from '../../common/games/game-duration'
import {
  GamePlayerStats,
  getSupplyBlockedTimeline,
  PlayerTimeline,
} from '../../common/games/game-stats'
import { RaceTag } from '../material/race-tag'
import { bodyMedium } from '../styles/typography'
import {
  getRatePerMinute,
  getTimelineTicks,
  playerDataKey,
  toTimelineRows,
} from './game-stats-model'
import { gameScrubAtom } from './game-stats-scrub'
import {
  LegendButton,
  Section,
  SectionErrorBoundary,
  SectionTitle,
  StatsPanel,
  useCompactStatFormat,
  useStatFormat,
} from './game-stats-shared'

const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;

  & > ${SectionTitle} {
    flex: 1 1 auto;
  }
`

const LineSwatch = styled.span<{ $color: string }>`
  width: 14px;
  height: 3px;
  border-radius: 2px;
  background: ${props => props.$color};
`

const ChartGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
`

/** A chart's tooltip can be bigger than its chart, so it reaches past the card, over its neighbors. */
const ChartCard = styled(StatsPanel)`
  position: relative;
  padding: 16px 18px 10px;
  overflow: visible;

  display: flex;
  flex-direction: column;
  gap: 8px;

  &:hover {
    z-index: 1;
  }
`

const ChartTitle = styled.h3`
  ${bodyMedium};
  margin: 0;
  font-weight: 600;
`

const ChartArea = styled.div`
  position: relative;
  width: 100%;
  height: 144px;
`

/** Where the y axis's labels go, left of what's charted. */
const Y_AXIS_WIDTH = 40
/** The room recharts leaves above what's charted, and the x axis takes below it. */
const PLOT_TOP = 5
const X_AXIS_HEIGHT = 30

/**
 * A line over the chart at the moment picked. It's drawn over the chart rather than in it, so
 * following the minimap's playback doesn't redraw every chart.
 */
const ScrubLine = styled.div`
  position: absolute;
  top: ${PLOT_TOP}px;
  bottom: ${X_AXIS_HEIGHT}px;
  width: 1.5px;
  background: var(--theme-amber);
  pointer-events: none;
`

function ChartScrubLine({ timesMs }: { timesMs: ReadonlyArray<number> }) {
  const scrub = useAtomValue(gameScrubAtom)
  const start = timesMs[0] ?? 0
  const end = timesMs.at(-1) ?? 0
  if (!scrub || end <= start) {
    return null
  }
  const fraction = Math.max(0, Math.min(1, (scrub.timeMs - start) / (end - start)))
  return (
    <ScrubLine
      style={{ left: `calc(${Y_AXIS_WIDTH}px + (100% - ${Y_AXIS_WIDTH}px) * ${fraction})` }}
    />
  )
}

export const chartTooltipStyle = {
  padding: '8px 10px',
  background: 'var(--theme-container-high)',
  border: '1px solid var(--theme-outline-strong)',
  borderRadius: 8,
  boxShadow: '0 8px 24px rgb(0 0 0 / 0.3)',
  fontSize: 12,
  lineHeight: '18px',
}

export const chartTooltipLabelStyle = {
  marginBottom: 2,
  color: 'var(--theme-on-surface-variant)',
}

export const chartTooltipItemStyle = {
  padding: 0,
}

export const TICK_FONT_SIZE = 12

/**
 * A time on a chart's axis. The first and last line up with the chart's edges rather than
 * centering on them, so the start and end of the game are never cut off.
 */
function TimeTick({ x, y, payload, index, visibleTicksCount }: XAxisTickContentProps) {
  let anchor: 'start' | 'middle' | 'end' = 'middle'
  if (index === 0) {
    anchor = 'start'
  } else if (index === visibleTicksCount - 1) {
    anchor = 'end'
  }
  return (
    <text
      x={x}
      y={y}
      dy='0.71em'
      fontSize={TICK_FONT_SIZE}
      fill='var(--theme-on-surface-variant)'
      textAnchor={anchor}>
      {getGameDurationString(Number(payload.value))}
    </text>
  )
}

/**
 * How far back income is measured over. Workers bring minerals back in bursts, so a shorter window
 * jumps around with every trip.
 */
const INCOME_WINDOW_MS = 30_000
/** How far back EAPM is measured over, the minute the name says. */
const EAPM_WINDOW_MS = 60_000

/** How visible the lines of players who aren't focused are, while any are. */
const UNFOCUSED_LINE_OPACITY = 0.15

function TimelineChart({
  timesMs,
  players,
  colors,
  focused,
  getValues,
  lineType = 'linear',
  formatValue,
}: {
  timesMs: ReadonlyArray<number>
  players: ReadonlyArray<GamePlayerStats>
  colors: ReadonlyMap<number, string>
  /** Players picked out to stand out from the rest, or none to show everyone the same. */
  focused: ReadonlySet<number>
  getValues: (timeline: PlayerTimeline) => ReadonlyArray<number | undefined> | undefined
  /**
   * How lines get from one value to the next: straight, or in steps for values that only change
   * in whole steps, like a count of bases, or that each cover the time before them.
   */
  lineType?: 'linear' | 'stepAfter' | 'stepBefore'
  /** Shows values some other way than as numbers, like lengths of time. */
  formatValue?: (value: number) => string
}) {
  const format = useStatFormat()
  const compactFormat = useCompactStatFormat()
  const setScrub = useSetAtom(gameScrubAtom)
  // Players the game didn't report this for are left out, rather than drawn as zero. Focused
  // players are drawn last, so their lines are on top.
  const shown = players
    .filter(p => p.timeline && getValues(p.timeline))
    .toSorted((a, b) => Number(focused.has(a.id)) - Number(focused.has(b.id)))
  const isDimmed = (player: GamePlayerStats) => focused.size > 0 && !focused.has(player.id)
  return (
    <LineChart
      data={toTimelineRows(timesMs, shown, getValues)}
      margin={{ left: 0, right: 0 }}
      // Picks the moment for the minimap, and the build orders and chat, to show.
      onClick={state => {
        if (state.activeLabel !== undefined) {
          setScrub({ timeMs: Number(state.activeLabel), fromMinimap: false })
        }
      }}
      style={{ cursor: 'pointer' }}>
      <CartesianGrid stroke='var(--theme-outline-variant)' vertical={false} />
      <XAxis
        dataKey='timeMs'
        type='number'
        domain={['dataMin', 'dataMax']}
        ticks={getTimelineTicks(timesMs.at(-1) ?? 0)}
        interval={0}
        stroke='var(--theme-outline-strong)'
        tick={props => <TimeTick {...props} />}
        tickLine={false}
      />
      <YAxis
        width={Y_AXIS_WIDTH}
        tickCount={3}
        allowDecimals={false}
        axisLine={false}
        tickLine={false}
        tick={{ fontSize: TICK_FONT_SIZE, fill: 'var(--theme-on-surface-variant)' }}
        tickFormatter={value => (formatValue ?? compactFormat.format)(Number(value))}
      />
      <Tooltip
        contentStyle={chartTooltipStyle}
        labelStyle={chartTooltipLabelStyle}
        itemStyle={chartTooltipItemStyle}
        wrapperStyle={{ zIndex: 2 }}
        allowEscapeViewBox={{ x: true, y: true }}
        // Highest first, so the order matches the lines at that moment.
        itemSorter={item => -(typeof item.value === 'number' ? item.value : 0)}
        labelFormatter={ms => getGameDurationString(Number(ms))}
        formatter={value =>
          typeof value === 'number' ? (formatValue ?? format.format)(value) : value
        }
      />
      {shown.map(player => (
        <Line
          key={player.id}
          type={lineType}
          dataKey={playerDataKey(player)}
          name={player.name}
          stroke={colors.get(player.id)}
          strokeOpacity={isDimmed(player) ? UNFOCUSED_LINE_OPACITY : 1}
          strokeWidth={2.2}
          dot={false}
          // Animating hundreds of points per line in a long game isn't worth what it costs.
          isAnimationActive={false}
        />
      ))}
    </LineChart>
  )
}

/** How each player's army, economy, supply and speed went over the game. */
export function GameStatsTimelines({
  timesMs,
  players,
  playerColors,
}: {
  timesMs: ReadonlyArray<number>
  players: ReadonlyArray<GamePlayerStats>
  playerColors: ReadonlyMap<number, string>
}) {
  const { t } = useTranslation()
  const [focused, setFocused] = useState<ReadonlySet<number>>(() => new Set())
  const tracked = players.filter(p => p.timeline?.workers.length)
  if (timesMs.length < 2 || !tracked.length) {
    return null
  }
  const toggleFocus = (playerId: number) => {
    setFocused(current => {
      const next = new Set(current)
      if (!next.delete(playerId)) {
        next.add(playerId)
      }
      return next
    })
  }
  const charts: Array<{
    key: string
    title: string
    getValues: (timeline: PlayerTimeline) => ReadonlyArray<number | undefined> | undefined
    lineType?: 'linear' | 'stepAfter' | 'stepBefore'
    formatValue?: (value: number) => string
  }> = [
    {
      key: 'armyScore',
      title: t('gameStats.armyScore', 'Army score'),
      getValues: tl => tl.armyScore,
    },
    { key: 'workers', title: t('gameStats.workers', 'Workers'), getValues: tl => tl.workers },
    {
      key: 'income',
      title: t('gameStats.incomePerMinute', 'Income per minute'),
      getValues: tl => getRatePerMinute(timesMs, tl.resourcesMined, INCOME_WINDOW_MS),
    },
    {
      key: 'eapm',
      title: t('gameStats.eapm', 'EAPM'),
      getValues: tl =>
        tl.effectiveActions && getRatePerMinute(timesMs, tl.effectiveActions, EAPM_WINDOW_MS),
    },
    {
      key: 'unspent',
      title: t('gameStats.unspentResources', 'Unspent resources'),
      getValues: tl => tl.unspent,
    },
    {
      key: 'supply',
      title: t('gameStats.supplyUsed', 'Supply used'),
      getValues: tl => tl.supplyUsed,
    },
    {
      key: 'supplyBlocked',
      title: t('gameStats.supplyBlocked', 'Supply blocked'),
      // The time spent blocked so far, which rises while blocked and stays flat otherwise. Like
      // the scoreboard, it starts counting a few minutes in, after blocks a build plans for.
      getValues: tl => getSupplyBlockedTimeline(tl.supplyBlockedMs, timesMs),
      formatValue: getGameDurationString,
    },
    {
      key: 'resourcesLost',
      title: t('gameStats.resourcesLostOverTime', 'Resources lost'),
      getValues: tl => tl.resourcesLost,
    },
    {
      key: 'bases',
      title: t('gameStats.bases', 'Bases'),
      getValues: tl => tl.bases,
      lineType: 'stepAfter',
    },
  ]

  return (
    <Section>
      <Header>
        <SectionTitle>{t('gameStats.overTime', 'Over time')}</SectionTitle>
        {tracked.map(player => (
          <LegendButton
            key={player.id}
            type='button'
            aria-pressed={focused.has(player.id)}
            $dimmed={focused.size > 0 && !focused.has(player.id)}
            onClick={() => toggleFocus(player.id)}>
            <LineSwatch $color={playerColors.get(player.id) ?? 'transparent'} />
            {player.race ? <RaceTag race={player.race} /> : null}
            {player.name}
          </LegendButton>
        ))}
      </Header>
      <ChartGrid>
        {charts
          .filter(chart => tracked.some(p => p.timeline && chart.getValues(p.timeline)))
          .map(chart => (
            <ChartCard key={chart.key}>
              <ChartTitle>{chart.title}</ChartTitle>
              <SectionErrorBoundary>
                <ChartArea>
                  <ResponsiveContainer width='100%' height='100%'>
                    <TimelineChart
                      timesMs={timesMs}
                      players={tracked}
                      colors={playerColors}
                      focused={focused}
                      getValues={chart.getValues}
                      lineType={chart.lineType}
                      formatValue={chart.formatValue}
                    />
                  </ResponsiveContainer>
                  <ChartScrubLine timesMs={timesMs} />
                </ChartArea>
              </SectionErrorBoundary>
            </ChartCard>
          ))}
      </ChartGrid>
    </Section>
  )
}
