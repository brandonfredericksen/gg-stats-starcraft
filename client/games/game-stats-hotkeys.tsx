import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { PlayerHotkeyPresses } from '../../common/games/command-stats'
import { getGameDurationString } from '../../common/games/game-duration'
import {
  FASTEST_MS_PER_FRAME,
  GamePlayerStats,
  HOTKEY_PRESS_KINDS,
  HotkeyPress,
  HotkeyPressKind,
} from '../../common/games/game-stats'
import { TypedIpcRenderer } from '../../common/ipc'
import logger from '../logging/logger'
import { RaceTag } from '../material/race-tag'
import { SegmentMenu, SegmentOption } from '../material/segmented'
import { bodyMedium, bodySmall, labelMedium, singleLine } from '../styles/typography'
import { GameIcon } from './game-icon'
import { getTimelineTicks, toUnitEntries } from './game-stats-model'
import { gameScrubAtom } from './game-stats-scrub'
import {
  PlayerSwatch,
  Section,
  SectionErrorBoundary,
  SectionNote,
  SectionTitle,
  StatsPanel,
  useStatFormat,
} from './game-stats-shared'
import { useMyPlayerNames } from './my-player-names'

const ipcRenderer = new TypedIpcRenderer()

/** The groups in the order their keys sit on the keyboard. */
const GROUP_ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]

const ROW_HEIGHT = 18
const PLOT_HEIGHT = ROW_HEIGHT * GROUP_ROWS.length
/** Where the group numbers go, left of the presses. */
const KEY_COLUMN_WIDTH = 28
/** Where each group's count of presses goes, right of them. */
const COUNT_COLUMN_WIDTH = 44
/** How far from a press, in pixels, hovering still picks it. */
const HOVER_REACH_PX = 6

/**
 * How each kind of press is drawn: selecting a group is the thin, common mark, while making a group
 * and adding to one stand out, since they say when the player's groups changed.
 */
const MARKS: Record<HotkeyPressKind, { width: number; inset: number; opacity: number }> = {
  select: { width: 1.5, inset: 4, opacity: 0.75 },
  assign: { width: 3, inset: 1, opacity: 1 },
  add: { width: 3, inset: 1, opacity: 0.5 },
}

/** Marks that change a group are drawn in the text color, so they read apart from selecting. */
const GROUP_CHANGE_COLOR = 'var(--theme-on-surface)'

/** The icon beside a group's mark when it's made or added to, for the unit it held most of. */
const GROUP_ICON_SIZE = 16

/**
 * Where to put an icon for the unit each group held most of, at each press that changed the group
 * to a different main unit. An icon too close to the one before it in its row is left out, so they
 * never overlap.
 */
function toGroupIcons(presses: ReadonlyArray<HotkeyPress>, durationMs: number, plotWidth: number) {
  const icons: Array<{ timeMs: number; group: number; unitId: number }> = []
  if (plotWidth <= 0) {
    return icons
  }
  const lastByGroup = new Map<number, { x: number; unitId: number }>()
  for (const press of presses) {
    if (press.kind === 'select' || !press.units?.length) {
      continue
    }
    const [unitId] = press.units.reduce((most, entry) => (entry[1] > most[1] ? entry : most))
    const x = (press.timeMs / durationMs) * plotWidth
    const last = lastByGroup.get(press.group)
    if (last && (last.unitId === unitId || x < last.x + GROUP_ICON_SIZE + 6)) {
      continue
    }
    lastByGroup.set(press.group, { x, unitId })
    icons.push({ timeMs: press.timeMs, group: press.group, unitId })
  }
  return icons
}

/**
 * The two players charted first: the user's own player when they're in the game, or else the
 * first, and someone from the other side.
 */
function defaultPicks(
  players: ReadonlyArray<GamePlayerStats>,
  myNames: ReadonlyArray<string> | undefined,
): [number, number] {
  const mine = new Set(myNames?.map(n => n.toLowerCase()))
  const first = players.find(p => p.names.some(n => mine.has(n.toLowerCase()))) ?? players[0]
  const second =
    players.find(p => p.team !== first.team) ?? players.find(p => p.id !== first.id) ?? first
  return [first.id, second.id]
}

