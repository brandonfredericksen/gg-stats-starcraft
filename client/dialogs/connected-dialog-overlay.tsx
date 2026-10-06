import { Immutable } from 'immer'
import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import styled from 'styled-components'
import { useIsDocumentVisible } from '../dom/document-visibility'
import { FocusTrap } from '../dom/focus-trap'
import { useExternalElement } from '../dom/use-external-element-ref'
import { KeyListenerBoundary } from '../keyboard/key-listener'
import { DialogContext } from '../material/dialog'
import { isHandledDismissalEvent } from '../material/dismissal-events'
import { zIndexDialogScrim } from '../material/zindex'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { dialogScrimOpacity } from '../styles/colors'
import { closeDialogById } from './action-creators'
import { DialogState } from './dialog-reducer'
import { DialogType } from './dialog-type'
import { SimpleDialog } from './simple-dialog'

const CreatePlaylistDialog = React.lazy(async () => ({
  default: (await import('../replays/playlist-dialogs')).CreatePlaylistDialog,
}))
const DeletePlaylistDialog = React.lazy(async () => ({
  default: (await import('../replays/playlist-dialogs')).DeletePlaylistDialog,
}))
const RenamePlaylistDialog = React.lazy(async () => ({
  default: (await import('../replays/playlist-dialogs')).RenamePlaylistDialog,
}))
const ReplayInfoDialog = React.lazy(async () => ({
  default: (await import('../replays/replay-info-display')).ReplayInfoDialog,
}))
const ReplayLoadDialog = React.lazy(async () => ({
  default: (await import('../replays/replay-load-dialog')).ReplayLoadDialog,
}))
const GameDefaultsApplyDialog = React.lazy(async () => ({
  default: (await import('../settings/game/game-defaults-apply-dialog')).GameDefaultsApplyDialog,
}))
const GgStatsHealthDialog = React.lazy(async () => ({
  default: (await import('../starcraft/gg-stats-health')).GgStatsHealthDialog,
}))
const StarcraftHealthCheckupDialog = React.lazy(async () => ({
  default: (await import('../starcraft/starcraft-health')).StarcraftHealthCheckupDialog,
}))

const Scrim = styled(m.div)`
  position: fixed;
  left: 0;
  top: var(--gg-system-bar-height, 0);
  right: 0;
  bottom: 0;

  background: var(--theme-dialog-scrim);
  backdrop-filter: blur(6px);
  z-index: ${zIndexDialogScrim};

  -webkit-app-region: no-drag;
`

const noop = () => {}

function getDialog(dialogType: DialogType): {
  component: React.ComponentType<any>
  modal?: boolean
} {
  switch (dialogType) {
    case DialogType.CreatePlaylist:
      return { component: CreatePlaylistDialog }
    case DialogType.DeletePlaylist:
      return { component: DeletePlaylistDialog }
    case DialogType.GameDefaultsApply:
      return { component: GameDefaultsApplyDialog }
    case DialogType.RenamePlaylist:
      return { component: RenamePlaylistDialog }
    case DialogType.ReplayInfo:
      return { component: ReplayInfoDialog }
    case DialogType.ReplayLoad:
      return { component: ReplayLoadDialog, modal: true }
    case DialogType.Simple:
      return { component: SimpleDialog }
    case DialogType.GgStatsHealth:
      return { component: GgStatsHealthDialog }
    case DialogType.StarcraftHealth:
      return { component: StarcraftHealthCheckupDialog }
    default:
      return dialogType satisfies never
  }
}

