import keycode from 'keycode'
import { Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import * as React from 'react'
import { useCallback, useContext, useId } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { useIsDocumentVisible } from '../dom/document-visibility'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { labelMedium, titleLarge } from '../styles/typography'
import { IconButton } from './button'
import { useScrollIndicatorState } from './scroll-indicator'
import { elevationPlus3 } from './shadows'
import { zIndexDialog } from './zindex'

const ESCAPE = keycode('esc')

export interface DialogContextValue {
  isTopDialog: boolean
}
export const DialogContext = React.createContext<DialogContextValue>({
  isTopDialog: true,
})

const Container = styled.div`
  position: absolute;
  left: var(--pixel-shove-x, 0);
  right: 0;
  top: var(--pixel-shove-y, 0);
  bottom: 0;

  display: flex;
  align-items: center;
  justify-content: space-around;
  pointer-events: none;
  z-index: ${zIndexDialog};

  & > * {
    --pixel-shove-x: 0;
    --pixel-shove-y: 0;
  }
`

const Surface = styled(m.div)<{ $isTopDialog?: boolean }>`
  ${elevationPlus3};
  ${containerStyles(ContainerLevel.Normal)};

  width: calc(100% - 160px);
  max-width: 768px;
  max-height: calc(100% - 160px);
  flex-grow: 0;
  flex-shrink: 0;
  position: relative;

  display: flex;
  flex-direction: column;

  border-radius: var(--radius-lg);
  contain: paint;
  overscroll-behavior: contain;
  pointer-events: ${props => (props.$isTopDialog ? 'auto' : 'none')};
`

const TitleBar = styled.div<{ $fullBleed?: boolean; $showDivider?: boolean }>`
  position: relative;

  ${props =>
    props.$fullBleed
      ? css`
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;

          background-color: rgb(
            from var(--theme-dialog-scrim) r g b / var(--theme-dialog-scrim-opacity)
          );
          opacity: 0;
          transition: opacity 75ms linear;
          z-index: 1;

          ${Surface}:hover & {
            opacity: 1;
          }
        `
      : ''};

  flex-grow: 0;
  flex-shrink: 0;

  display: flex;
  align-items: center;

  &::after {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 100%;
    height: 1px;

    background-color: ${props =>
      props.$showDivider ? 'var(--theme-outline-variant)' : 'transparent'};
    content: '';
  }
`

export const Title = styled.div`
  ${titleLarge};
  flex-grow: 1;
  padding: var(--space-6) var(--space-6) var(--space-5);
`

const Overline = styled.div`
  ${labelMedium};
  margin-bottom: var(--space-1);

  color: var(--theme-on-surface-variant);
  font-weight: 600;
`

/**
 * Sits at the top of the title bar rather than centered in it, so a taller title area (one with
 * an overline, or a wrapped title) doesn't pull the button down away from the dialog's corner.
 * The offset matches where centering puts it against a single-line title.
 */
export const CloseButton = styled(IconButton)`
  flex-shrink: 0;
  align-self: flex-start;
  margin-top: var(--space-3);
  margin-right: var(--space-3);
`

export const Body = styled.div<{ $fullBleed?: boolean }>`
  width: 100%;
  min-height: 64px;
  flex-grow: 1;

  contain: content;
  padding: ${props => (props.$fullBleed ? '0' : '0 24px 24px')};
  overflow: ${props => (props.$fullBleed ? 'hidden' : 'auto')};
`

const Actions = styled.div<{ $showDivider?: boolean }>`
  position: relative;
  flex-grow: 0;
  flex-shrink: 0;
  padding: var(--space-3) var(--space-4) var(--space-4);

  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);

  &::after {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 1px;

    background-color: ${props =>
      props.$showDivider ? 'var(--theme-outline-variant)' : 'transparent'};
    content: '';
  }
`

const dialogVariants: Variants = {
  initial: { opacity: 0, y: 12, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 8, scale: 0.98 },
}

const dialogTransition: Transition = {
  default: { type: 'spring', duration: 0.3, bounce: 0 },
  opacity: { type: 'spring', duration: 0.2, bounce: 0 },
}

export interface DialogProps {
  buttons?: React.ReactNode[]
  children: React.ReactNode
  className?: string
  /**
   * Whether the content of this dialog extends to all edges (e.g. has no padding). If `true`, the
   * content must handle scrolling itself.
   */
  fullBleed?: boolean
  /**
   * Optional short line shown directly above the title, in a muted color. Rendered in the title bar
   * rather than the body, so it stays visible and unclipped regardless of body scrolling.
   */
  overline?: string
  showCloseButton?: boolean
  style?: React.CSSProperties
  title: React.ReactNode
  titleAction?: React.ReactNode
  onCancel?: () => void
  testName?: string
}

export function Dialog({
  buttons,
  children,
  className,
  fullBleed = false,
  overline,
  showCloseButton = false,
  style,
  title,
  titleAction,
  onCancel,
  testName,
}: DialogProps) {
  const { t } = useTranslation()
  const dialogContext = useContext(DialogContext)
  const isDocVisible = useIsDocumentVisible()

  useKeyListener({
    onKeyDown: useCallback(
      (event: KeyboardEvent) => {
        if (onCancel && event.keyCode === ESCAPE) {
          onCancel()
          return true
        }

        return false
      },
      [onCancel],
    ),
  })
  const [isAtTop, isAtBottom, topNode, bottomNode] = useScrollIndicatorState()
  const titleId = useId()

  const closeButton = showCloseButton ? (
    <CloseButton
      icon={<MaterialIcon icon='close' />}
      title={t('material.dialog.closeDialog', 'Close dialog')}
      ariaLabel={t('material.dialog.closeDialog', 'Close dialog')}
      onClick={onCancel}
    />
  ) : null

  return (
    <Container role='dialog' aria-modal={true} aria-labelledby={titleId} data-testid={testName}>
      {/*
        While the document is hidden (window minimized/fully occluded), animation frames never
        fire, so an enter/exit animation would never progress: an entering dialog would stay
        invisible, and an exiting one would block AnimatePresence from ever unmounting it. Render
        without those animations while hidden so mounts/unmounts complete immediately.
      */}
      <Surface
        className={className}
        style={style}
        variants={dialogVariants}
        initial={isDocVisible ? 'initial' : false}
        animate='animate'
        exit={isDocVisible ? 'exit' : undefined}
        transition={dialogTransition}
        $isTopDialog={dialogContext.isTopDialog}>
        <TitleBar $fullBleed={fullBleed} $showDivider={!isAtTop}>
          <Title id={titleId}>
            {overline ? <Overline>{overline}</Overline> : null}
            {title}
          </Title>
          {titleAction}
          {closeButton}
        </TitleBar>
        <Body $fullBleed={fullBleed}>
          {topNode}
          {children}
          {bottomNode}
        </Body>
        {buttons && buttons.length ? (
          <Actions $showDivider={!isAtBottom} data-testid='dialog-actions'>
            {buttons}
          </Actions>
        ) : null}
      </Surface>
    </Container>
  )
}