/** The presses of the players whose stats were saved without them, from the replay's commands. */
function useReplayPresses(replayPath: string | undefined, needed: boolean) {
  const [read, setRead] = useState<{ path: string; players?: PlayerHotkeyPresses[] }>()
  useEffect(() => {
    if (!replayPath || !needed) {
      return undefined
    }
    let cancelled = false
    Promise.resolve(ipcRenderer.invoke('replayReadHotkeys', replayPath))
      .then(players => {
        if (!cancelled) {
          setRead({ path: replayPath, players })
        }
      })
      .catch(err => {
        logger.error(`Error reading the hotkeys in ${replayPath}: ${getErrorStack(err)}`)
        if (!cancelled) {
          setRead({ path: replayPath })
        }
      })
    return () => {
      cancelled = true
    }
  }, [replayPath, needed])
  return read?.path === replayPath ? read?.players : undefined
}

/** A player's presses from the replay, which can't say what each group held. */
function fromReplay(
  player: GamePlayerStats,
  replayPlayers: ReadonlyArray<PlayerHotkeyPresses> | undefined,
): HotkeyPress[] | undefined {
  const lowered = player.names.map(n => n.toLowerCase())
  const found = replayPlayers?.find(p => lowered.includes(p.name.toLowerCase()))
  return found?.presses.flatMap(([frame, kind, group]) => {
    const pressKind = HOTKEY_PRESS_KINDS[kind]
    return pressKind && group >= 0 && group <= 9
      ? [{ timeMs: frame * FASTEST_MS_PER_FRAME, kind: pressKind, group }]
      : []
  })
}

/** The press in a group's row closest to a moment, if one is within `reachMs` of it. */
export function findPressNear(
  presses: ReadonlyArray<HotkeyPress>,
  group: number,
  timeMs: number,
  reachMs: number,
): HotkeyPress | undefined {
  let best: HotkeyPress | undefined
  for (const press of presses) {
    if (press.group !== group) {
      continue
    }
    const distance = Math.abs(press.timeMs - timeMs)
    if (distance <= reachMs && (!best || distance < Math.abs(best.timeMs - timeMs))) {
      best = press
    }
  }
  return best
}

/** Each kind of press in each group's row, as one path apiece, in a plot `durationMs` wide. */
function toPaths(presses: ReadonlyArray<HotkeyPress>) {
  const paths: Record<HotkeyPressKind, string[]> = { select: [], assign: [], add: [] }
  for (const press of presses) {
    const row = GROUP_ROWS.indexOf(press.group)
    const { inset } = MARKS[press.kind]
    const top = row * ROW_HEIGHT + inset
    paths[press.kind].push(`M${press.timeMs} ${top}V${top + ROW_HEIGHT - inset * 2}`)
  }
  return paths
}

const PlayerPanel = styled(StatsPanel)`
  padding: 14px 18px 12px;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`

const PlayerHeader = styled.div`
  ${bodyMedium};
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
`

const PlayerHeaderName = styled.span`
  ${singleLine};
  font-weight: 600;
`

const PlayerSummary = styled.span`
  ${bodySmall};
  margin-left: auto;
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const ChartRow = styled.div`
  display: grid;
  grid-template-columns: ${KEY_COLUMN_WIDTH}px minmax(0, 1fr) ${COUNT_COLUMN_WIDTH}px;
`

const KeyColumn = styled.div`
  ${labelMedium};
  display: grid;
  grid-auto-rows: ${ROW_HEIGHT}px;
  align-items: center;
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const CountColumn = styled(KeyColumn)`
  justify-items: end;
`

const Plot = styled.div`
  position: relative;
  height: ${PLOT_HEIGHT}px;
  cursor: pointer;

  background: repeating-linear-gradient(
    to bottom,
    var(--theme-container-low) 0 ${ROW_HEIGHT}px,
    transparent ${ROW_HEIGHT}px ${ROW_HEIGHT * 2}px
  );
  border-radius: var(--radius-sm);
`

const PlotSvg = styled.svg`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
`

const ScrubLine = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1.5px;
  background: repeating-linear-gradient(to bottom, var(--theme-amber) 0 4px, transparent 4px 8px);
  opacity: 0.7;
  pointer-events: none;
`

/** Sits on the presses after the mark it belongs to, so the marks don't run through it. */
const GroupIcon = styled.div`
  position: absolute;
  height: ${ROW_HEIGHT}px;
  margin-left: 2px;
  padding: 0 1px;

  display: flex;
  align-items: center;

  background: var(--theme-container-high);
  border-radius: 3px;
  pointer-events: none;