export const ConnectedDialogOverlay = () => {
  const dispatch = useAppDispatch()
  const dialogHistory = useAppSelector(s => s.dialog.history)
  const portalElem = useExternalElement()

  return ReactDOM.createPortal(
    <DialogOverlayContent
      dialogHistory={dialogHistory}
      onCancel={(id, event) => {
        if (!event || !isHandledDismissalEvent(event.nativeEvent)) {
          dispatch(closeDialogById(id))
        }
      }}
    />,
    portalElem,
  )
}
function DialogOverlayContent({
  dialogHistory,
  onCancel,
}: {
  dialogHistory: Immutable<DialogState[]>
  onCancel: (id: string, event?: React.MouseEvent) => void
}) {
  // Dialogs removed from history stay mounted until their exit animation completes, but animation
  // frames stop entirely while the document is hidden (window minimized/fully occluded). If the
  // document becomes hidden while an exit is in flight, that animation would never finish and the
  // dialog (and its scrim) would stay on screen indefinitely. Track in-flight exits and, when the
  // document goes hidden with any outstanding, remount the AnimatePresence so exiting dialogs are
  // dropped immediately. (Still-open dialogs remount too, which is acceptable at the moment the
  // window stops being visible.)
  const exitingCountRef = useRef(0)
  const prevHistoryRef = useRef(dialogHistory)
  const [presenceEpoch, setPresenceEpoch] = useState(0)

  useEffect(() => {
    const prevHistory = prevHistoryRef.current
    prevHistoryRef.current = dialogHistory

    const currentIds = new Set(dialogHistory.map(d => d.id))
    for (const d of prevHistory) {
      if (!currentIds.has(d.id)) {
        exitingCountRef.current += 1
      }
    }
  }, [dialogHistory])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && exitingCountRef.current > 0) {
        exitingCountRef.current = 0
        setPresenceEpoch(epoch => epoch + 1)
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  return (
    <AnimatePresence
      key={presenceEpoch}
      onExitComplete={() => {
        exitingCountRef.current = 0
      }}>
      {dialogHistory.map((dialogState, index) => (
        <DialogDisplay
          key={dialogState.id}
          dialogState={dialogState}
          isTopDialog={dialogHistory.length - 1 === index}
          onCancel={onCancel}
        />
      ))}
    </AnimatePresence>
  )
}

const scrimVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: dialogScrimOpacity },
  exit: { opacity: 0 },
}

const scrimTransition: Transition = {
  opacity: { type: 'spring', duration: 0.3, bounce: 0 },
}

function DialogDisplay({
  dialogState,
  isTopDialog,
  onCancel,
}: {
  dialogState: Immutable<DialogState>
  isTopDialog: boolean
  onCancel: (id: string, event?: React.MouseEvent) => void
}) {
  const { type: dialogType, id } = dialogState
  const { component: DialogComponent, modal } = getDialog(dialogType)

  const [focusableElem, setFocusableElem] = useState<HTMLSpanElement | null>(null)
  const isDocVisible = useIsDocumentVisible()

  return (
    <>
      {/*
        While the document is hidden, animation frames never fire, so enter/exit animations can't
        progress — an exiting scrim would block unmounting forever. Render without them while
        hidden so mounts/unmounts complete immediately. (The dialog surface in material/dialog.tsx
        does the same.)
      */}
      <AnimatePresence propagate={true}>
        {isTopDialog && (
          <Scrim
            key='scrim'
            variants={scrimVariants}
            initial={isDocVisible ? 'initial' : false}
            animate='animate'
            exit={isDocVisible ? 'exit' : undefined}
            transition={scrimTransition}
            onClick={modal ? noop : event => onCancel(id, event)}
          />
        )}
      </AnimatePresence>

      <KeyListenerBoundary active={isTopDialog} key='dialog-content'>
        <FocusTrap focusableElem={focusableElem} focusOnMount={isTopDialog}>
          <span ref={setFocusableElem} tabIndex={-1}>
            <DialogContext.Provider value={{ isTopDialog }}>
              <React.Suspense fallback={null}>
                <DialogComponent
                  key={dialogState.id}
                  onCancel={modal ? noop : (event?: React.MouseEvent) => onCancel(id, event)}
                  close={() => onCancel(id)}
                  {...dialogState.initData}
                />
              </React.Suspense>
            </DialogContext.Provider>
          </span>
        </FocusTrap>
      </KeyListenerBoundary>
    </>
  )
}
