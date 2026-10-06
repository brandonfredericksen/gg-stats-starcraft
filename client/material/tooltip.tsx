import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as React from 'react'
import { useCallback, useEffect, useId, useState } from 'react'
import styled, { css, RuleSet } from 'styled-components'
import { labelMedium, labelSmall } from '../styles/typography'
import { OriginX, OriginY, PopoverContent, useElemAnchorPosition } from './popover'
import { Portal } from './portal'

export type TooltipPosition = 'left' | 'right' | 'top' | 'bottom'

const TooltipChildrenContainer = styled.div`
  // NOTE(tec27): Because we wrap the children, some layout types (flexbox especially) can end up
  // stretching the wrapper element when they would not have stretched the children placed directly.
  // e.g. if you place a button with a fixed height inside a tooltip inside a flex row with
  // align-items: center, the button will end up not being centered because the wrapper gets
  // stretched to the height of the container. To fix this, we inherit the layout properties of the
  // parent element. There are likely still cases for which this doesn't work as expected and
  // dropping in a tooltip does break layout, but these can be fixed by styling the component as
  // well.
  display: inherit;
  flex-direction: inherit;
  align-items: inherit;
  justify-content: inherit;
  text-align: inherit;
  min-width: 0;
  min-height: 0;
`

const NoPointerPortal = styled(Portal)`
  pointer-events: none;
`

const marginStyle: Record<TooltipPosition, RuleSet> = {
  left: css`
    margin-right: 6px;
  `,
  right: css`
    margin-left: 6px;
  `,
  top: css`
    margin-bottom: 6px;
  `,
  bottom: css`
    margin-top: 6px;
  `,
}

export const TooltipContent = styled.div<{ $position: TooltipPosition; $interactive?: boolean }>`
  ${labelMedium};

  position: relative;
  max-width: 360px;
  min-height: 28px;
  padding: 5px 10px;
  ${props => marginStyle[props.$position]};

  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  background: linear-gradient(180deg, var(--theme-tooltip-sheen), var(--theme-tooltip) 70%);
  border: 1px solid var(--theme-tooltip-border);
  border-radius: 8px;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.06),
    0 8px 24px rgb(0 0 0 / 0.32);
  color: var(--theme-tooltip-text);
  font-weight: 600;
  pointer-events: ${props => (props.$interactive ? 'auto' : 'none')};

  a:link,
  a:visited,
  a:hover,
  a:active {
    color: var(--theme-tooltip-text);
    text-decoration: underline;
    font-weight: 700;
  }
`

/** A keyboard shortcut in a tooltip, shown as small key caps. */
const Shortcut = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 3px;
`

const Key = styled.kbd`
  ${labelSmall};
  min-width: 18px;
  height: 18px;
  padding: 0 5px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  background-color: rgb(255 255 255 / 0.08);
  border: 1px solid rgb(255 255 255 / 0.12);
  border-bottom-width: 2px;
  border-radius: 4px;
  color: var(--theme-tooltip-muted);
  font-family: inherit;
  font-weight: 600;
`

const SHORTCUT_SUFFIX = /^(.*\S)\s*\(((?:Alt|Ctrl|Shift|Win)(?:\s*\+\s*[^)]+)+)\)$/

/**
 * Splits a trailing keyboard shortcut like "(Alt + S)" off a tooltip's text, so it can be shown as
 * key caps beside the label.
 */
function withShortcut(text: React.ReactNode): React.ReactNode {
  if (typeof text !== 'string') {
    return text
  }
  const match = SHORTCUT_SUFFIX.exec(text)
  if (!match) {
    return text
  }
  const keys = match[2].split('+').map(k => k.trim())
  return (
    <>
      <span>{match[1]}</span>
      <Shortcut>
        {keys.map(k => (
          <Key key={k}>{k}</Key>
        ))}
      </Shortcut>
    </>
  )
}

const NoPointerPopoverContent = styled(PopoverContent)`
  pointer-events: none;
