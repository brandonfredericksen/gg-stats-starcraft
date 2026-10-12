import { rgba } from 'polished'
import { createContext, ReactNode, useContext, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styled, { css, keyframes } from 'styled-components'
import {
  LOADING_LINE_GAP,
  LOADING_LOGO_SHADOW,
  LOADING_LOGO_SIZE,
  LOADING_LOGO_URL,
} from '../../common/loading-logo'
import { CONTENT_PANEL_INSET, SYSTEM_BAR_HEIGHT } from '../../common/window-layout'
import { accelerateEasing, decelerateEasing } from '../material/curve-constants'
import { blue60, blue70, blue95 } from '../styles/colors'

// NOTE: This component can render before our theme CSS variables are attached to the DOM, so it
// uses literal palette values rather than `var(--...)` custom properties.

/*
 * The indicator plots a stat line like the ones on a game's stats page. The line draws itself from
 * left to right with its newest point lit, the point flares as it lands on the last value, and then
 * the line fades out to be plotted again.
 */

/** How long one plot takes, from the first point to the line fading out. */
const CYCLE_MS = 1800

const PLOT_WIDTH = 60
const PLOT_HEIGHT = 24

/** The values the line passes through, in pixels: a stat climbing over a game, with a few dips. */
const POINTS: ReadonlyArray<[x: number, y: number]> = [
  [3, 19],
  [12, 15],
  [18, 17],
  [26, 10],
  [32, 12.5],
  [40, 6.5],
  [47, 9],
  [57, 4],
]

/**
 * Where in the cycle the line reaches its last point, and where it starts fading out. The point
 * flares between the two.
 */
const DRAWN_AT = '55%'
const FADE_AT = '76%'

/**
 * How the line draws: easing in and out, so it moves through the middle points at a steady clip and
 * settles onto the last one. The decelerating curves elsewhere in the app draw most of the line in
 * the first moment and then crawl.
 */
const DRAW_EASING = 'cubic-bezier(0.45, 0, 0.2, 1)'

const draw = keyframes`
  0% {
    stroke-dashoffset: 100;
    opacity: 1;
    animation-timing-function: ${DRAW_EASING};
  }

  ${DRAWN_AT} {
    stroke-dashoffset: 0;
  }

  ${FADE_AT} {
    opacity: 1;
    animation-timing-function: ${accelerateEasing};
  }

  100% {
    stroke-dashoffset: 0;
    opacity: 0;
  }
`

const plotHead = keyframes`
  0% {
    offset-distance: 0%;
    opacity: 1;
    transform: scale(1);
    animation-timing-function: ${DRAW_EASING};
  }

  ${DRAWN_AT} {
    offset-distance: 100%;
    transform: scale(1);
  }

  63% {
    transform: scale(1.7);
  }

  72% {
    transform: scale(1);
  }

  ${FADE_AT} {
    opacity: 1;
    animation-timing-function: ${accelerateEasing};
  }

  100% {
    offset-distance: 100%;
    opacity: 0;
    transform: scale(1);
  }
`

const gentlePulse = keyframes`
  0%, 100% {
    opacity: 0.5;
  }

  50% {
    opacity: 1;
  }
`

const fadeIn = keyframes`
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
`

const LOADING_SHOW_DELAY_MS = 750
const LOADING_FADE_IN_MS = 450

const delayedShowCss = css`
  opacity: 0;
  animation: ${LOADING_FADE_IN_MS}ms ${decelerateEasing} ${LOADING_SHOW_DELAY_MS}ms forwards
    ${fadeIn};
`

const Root = styled.div<{ $showImmediately?: boolean }>`
  padding: 4px 8px;

  ${props => (!props.$showImmediately ? delayedShowCss : '')};
`

/** The plot's own box, which the line's points and the lit point's path are measured from. */
const Plot = styled.div`
  position: relative;
  width: ${PLOT_WIDTH}px;
  height: ${PLOT_HEIGHT}px;
`

const plotAnimationCss = css<{ $delayMs: number }>`
  animation-duration: ${CYCLE_MS}ms;
  animation-iteration-count: infinite;
  animation-delay: ${props => props.$delayMs}ms;
  animation-fill-mode: backwards;

  @media (prefers-reduced-motion: reduce) {
    animation-name: ${gentlePulse};
    animation-duration: 2500ms;
    animation-timing-function: ease-in-out;
  }
`

const LineSvg = styled.svg`
  position: absolute;
  inset: 0;
  overflow: visible;
`

const Line = styled.polyline<{ $delayMs: number }>`
  fill: none;
  stroke: ${blue60};
  stroke-width: 2.5px;
  stroke-linecap: round;
  stroke-linejoin: round;
  /* Measured against the polyline's pathLength of 100, so the whole line is one dash */
  stroke-dasharray: 100 100;
  filter: drop-shadow(0 0 2px ${rgba(blue70, 0.45)});

  animation-name: ${draw};
  ${plotAnimationCss};
`

const Head = styled.span<{ $delayMs: number }>`
  position: absolute;
  top: 0;
  left: 0;
  width: 6px;
  height: 6px;

  background-color: ${blue95};
  border-radius: 50%;
  /* The ring keeps the point visible on light backgrounds, where the glow barely shows */
  box-shadow:
    0 0 0 1.5px ${blue60},
    0 0 6px 1px ${rgba(blue70, 0.85)};
  offset-path: path('M${POINTS.map(([x, y]) => `${x} ${y}`).join(' L')}');
  offset-rotate: 0deg;

  animation-name: ${plotHead};
  ${plotAnimationCss};

  @media (prefers-reduced-motion: reduce) {
    offset-distance: 100%;
  }
`

interface LoadingIndicatorProps {
  /**
   * Whether or not to show the progress indicator immediately. If false, there will be a slight
   * delay before actually showing the indicator, which tends to make UIs feel more responsive if
   * they only have a very small delay before loading has completed.
   */
  showImmediately?: boolean

  /** A class string to add to the root element. */
  className?: string
}

/**
 * Renders the plotted line. When `delayed`, the animation waits out `LOADING_SHOW_DELAY_MS`, so the
 * first plot starts just as a delayed reveal fades in rather than being caught halfway through.
 * `fadeRoot` controls whether this element hides/fades itself — a delayed containing area does its
 * own fading and only needs the animation start to match it.
 *
 * A plot shown right away runs on the document's clock rather than starting when it mounts, so one
 * that takes over from another, like a page's loader replacing the splash's or the next one as the
 * page goes on to wait for something else, carries on the same line instead of starting it over.
 */
function StatPlot({
  delayed,
  fadeRoot,
  className,
}: {
  delayed: boolean
  fadeRoot: boolean
  className?: string
}) {
  const delayMs = delayed ? LOADING_SHOW_DELAY_MS : 0
  const plotRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (delayed) {
      return
    }
    for (const animation of plotRef.current?.getAnimations({ subtree: true }) ?? []) {
      animation.startTime = 0
    }
  }, [delayed])

  return (
    <Root className={className} $showImmediately={!fadeRoot}>
      <Plot ref={plotRef}>
        <LineSvg
          width={PLOT_WIDTH}
          height={PLOT_HEIGHT}
          viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
          aria-hidden={true}>
          <Line
            points={POINTS.map(([x, y]) => `${x},${y}`).join(' ')}
            pathLength={100}
            $delayMs={delayMs}
          />
        </LineSvg>
        <Head $delayMs={delayMs} />
      </Plot>
    </Root>
  )
}