`

const HoverRing = styled.div`
  position: absolute;
  width: 9px;
  height: ${ROW_HEIGHT}px;
  margin-left: -4.5px;
  border: 1.5px solid var(--theme-amber);
  border-radius: 3px;
  pointer-events: none;
`

const TimeAxis = styled.div`
  ${bodySmall};
  position: relative;
  height: 18px;
  margin: 0 ${COUNT_COLUMN_WIDTH}px 0 ${KEY_COLUMN_WIDTH}px;
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const TimeTick = styled.span<{ $align: 'start' | 'middle' | 'end' }>`
  position: absolute;
  top: 2px;
  transform: translateX(${props => ({ start: '0', middle: '-50%', end: '-100%' })[props.$align]});
  white-space: nowrap;
`

const PressTooltip = styled.div`
  ${bodySmall};
  position: absolute;
  z-index: 2;
  min-width: 160px;
  max-width: 260px;
  padding: 8px 10px;

  display: flex;
  flex-direction: column;
  gap: 2px;

  background: var(--theme-container-high);
  border: 1px solid var(--theme-outline-strong);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.3);
  pointer-events: none;
`

const TooltipTitle = styled.div`
  color: var(--theme-on-surface-variant);
`

const TooltipUnit = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
`

const TooltipUnitCount = styled.span`
  margin-left: auto;
  padding-left: var(--space-3);
  font-variant-numeric: tabular-nums;
`

const Legend = styled.div`
  ${bodySmall};
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  color: var(--theme-on-surface-variant);
`

const LegendItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
`

const LegendMark = styled.span<{ $kind: HotkeyPressKind; $color: string }>`
  width: ${props => MARKS[props.$kind].width}px;
  height: ${props => ROW_HEIGHT - MARKS[props.$kind].inset * 2}px;
  background: ${props => props.$color};
  opacity: ${props => MARKS[props.$kind].opacity};
`

function usePressLabel() {
  const { t } = useTranslation()
  return (press: HotkeyPress) => {
    switch (press.kind) {
      case 'assign':
        return t('gameStats.hotkeyAssigned', 'Made group {{group}}', { group: press.group })
      case 'add':
        return t('gameStats.hotkeyAdded', 'Added to group {{group}}', { group: press.group })
      default:
        return t('gameStats.hotkeySelected', 'Selected group {{group}}', { group: press.group })
    }
  }
}

function PressDetails({ press }: { press: HotkeyPress }) {
  const { t } = useTranslation()
  const pressLabel = usePressLabel()
  const entries = press.units && toUnitEntries(press.units, t)
  return (
    <>
      <TooltipTitle>
        {getGameDurationString(press.timeMs)} · {pressLabel(press)}
      </TooltipTitle>
      {entries?.length === 0 ? <div>{t('gameStats.hotkeyGroupEmpty', 'Nothing left')}</div> : null}
      {entries?.map(entry => (
        <TooltipUnit key={entry.unitId}>
          <GameIcon buildKey={`u${entry.unitId}`} size={20} />
          {entry.name}
          <TooltipUnitCount>{entry.count}</TooltipUnitCount>
        </TooltipUnit>
      ))}
    </>
  )
}

