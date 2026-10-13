import { useAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { getGameDurationString } from '../../common/games/game-duration'
import { FASTEST_MS_PER_FRAME, GamePlayerStats, getMinimapUrl } from '../../common/games/game-stats'
import {
  decodeUnitPositions,
  MapUnitKind,
  UnitPositions,
  UnitTrack,
} from '../../common/games/unit-positions'
import { TypedIpcRenderer } from '../../common/ipc'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { IconButton, TextButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { RaceTag } from '../material/race-tag'
import { Segmented } from '../material/segmented'
import { Tooltip } from '../material/tooltip'
import { bodyMedium, labelMedium } from '../styles/typography'
import { gameScrubAtom } from './game-stats-scrub'
import {
  LegendButton,
  PlayerSwatch,
  Section,
  SectionErrorBoundary,
  SectionNote,
  SectionTitle,
  StatsPanel,
} from './game-stats-shared'

const ipcRenderer = new TypedIpcRenderer()

type Mode = 'playback' | 'heatmap'

const SPEEDS = [4, 8, 16] as const
type Speed = (typeof SPEEDS)[number]

/** How visible the units of players who aren't followed are, while any are. */
const UNFOCUSED_ALPHA = 0.2

/** How visible a player's units are: dimmed when others are being followed. */
function visibility(focused: ReadonlySet<number>, player: number) {
  return focused.size > 0 && !focused.has(player) ? UNFOCUSED_ALPHA : 1
}

/** Pixels of the map to a tile. */
const TILE_SIZE = 32
/** How long a death stays marked while playing, in game time. */
const DEATH_MARK_MS = 2500
/**
 * How often the charts, build orders and chat follow along while playing, which redraws a lot more
 * than the minimap does.
 */
const FOLLOW_INTERVAL_MS = 250
/**
 * The share of tiles with any heat that are less hot than the hottest the heatmap shows apart, so a
 * few tiles where an army sat for ages, like at home, don't fade out everywhere else it went.
 */
const HEAT_SCALE_PERCENTILE = 0.97

/** How much the map's picture is darkened, so units and heat stand out on it. */
const MAP_FILTER = 'brightness(0.62) saturate(0.75)'
const HEATMAP_MAP_FILTER = 'brightness(0.45) saturate(0.5)'

const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;

  & > ${SectionTitle} {
    flex: 1 1 auto;
  }
`

/** Who's which color, and what's shown on the map, in one row above it. */
const Toolbar = styled.div`
  padding: 4px 6px 4px 10px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-bottom: 1px solid var(--theme-outline-variant);
`

const Layers = styled.div`
  margin-left: auto;
  display: flex;
  gap: 2px;
`

const LayerToggle = styled.button<{ $on: boolean }>`
  ${buttonReset};
  width: 30px;
  height: 30px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: var(--radius-sm);
  background: ${props => (props.$on ? 'var(--theme-container-highest)' : 'transparent')};
  color: ${props => (props.$on ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)')};
  opacity: ${props => (props.$on ? 1 : 0.6)};
  cursor: pointer;

  &:hover {
    opacity: 1;
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const Legend = styled.div`
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  column-gap: 6px;
`

const MapPanel = styled(StatsPanel)`
  display: flex;
  flex-direction: column;
`

const MapArea = styled.div<{ $aspect: number }>`
  position: relative;
  width: 100%;
  aspect-ratio: ${props => props.$aspect};
  background: var(--theme-container-lowest);
`

const MapCanvas = styled.canvas<{ $playable: boolean }>`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: ${props => (props.$playable ? 'pointer' : 'auto')};
`

const Transport = styled.div`
  padding: 8px 12px 8px 6px;

  display: flex;
  align-items: center;
  gap: 10px;

  border-top: 1px solid var(--theme-outline-variant);
`

const Time = styled.span`
  ${labelMedium};
  min-width: 40px;
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
  text-align: center;
`

const Scrubber = styled.input`
  flex: 1 1 auto;
  min-width: 0;
  accent-color: var(--theme-amber);
  cursor: pointer;
`

const Missing = styled.div`
  ${bodyMedium};
  padding: 20px 18px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;

  color: var(--theme-on-surface-variant);
`

/** The scan at or just before `frame`, and how far it is to the next one, from 0 to 1. */
function findScan(scanFrames: Uint32Array, frame: number): [index: number, fraction: number] {
  let low = 0
  let high = scanFrames.length - 1
  if (high < 0 || frame < scanFrames[0]) {
    return [-1, 0]
  }
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (scanFrames[mid] <= frame) {
      low = mid
    } else {
      high = mid - 1
    }
  }
  const next = scanFrames[low + 1]
  const fraction = next === undefined ? 0 : (frame - scanFrames[low]) / (next - scanFrames[low])
  return [low, fraction]
}

/** Where a unit was at a scan and the fraction of the way to the next, if it was on the map. */
function trackPosition(track: UnitTrack, scan: number, fraction: number) {
  const at = scan - track.firstScan
  if (at < 0 || at * 2 >= track.positions.length) {
    return undefined
  }
  const x = track.positions[at * 2]
  const y = track.positions[at * 2 + 1]
  if (Number.isNaN(x)) {
    return undefined
  }
  const nextX = track.positions[at * 2 + 2]
  const nextY = track.positions[at * 2 + 3]
  if (nextX === undefined || Number.isNaN(nextX)) {
    return [x, y] as const
  }
  return [x + (nextX - x) * fraction, y + (nextY - y) * fraction] as const
}

const resolvedColors = new Map<string, [number, number, number]>()

/** A CSS color, which may be a theme variable, as red, green and blue. */
function toRgb(element: Element, color: string): [number, number, number] {
  const variable = /^var\((--[\w-]+)\)$/.exec(color)?.[1]
  const value = variable ? getComputedStyle(element).getPropertyValue(variable).trim() : color
  let rgb = resolvedColors.get(value)
  if (!rgb) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.fillStyle = value
    context.fillRect(0, 0, 1, 1)
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data
    rgb = [r, g, b]
    resolvedColors.set(value, rgb)
  }
  return rgb
}

const rgba = ([r, g, b]: readonly [number, number, number], alpha: number) =>
  `rgba(${r}, ${g}, ${b}, ${alpha})`

/**
 * An outline that sets a dot apart from the dark map: dark for light colors, and light for the dark
 * ones the light theme gives some players, which would vanish otherwise.
 */
function outlineFor(color: readonly [number, number, number]) {
  return isDark(color) ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.55)'
}

function isDark([r, g, b]: readonly [number, number, number]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 90
}

interface DrawOptions {
  positions: UnitPositions
  mapImage?: HTMLImageElement
  colors: ReadonlyMap<number, [number, number, number]>
  /** Players picked out to follow, or none to show everyone the same. */
  focused: ReadonlySet<number>
  mode: Mode
  timeMs: number
  showWorkers: boolean
  showBuildings: boolean
  showSupport: boolean
  showDeaths: boolean
}

const backdrops = new WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>()

/**
 * The map's picture darkened and sized for the minimap, made once for each size, since filtering it
 * every frame would slow playback down.
 */
function getBackdrop(image: HTMLImageElement, filter: string, width: number, height: number) {
  let sized = backdrops.get(image)
  if (!sized) {
    sized = new Map()
    backdrops.set(image, sized)
  }
  const key = `${filter} ${width}x${height}`
  let backdrop = sized.get(key)
  if (!backdrop) {
    backdrop = document.createElement('canvas')
    backdrop.width = width
    backdrop.height = height
    const context = backdrop.getContext('2d')!
    context.filter = filter
    context.imageSmoothingEnabled = true
    context.drawImage(image, 0, 0, width, height)
    sized.set(key, backdrop)
  }
  return backdrop
}

/**
 * The colors mineral fields and geysers are drawn in: blues, which no player's color is, so
 * nobody's units can be taken for them.
 */
const MINERALS_COLOR = 'rgba(92, 164, 252, 0.75)'
const GEYSER_COLOR = 'rgba(150, 150, 236, 0.75)'

function drawMap(context: CanvasRenderingContext2D, options: DrawOptions) {
  const { positions, mapImage, mode } = options
  const { width, height } = context.canvas
  context.clearRect(0, 0, width, height)
  if (mapImage) {
    const filter = mode === 'heatmap' ? HEATMAP_MAP_FILTER : MAP_FILTER
    context.drawImage(getBackdrop(mapImage, filter, width, height), 0, 0)
  }
  // Canvas pixels to each pixel of the map.
  const scale = width / (positions.mapWidth * TILE_SIZE)
  for (const resource of positions.resources) {
    const w = resource.width * TILE_SIZE * scale
    const h = resource.height * TILE_SIZE * scale
    context.fillStyle = resource.geyser ? GEYSER_COLOR : MINERALS_COLOR
    context.fillRect(resource.x * scale - w / 2, resource.y * scale - h / 2, w, h)
  }
  // Dots are sized for the screen rather than the map, so they read the same on any map.
  const dot = Math.max(1, width / 520)
  if (mode === 'heatmap') {
    drawHeat(context, options, scale, dot)
  } else {
    drawUnits(context, options, scale, dot)
  }
}

function drawUnits(
  context: CanvasRenderingContext2D,
  options: DrawOptions,
  scale: number,
  dot: number,
) {
  const { positions, colors, focused, timeMs } = options
  const frame = timeMs / FASTEST_MS_PER_FRAME

  if (options.showBuildings) {
    for (const building of positions.buildings) {
      const color = colors.get(building.player)
      const standing =
        building.startFrame <= frame &&
        (building.endFrame === undefined || frame < building.endFrame)
      if (!color || !standing) {
        continue
      }
      context.globalAlpha = visibility(focused, building.player)
      const w = building.width * TILE_SIZE * scale
      const h = building.height * TILE_SIZE * scale
      context.fillStyle = rgba(color, 0.5)
      context.fillRect(building.x * scale - w / 2, building.y * scale - h / 2, w, h)
    }
  }

  const [scan, fraction] = findScan(positions.scanFrames, frame)
  if (scan >= 0) {
    // Army last, so it's on top of everything else.
    const order = [MapUnitKind.Building, MapUnitKind.Worker, MapUnitKind.Support, MapUnitKind.Army]
    for (const kind of order) {
      const shownKind =
        kind === MapUnitKind.Army ||
        (kind === MapUnitKind.Worker && options.showWorkers) ||
        (kind === MapUnitKind.Support && options.showSupport) ||
        (kind === MapUnitKind.Building && options.showBuildings)
      if (!shownKind) {
        continue
      }
      for (const track of positions.tracks) {
        const color = colors.get(track.player)
        if (track.kind !== kind || !color) {
          continue
        }
        const at = trackPosition(track, scan, fraction)
        if (!at) {
          continue
        }
        const x = at[0] * scale
        const y = at[1] * scale
        context.globalAlpha = visibility(focused, track.player)
        context.beginPath()
        if (kind === MapUnitKind.Worker) {
          context.fillStyle = rgba(color, 0.7)
          context.arc(x, y, dot * 1.3, 0, Math.PI * 2)
          context.fill()
          if (isDark(color)) {
            context.strokeStyle = outlineFor(color)
            context.lineWidth = dot * 0.5
            context.stroke()
          }
        } else if (kind === MapUnitKind.Support) {
          context.strokeStyle = rgba(color, 0.9)
          context.lineWidth = dot
          context.arc(x, y, dot * 2.4, 0, Math.PI * 2)
          context.stroke()
        } else if (kind === MapUnitKind.Building) {
          context.fillStyle = rgba(color, 0.7)
          context.fillRect(x - dot * 3, y - dot * 3, dot * 6, dot * 6)
        } else {
          context.fillStyle = rgba(color, 1)
          context.strokeStyle = outlineFor(color)
          context.lineWidth = dot * 0.8
          // Bigger units, like Ultralisks and Carriers, get bigger dots.
          context.arc(x, y, dot * (2 + Math.min(track.supply, 12) / 6), 0, Math.PI * 2)
          context.fill()
          context.stroke()
        }
      }
    }
  }

  // Each death sends out a ring that fades, so fights flash where they happen.
  const markFrames = DEATH_MARK_MS / FASTEST_MS_PER_FRAME
  for (const death of positions.deaths) {
    const age = frame - death.frame
    const color = colors.get(death.player)
    if (age < 0 || age > markFrames || !color) {
      continue
    }
    if (death.kind === MapUnitKind.Worker && !options.showWorkers) {
      continue
    }
    const progress = age / markFrames
    context.globalAlpha = visibility(focused, death.player)
    context.beginPath()
    context.strokeStyle = rgba(color, (1 - progress) * 0.9)
    context.lineWidth = dot * 1.2
    context.arc(death.x * scale, death.y * scale, dot * (2 + progress * 7), 0, Math.PI * 2)
    context.stroke()
  }
  context.globalAlpha = 1
}

function drawHeat(
  context: CanvasRenderingContext2D,
  options: DrawOptions,
  scale: number,
  dot: number,
) {
  const { positions, colors, focused } = options
  // Only the players being followed, if any are, since dimmed heat would only muddy theirs.
  const shown = (player: number) => focused.size === 0 || focused.has(player)
  const { mapWidth, mapHeight } = positions
  const lastScan = positions.scanFrames.length - 1

  // Army supply on each tile, added up over every scan: where each army spent its time.
  const heat = new Map<number, Float32Array>()
  for (const track of positions.tracks) {
    if (track.kind !== MapUnitKind.Army || !shown(track.player)) {
      continue
    }
    let grid = heat.get(track.player)
    if (!grid) {
      grid = new Float32Array(mapWidth * mapHeight)
      heat.set(track.player, grid)
    }
    const end = Math.min(track.positions.length / 2, lastScan - track.firstScan + 1)
    for (let i = 0; i < end; i++) {
      const x = track.positions[i * 2]
      if (Number.isNaN(x)) {
        continue
      }
      const tileX = Math.min(mapWidth - 1, Math.floor(x / TILE_SIZE))
      const tileY = Math.min(mapHeight - 1, Math.floor(track.positions[i * 2 + 1] / TILE_SIZE))
      const cell = tileY * mapWidth + tileX
      grid[cell] += track.supply / 2
    }
  }

  const hot = Array.from(heat.values(), grid => Array.from(grid).filter(v => v > 0))
    .flat()
    .sort((a, b) => a - b)
  const scaleTo = hot[Math.floor((hot.length - 1) * HEAT_SCALE_PERCENTILE)] ?? 0
  if (scaleTo > 0) {
    const layer = document.createElement('canvas')
    layer.width = mapWidth
    layer.height = mapHeight
    const layerContext = layer.getContext('2d')!
    const image = layerContext.createImageData(mapWidth, mapHeight)
    context.imageSmoothingEnabled = true
    context.filter = `blur(${Math.max(2, dot * 5)}px)`
    for (const [player, grid] of heat) {
      const [r, g, b] = colors.get(player) ?? [255, 255, 255]
      for (let i = 0; i < grid.length; i++) {
        // The square root keeps where an army only passed through visible next to where it sat.
        const strength = Math.sqrt(Math.min(1, grid[i] / scaleTo))
        image.data[i * 4] = r
        image.data[i * 4 + 1] = g
        image.data[i * 4 + 2] = b
        image.data[i * 4 + 3] = strength * 235
      }
      layerContext.putImageData(image, 0, 0)
      context.drawImage(layer, 0, 0, context.canvas.width, context.canvas.height)
    }
    context.filter = 'none'
  }

  if (options.showDeaths) {
    const size = dot * 2.2
    context.lineWidth = dot * 1.1
    for (const death of positions.deaths) {
      const color = colors.get(death.player)
      if (!color || !shown(death.player)) {
        continue
      }
      const x = death.x * scale
      const y = death.y * scale
      context.strokeStyle = rgba(color, 0.85)
      context.beginPath()
      context.moveTo(x - size, y - size)
      context.lineTo(x + size, y + size)
      context.moveTo(x + size, y - size)
      context.lineTo(x - size, y + size)
      context.stroke()
    }
  }
}

function useUnitPositions(gameId: string) {
  const [loaded, setLoaded] = useState<{ gameId: string; positions?: UnitPositions }>()
  useEffect(() => {
    let cancelled = false
    Promise.resolve(ipcRenderer.invoke('gameStatsGetUnitPositions', gameId))
      .then(bytes => {
        if (!cancelled) {
          setLoaded({ gameId, positions: bytes ? decodeUnitPositions(bytes) : undefined })
        }
      })
      .catch(err => {
        logger.error(`Error reading the unit positions for ${gameId}: ${getErrorStack(err)}`)
        if (!cancelled) {
          setLoaded({ gameId })
        }
      })
    return () => {
      cancelled = true
    }
  }, [gameId])
  return loaded?.gameId === gameId ? loaded : undefined
}

function useMapImage(minimap: string | undefined) {
  const [image, setImage] = useState<{ minimap: string; image: HTMLImageElement }>()
  useEffect(() => {
    if (!minimap) {
      return undefined
    }
    const img = new Image()
    let cancelled = false
    img.onload = () => {
      if (!cancelled) {
        setImage({ minimap, image: img })
      }
    }
    img.src = getMinimapUrl(minimap)
    return () => {
      cancelled = true
    }
  }, [minimap])
  return image && image.minimap === minimap ? image.image : undefined
}

/**
 * The game played out on its minimap, every unit a dot in its player's color, or as a heatmap of
 * where each army spent its time and where units died.
 */
export function GameMinimap({
  gameId,
  minimap,
  durationMs,
  players,
  playerColors,
  onAnalyzeAgain,
}: {
  gameId: string
  minimap?: string
  durationMs: number
  players: ReadonlyArray<GamePlayerStats>
  playerColors: ReadonlyMap<number, string>
  /** Analyzes the game's replay again, if there's one to analyze. */
  onAnalyzeAgain?: () => void
}) {
  const { t } = useTranslation()
  const loaded = useUnitPositions(gameId)
  const mapImage = useMapImage(minimap)
  const [scrub, setScrub] = useAtom(gameScrubAtom)
  const [mode, setMode] = useState<Mode>('playback')
  const [speed, setSpeed] = useState<Speed>(8)
  const [playing, setPlaying] = useState(false)
  const [timeMs, setTimeMs] = useState(0)
  const [focused, setFocused] = useState<ReadonlySet<number>>(() => new Set())
  const [showWorkers, setShowWorkers] = useState(true)
  const [showBuildings, setShowBuildings] = useState(true)
  const [showSupport, setShowSupport] = useState(true)
  const [showDeaths, setShowDeaths] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasWidth, setCanvasWidth] = useState(0)
  const timeRef = useRef(timeMs)
  const lastFollowRef = useRef(0)

  useEffect(() => {
    timeRef.current = timeMs
  })

  // Nothing else on the page marks a moment once the minimap is gone.
  useEffect(() => () => setScrub(undefined), [setScrub])

  // A moment picked somewhere else, like on a chart, is where the minimap goes.
  const [seenScrub, setSeenScrub] = useState(scrub)
  if (scrub !== seenScrub) {
    setSeenScrub(scrub)
    if (scrub && !scrub.fromMinimap) {
      setPlaying(false)
      setTimeMs(Math.min(durationMs, scrub.timeMs))
    }
  }

  useEffect(() => {
    if (!playing) {
      return undefined
    }
    let last = performance.now()
    let frame = requestAnimationFrame(function step(now) {
      const next = Math.min(durationMs, timeRef.current + (now - last) * speed)
      last = now
      setTimeMs(next)
      // The rest of the page follows along, though less often than the minimap redraws.
      if (next >= durationMs || now - lastFollowRef.current >= FOLLOW_INTERVAL_MS) {
        lastFollowRef.current = now
        setScrub({ timeMs: next, fromMinimap: true })
      }
      if (next >= durationMs) {
        setPlaying(false)
      } else {
        frame = requestAnimationFrame(step)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, durationMs, setScrub])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return undefined
    }
    const observer = new ResizeObserver(() => {
      setCanvasWidth(Math.round(canvas.clientWidth * window.devicePixelRatio))
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [loaded?.positions])

  const positions = loaded?.positions
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !positions || !canvasWidth) {
      return
    }
    // Setting a canvas's size clears and reallocates it, so it's only set when it changes.
    const canvasHeight = Math.round((canvasWidth * positions.mapHeight) / positions.mapWidth)
    if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
      canvas.width = canvasWidth
      canvas.height = canvasHeight
    }
    const colors = new Map<number, [number, number, number]>()
    for (const [id, color] of playerColors) {
      colors.set(id, toRgb(canvas, color))
    }
    drawMap(context, {
      positions,
      focused,
      mapImage,
      colors,
      mode,
      timeMs,
      showWorkers,
      showBuildings,
      showSupport,
      showDeaths,
    })
  })

  const title = <SectionTitle>{t('gameStats.minimap', 'Minimap')}</SectionTitle>
  if (!loaded) {
    // The title holds the section's place, so the page doesn't jump once the positions are read.
    return <Section>{title}</Section>
  }
  if (!positions) {
    return (
      <Section>
        {title}
        <StatsPanel>
          <Missing>
            {t(
              'gameStats.minimapMissing',
              'This game was analyzed before the minimap was recorded. Analyze it again to watch ' +
                'it play out.',
            )}
            {onAnalyzeAgain ? (
              <TextButton
                label={t('gameStats.analyzeAgain', 'Analyze again')}
                iconStart={<MaterialIcon icon='refresh' size={18} />}
                onClick={onAnalyzeAgain}
              />
            ) : null}
          </Missing>
        </StatsPanel>
      </Section>
    )
  }

  /** Has the rest of the page follow along, at most so often unless `now`. */
  const follow = (ms: number, now: boolean) => {
    const at = performance.now()
    if (now || at - lastFollowRef.current >= FOLLOW_INTERVAL_MS) {
      lastFollowRef.current = at
      setScrub({ timeMs: ms, fromMinimap: true })
    }
  }
  const seek = (ms: number) => {
    const clamped = Math.max(0, Math.min(durationMs, ms))
    setPlaying(false)
    setTimeMs(clamped)
    follow(clamped, false)
  }
  const togglePlaying = () => {
    if (playing) {
      setPlaying(false)
      follow(timeMs, true)
    } else {
      if (timeMs >= durationMs) {
        setTimeMs(0)
      }
      setPlaying(true)
    }
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
  const layers =
    mode === 'playback'
      ? [
          {
            key: 'workers',
            icon: 'engineering',
            label: t('gameStats.minimapWorkers', 'Workers'),
            on: showWorkers,
            toggle: () => setShowWorkers(!showWorkers),
          },
          {
            key: 'buildings',
            icon: 'domain',
            label: t('gameStats.minimapBuildings', 'Buildings'),
            on: showBuildings,
            toggle: () => setShowBuildings(!showBuildings),
          },
          {
            key: 'support',
            icon: 'visibility',
            label: t('gameStats.minimapSupport', 'Overlords and Observers'),
            on: showSupport,
            toggle: () => setShowSupport(!showSupport),
          },
        ]
      : [
          {
            key: 'deaths',
            icon: 'close',
            label: t('gameStats.minimapDeaths', 'Deaths'),
            on: showDeaths,
            toggle: () => setShowDeaths(!showDeaths),
          },
        ]

  return (
    <Section>
      <Header>
        {title}
        <Segmented
          label={t('gameStats.minimapMode', 'Minimap view')}
          options={[
            { value: 'playback' as const, label: t('gameStats.minimapPlayback', 'Playback') },
            { value: 'heatmap' as const, label: t('gameStats.minimapHeatmap', 'Heatmap') },
          ]}
          value={mode}
          onChange={setMode}
        />
      </Header>
      <SectionErrorBoundary>
        <MapPanel>
          <Toolbar>
            <Legend role='group' aria-label={t('gameStats.minimapLegend', 'Players to follow')}>
              {players.map(player => (
                <LegendButton
                  key={player.id}
                  type='button'
                  aria-pressed={focused.has(player.id)}
                  $dimmed={focused.size > 0 && !focused.has(player.id)}
                  onClick={() => toggleFocus(player.id)}>
                  <PlayerSwatch $color={playerColors.get(player.id) ?? 'transparent'} />
                  {player.race ? <RaceTag race={player.race} /> : null}
                  {player.name}
                </LegendButton>
              ))}
            </Legend>
            <Layers role='group' aria-label={t('gameStats.minimapLayers', 'Shown on the map')}>
              {layers.map(layer => (
                <Tooltip key={layer.key} text={layer.label} position='top' tabIndex={-1}>
                  <LayerToggle
                    type='button'
                    $on={layer.on}
                    aria-pressed={layer.on}
                    aria-label={layer.label}
                    onClick={layer.toggle}>
                    <MaterialIcon icon={layer.icon} size={20} />
                  </LayerToggle>
                </Tooltip>
              ))}
            </Layers>
          </Toolbar>
          <MapArea $aspect={positions.mapWidth / positions.mapHeight}>
            <MapCanvas
              ref={canvasRef}
              role='img'
              aria-label={t('gameStats.minimapImage', 'The game on its minimap at {{time}}', {
                time: getGameDurationString(timeMs),
              })}
              onClick={mode === 'playback' ? togglePlaying : undefined}
              $playable={mode === 'playback'}
            />
          </MapArea>
          {mode === 'playback' ? (
            <Transport>
              <IconButton
                icon={<MaterialIcon icon={playing ? 'pause' : 'play_arrow'} />}
                title={playing ? t('gameStats.pause', 'Pause') : t('gameStats.play', 'Play')}
                onClick={togglePlaying}
              />
              <Time>{getGameDurationString(timeMs)}</Time>
              <Scrubber
                type='range'
                min={0}
                max={durationMs}
                step={FASTEST_MS_PER_FRAME}
                value={timeMs}
                aria-label={t('gameStats.minimapTime', 'Time in the game')}
                onChange={event => seek(Number(event.target.value))}
                // Wherever a drag ends is followed right away.
                onPointerUp={() => follow(timeMs, true)}
                onKeyUp={() => follow(timeMs, true)}
              />
              <Time>{getGameDurationString(durationMs)}</Time>
              <Segmented
                label={t('gameStats.playbackSpeed', 'Playback speed')}
                options={SPEEDS.map(value => ({
                  value,
                  label: t('gameStats.playbackSpeedValue', '{{speed}}x', { speed: value }),
                }))}
                value={speed}
                onChange={setSpeed}
              />
            </Transport>
          ) : null}
        </MapPanel>
      </SectionErrorBoundary>
      <SectionNote>
        {mode === 'playback'
          ? t(
              'gameStats.minimapPlaybackNote',
              'Dots are units, squares are buildings. A ring marks each unit as it dies.',
            )
          : t(
              'gameStats.minimapHeatmapNote',
              'Where each army spent its time, weighted by supply. Workers, Overlords and ' +
                'Observers are left out. Crosses mark where units died.',
            )}
      </SectionNote>
    </Section>
  )
}