`

const tooltipVariants: Variants = {
  entering: { opacity: 0, scale: 0.97 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.12, ease: [0.2, 0, 0, 1] } },
  exiting: { opacity: 0, scale: 0.98, transition: { duration: 0.08, ease: [0.3, 0, 1, 1] } },
}

const tooltipTransition: Transition = { duration: 0.12, ease: [0.2, 0, 0, 1] }

/** How long the pointer rests on something before its tooltip shows. */
const SHOW_DELAY_MS = 120
/**
 * Moving straight from one tooltip to the next shows the next one right away, as long as it's
 * within this long of the last one closing.
 */
const WARM_MS = 400
/** When a tooltip last closed, or 0 if none has. */
let lastClosedAt = 0

export interface TooltipProps {
  /** The react node (usually string) that should be displayed in the Tooltip. */
  text: React.ReactNode
  /**
   * The children that the Tooltip should be linked to. Should usually only be a single element, but
   * the Tooltip will work even if there are multiple (by creating a wrapper element around all of
   * them).
   */
  children: React.ReactNode
  /** One of the four sides that can be used to position the Tooltip. Defaults to 'bottom'. */
  position?: TooltipPosition
  /** Class name applied to the component that wraps the Tooltip children. */
  className?: string
  /**
   * A value for the tabindex attribute of the tooltip trigger. Tooltip triggers should be
   * keyboard-accessible, so this defaults to `0`.
   */
  tabIndex?: number
  /**
   * A custom component that will be used instead of the default Tooltip content element. Can be
   * used if you wish to customize the Tooltip style. Will get injected with the following props:
   *  - $position: the `TooltipPosition` of the content
   *  - children: the Tooltip's content
   */
  ContentComponent?: React.ComponentType<{
    $position: TooltipPosition
    $interactive?: boolean
    children: React.ReactNode
  }>
  /**
   * Optionally disable interaction with this tooltip. This allows for cases where we need to turn
   * a tooltip off without changing the DOM structure around it, such as only showing a tooltip
   * when text is cut off.
   */
  disabled?: boolean
  /**
   * Optionally keep the tooltip open while the mouse is hovered over it. This allows users to
   * interact with the content inside the tooltip, e.g. buttons and links.
   */
  interactive?: boolean
}

/**
 * A component that displays some content in a floated UI element when a user hovers over a target
 * element. Should generally be used over native `title` attribute on elements.
 *
 * Utilizes popovers to deal with positioning, but with a much simpler API than that of a Popover.
 */
export function Tooltip({
  text,
  children,
  className,
  tabIndex = 0,
  position = 'bottom',
  ContentComponent = TooltipContent,
  disabled,
  interactive,
}: TooltipProps) {
  const contentId = useId()
  const [open, setOpen] = useState(false)
  // NOTE(tec27): We store two potential anchors here so that mousing over the element while it's
  // also being focused doesn't make the tooltip go away
  const [mouseAnchorElem, setMouseAnchorElem] = useState<HTMLElement>()
  const [focusAnchorElem, setFocusAnchorElem] = useState<HTMLElement>()
  const anchorElem = focusAnchorElem ?? mouseAnchorElem
  // NOTE(2Pac): This is only used when the tooltip is interactive, so we can keep the tooltip open
  // while the mouse is over it as well.
  const [isTooltipHovered, setIsTooltipHovered] = useState(false)

  const anchorOriginX = position === 'top' || position === 'bottom' ? 'center' : position
  const anchorOriginY = position === 'left' || position === 'right' ? 'center' : position
  const [anchorX = 0, anchorY = 0] = useElemAnchorPosition(
    anchorElem ?? null,
    anchorOriginX,
    anchorOriginY,
  )

  const onMouseEnter = useCallback((event: React.MouseEvent | React.FocusEvent) => {
    setMouseAnchorElem(event.currentTarget as HTMLElement)
  }, [])
  const onMouseLeave = useCallback(() => {
    setMouseAnchorElem(undefined)
  }, [])
  const onFocus = useCallback((event: React.FocusEvent) => {
    if (event.target.matches(':focus-visible')) {
      // Only show a tooltip for focus if the element was focused via keyboard (i.e. not by click)
      setFocusAnchorElem(event.currentTarget as HTMLElement)
    }
  }, [])
  const onBlur = useCallback(() => {
    setFocusAnchorElem(undefined)
  }, [])
  const onTooltipMouseEnter = useCallback((event: React.MouseEvent | React.FocusEvent) => {
    setIsTooltipHovered(true)
  }, [])
  const onTooltipMouseLeave = useCallback(() => {
    setIsTooltipHovered(false)
  }, [])

  if (open && !(anchorElem || isTooltipHovered)) {
    setOpen(false)
  }
  useEffect(() => {
    if (open) {
      return () => {
        lastClosedAt = performance.now()
      }
    }
    return undefined
  }, [open])

  useEffect(() => {
    if (anchorElem || isTooltipHovered) {
      const warm = performance.now() - lastClosedAt < WARM_MS
      let timeout: ReturnType<typeof setTimeout> | undefined = setTimeout(
        () => {
          timeout = undefined
          setOpen(true)
        },
        warm ? 0 : SHOW_DELAY_MS,
      )

      return () => {
        if (timeout) {
          clearTimeout(timeout)
        }
      }
    } else {
      return () => {}
    }
  }, [anchorElem, isTooltipHovered])

  let originX: OriginX
  if (anchorOriginX === 'left') {
    originX = 'right'
  } else if (anchorOriginX === 'right') {
    originX = 'left'
  } else {
    originX = 'center'
  }

  let originY: OriginY
  if (anchorOriginY === 'top') {
    originY = 'bottom'
  } else if (anchorOriginY === 'bottom') {
    originY = 'top'
  } else {
    originY = 'center'
  }

  const PopoverContentComponent = interactive ? PopoverContent : NoPointerPopoverContent

  return (
    <>
      <TooltipChildrenContainer
        className={className}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        aria-describedby={open ? contentId : undefined}
        tabIndex={tabIndex}>
        {children}
      </TooltipChildrenContainer>
      <AnimatePresence>
        {!disabled && open && (
          <NoPointerPortal open={open}>
            <PopoverContentComponent
              role='tooltip'
              id={contentId}
              anchorX={anchorX}
              anchorY={anchorY}
              originX={originX}
              originY={originY}
              motionVariants={tooltipVariants}
              motionInitial='entering'
              motionAnimate='visible'
              motionExit='exiting'
              motionTransition={tooltipTransition}
              onMouseEnter={interactive ? onTooltipMouseEnter : undefined}
              onMouseLeave={interactive ? onTooltipMouseLeave : undefined}>
              <ContentComponent $position={position} $interactive={interactive}>
                {withShortcut(text)}
              </ContentComponent>
            </PopoverContentComponent>
          </NoPointerPortal>
        )}
      </AnimatePresence>
    </>
  )
}