function PlayerHotkeyChart({
  player,
  presses,
  color,
  durationMs,
  picker,
}: {
  player: GamePlayerStats
  presses: ReadonlyArray<HotkeyPress>
  color: string
  durationMs: number
  /** Picks which player the chart shows, in place of their name. */
  picker?: React.ReactNode
}) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const plotRef = useRef<HTMLDivElement>(null)
  const [plotWidth, setPlotWidth] = useState(0)
  useEffect(() => {
    const plot = plotRef.current
    if (!plot) {
      return undefined
    }
    const observer = new ResizeObserver(([entry]) => setPlotWidth(entry.contentRect.width))
    observer.observe(plot)
    return () => observer.disconnect()
  }, [])
  const scrub = useAtomValue(gameScrubAtom)
  const setScrub = useSetAtom(gameScrubAtom)
  const [hovered, setHovered] = useState<{
    press: HotkeyPress
    x: number
    y: number
    plotWidth: number
  }>()

  const paths = toPaths(presses)
  const countsByGroup = new Map<number, number>()
  for (const press of presses) {
    countsByGroup.set(press.group, (countsByGroup.get(press.group) ?? 0) + 1)
  }
  const selects = presses.filter(p => p.kind === 'select').length
  const playedMs = player.leftAtMs ?? durationMs
  const perMinute = playedMs > 0 ? Math.round(selects / (playedMs / 60_000)) : 0

  const toFraction = (ms: number) => Math.max(0, Math.min(1, ms / durationMs))

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = plotRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) {
      return
    }
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const group = GROUP_ROWS[Math.floor(y / ROW_HEIGHT)]
    const msPerPx = durationMs / rect.width
    const press =
      group === undefined
        ? undefined
        : findPressNear(presses, group, x * msPerPx, HOVER_REACH_PX * msPerPx)
    setHovered(press ? { press, x, y, plotWidth: rect.width } : undefined)
  }

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = plotRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) {
      return
    }
    const timeMs = hovered
      ? hovered.press.timeMs
      : toFraction((event.clientX - rect.left) / rect.width) * durationMs
    setScrub({ timeMs, fromMinimap: false })
  }

  const ticks = getTimelineTicks(durationMs)

  return (
    <PlayerPanel>
      <PlayerHeader>
        {picker ?? (
          <>
            <PlayerSwatch $color={color} />
            {player.race ? <RaceTag race={player.race} /> : null}
            <PlayerHeaderName title={player.name}>{player.name}</PlayerHeaderName>
          </>
        )}
        <PlayerSummary>
          {t('gameStats.hotkeySummary', '{{presses}} presses · {{perMinute}} selects per min', {
            presses: format.format(presses.length),
            perMinute: format.format(perMinute),
          })}
        </PlayerSummary>
      </PlayerHeader>
      <ChartRow>
        <KeyColumn aria-hidden={true}>
          {GROUP_ROWS.map(group => (
            <span key={group}>{group}</span>
          ))}
        </KeyColumn>
        <Plot
          ref={plotRef}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHovered(undefined)}
          onClick={onClick}
          role='img'
          aria-label={t('gameStats.hotkeyChartLabel', "{{name}}'s hotkey presses over the game", {
            name: player.name,
          })}>
          <PlotSvg viewBox={`0 0 ${durationMs} ${PLOT_HEIGHT}`} preserveAspectRatio='none'>
            {(['select', 'add', 'assign'] as const).map(kind => (
              <path
                key={kind}
                d={paths[kind].join('')}
                stroke={kind === 'select' ? color : GROUP_CHANGE_COLOR}
                strokeOpacity={MARKS[kind].opacity}
                strokeWidth={MARKS[kind].width}
                vectorEffect='non-scaling-stroke'
                fill='none'
              />
            ))}
          </PlotSvg>
          {toGroupIcons(presses, durationMs, plotWidth).map(icon => (
            <GroupIcon
              key={`${icon.group}-${icon.timeMs}`}
              style={{
                left: `${toFraction(icon.timeMs) * 100}%`,
                top: GROUP_ROWS.indexOf(icon.group) * ROW_HEIGHT,
              }}>
              <GameIcon
                buildKey={`u${icon.unitId}`}
                size={GROUP_ICON_SIZE}
                color='var(--theme-on-surface)'
              />
            </GroupIcon>
          ))}
          {scrub ? <ScrubLine style={{ left: `${toFraction(scrub.timeMs) * 100}%` }} /> : null}
          {hovered ? (
            <>
              <HoverRing
                style={{
                  left: `${toFraction(hovered.press.timeMs) * 100}%`,
                  top: GROUP_ROWS.indexOf(hovered.press.group) * ROW_HEIGHT,
                }}
              />
              <PressTooltip
                style={{
                  top: hovered.y + 14,
                  // Flips to the left of the pointer past the middle, so it stays on the card.
                  ...(hovered.x > hovered.plotWidth / 2
                    ? { right: hovered.plotWidth - hovered.x + 12 }
                    : { left: hovered.x + 12 }),
                }}>
                <PressDetails press={hovered.press} />
              </PressTooltip>
            </>
          ) : null}
        </Plot>
        <CountColumn>
          {GROUP_ROWS.map(group => (
            <span key={group}>{format.format(countsByGroup.get(group) ?? 0)}</span>
          ))}
        </CountColumn>
      </ChartRow>
      <TimeAxis aria-hidden={true}>
        {ticks.map((ms, i) => {
          let align: 'start' | 'middle' | 'end' = 'middle'
          if (i === 0) {
            align = 'start'
          } else if (i === ticks.length - 1) {
            align = 'end'
          }
          return (
            <TimeTick key={ms} $align={align} style={{ left: `${toFraction(ms) * 100}%` }}>
              {getGameDurationString(ms)}
            </TimeTick>
          )
        })}
      </TimeAxis>
    </PlayerPanel>
  )
}