export function LoadingIndicator({ showImmediately = false, className }: LoadingIndicatorProps) {
  return <StatPlot className={className} delayed={!showImmediately} fadeRoot={!showImmediately} />
}

const LoadingArea = styled.div<{ $showImmediately?: boolean }>`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  min-height: 56px;
  padding: 16px 0;

  ${props => (!props.$showImmediately ? delayedShowCss : '')};
`

export function LoadingIndicatorArea({
  showImmediately = false,
  className,
}: LoadingIndicatorProps) {
  return (
    <LoadingArea className={className} $showImmediately={showImmediately}>
      <StatPlot delayed={!showImmediately} fadeRoot={false} />
    </LoadingArea>
  )
}

/**
 * Where the page loaders inside a `PageLoadingFrame` go, or null until it's attached. Undefined
 * outside of one.
 */
const PageLoadingLayerContext = createContext<HTMLElement | null | undefined>(undefined)

const Frame = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
`

const Layer = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
`

/**
 * The box the page loaders inside it sit in the middle of, over whatever a page shows around its
 * loader and however far it's scrolled, so a page's loader is in the same spot as every other's.
 */
export function PageLoadingFrame({ children }: { children: ReactNode }) {
  const [layer, setLayer] = useState<HTMLDivElement | null>(null)
  return (
    <Frame>
      <PageLoadingLayerContext value={layer}>{children}</PageLoadingLayerContext>
      <Layer ref={setLayer} />
    </Frame>
  )
}

/** The logo, with the line under it. Laid out like the splash's (see `app/client-shell.ts`). */
const Mark = styled.div`
  /* Loaders mounted together, as one page's takes over from another's, stack in one spot */
  grid-area: 1 / 1;
  position: relative;
`

const Logo = styled.img`
  display: block;
  width: ${LOADING_LOGO_SIZE}px;
  height: ${LOADING_LOGO_SIZE}px;
  filter: ${LOADING_LOGO_SHADOW};
`

const MarkLine = styled.div`
  position: absolute;
  top: calc(100% + ${LOADING_LINE_GAP}px);
  inset-inline: 0;
  display: flex;
  justify-content: center;
`

/** Where the content panel goes, for a loader shown before there is one. */
const UnframedArea = styled.div`
  position: fixed;
  inset: ${SYSTEM_BAR_HEIGHT}px ${CONTENT_PANEL_INSET}px ${CONTENT_PANEL_INSET}px;
  display: grid;
  place-items: center;
  pointer-events: none;
`

/**
 * What a page shows until it has something to show: the logo with the loading line under it, like
 * the splash. It shows from the page's first paint, unlike loading within a page, so opening a page
 * never leaves it blank, and sits in the middle of the `PageLoadingFrame` it's in rather than where
 * the page renders it.
 */
export function PageLoadingIndicator() {
  const layer = useContext(PageLoadingLayerContext)
  const mark = (
    <Mark>
      <Logo src={LOADING_LOGO_URL} alt='' draggable={false} />
      <MarkLine>
        <StatPlot delayed={false} fadeRoot={false} />
      </MarkLine>
    </Mark>
  )

  if (layer === undefined) {
    // Outside of a page frame, like while the app around the pages is still loading.
    return <UnframedArea>{mark}</UnframedArea>
  }
  return layer ? createPortal(mark, layer) : null
}