/**
 * Every hotkey each player pressed over the game, a row per group, with what the group held for
 * the presses the game recorded that for.
 */
export function GameHotkeys({
  players,
  playerColors,
  durationMs,
  replayPath,
}: {
  players: ReadonlyArray<GamePlayerStats>
  playerColors: ReadonlyMap<number, string>
  durationMs: number
  replayPath?: string
}) {
  const { t } = useTranslation()
  const myNames = useMyPlayerNames()
  const [picked, setPicked] = useState<[number, number]>()
  const humans = players.filter(p => p.apm !== undefined)
  const needsReplay = humans.some(p => !p.hotkeys)
  const replayPlayers = useReplayPresses(replayPath, needsReplay)
  const charted = humans.flatMap(player => {
    const presses = player.hotkeys ?? fromReplay(player, replayPlayers)
    return presses?.length ? [{ player, presses }] : []
  })
  if (!charted.length || durationMs <= 0) {
    return null
  }
  const missingContents = charted.some(({ player }) => !player.hotkeys)
  const colorOf = (player: GamePlayerStats) =>
    playerColors.get(player.id) ?? 'var(--theme-on-surface-variant)'

  // A team game has too many players to chart them all, so two charts each pick one of them.
  const picking = charted.length > 2
  const chartedIds = charted.map(c => c.player.id)
  const picks =
    picked && picked.every(id => chartedIds.includes(id))
      ? picked
      : defaultPicks(
          charted.map(c => c.player),
          myNames,
        )
  const shown = picking ? picks.flatMap(id => charted.filter(c => c.player.id === id)) : charted
  // Picking the player the other chart shows swaps the two, so they never show the same player.
  const pick = (slot: number, id: number) => {
    const next: [number, number] = [...picks]
    const other = slot === 0 ? 1 : 0
    if (next[other] === id) {
      next[other] = next[slot]
    }
    next[slot] = id
    setPicked(next)
  }
  const options: Array<SegmentOption<number>> = charted.map(({ player }) => ({
    value: player.id,
    label: player.name,
    icon: <PlayerSwatch $color={colorOf(player)} />,
    buttonContent: (
      <>
        <PlayerSwatch $color={colorOf(player)} />
        {player.race ? <RaceTag race={player.race} /> : null}
        {player.name}
      </>
    ),
  }))

  return (
    <Section>
      <SectionTitle>{t('gameStats.hotkeys', 'Hotkeys')}</SectionTitle>
      {shown.map(({ player, presses }, slot) => (
        <SectionErrorBoundary key={slot}>
          <PlayerHotkeyChart
            player={player}
            presses={presses}
            color={colorOf(player)}
            durationMs={durationMs}
            picker={
              picking ? (
                <SegmentMenu
                  label={t('gameStats.hotkeyPlayer', 'Player')}
                  showLabel={false}
                  options={options}
                  value={player.id}
                  onChange={id => pick(slot, id)}
                />
              ) : undefined
            }
          />
        </SectionErrorBoundary>
      ))}
      <Legend>
        <LegendItem>
          <LegendMark $kind='select' $color='var(--theme-on-surface-variant)' />
          {t('gameStats.hotkeyLegendSelect', 'Selected the group')}
        </LegendItem>
        <LegendItem>
          <LegendMark $kind='assign' $color={GROUP_CHANGE_COLOR} />
          {t('gameStats.hotkeyLegendAssign', 'Made the group')}
        </LegendItem>
        <LegendItem>
          <LegendMark $kind='add' $color={GROUP_CHANGE_COLOR} />
          {t('gameStats.hotkeyLegendAdd', 'Added to the group')}
        </LegendItem>
      </Legend>
      <SectionNote>
        {missingContents
          ? t(
              'gameStats.hotkeysNoContentsNote',
              'Hover a press for when it was. Analyze the game again to also see what each ' +
                'group held.',
            )
          : t(
              'gameStats.hotkeysContentsNote',
              'Icons show what each group mostly held when it was made. Hover a press to see ' +
                'all of it. Click to show that moment on the minimap.',
            )}
      </SectionNote>
    </Section>
  )
}
