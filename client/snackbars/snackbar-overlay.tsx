import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import * as React from 'react'
import { useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { useWindowFocus } from '../dom/window-focus'
import { Snackbar } from '../material/snackbar'
import { zIndexSnackbar } from '../material/zindex'
import {
  registerSnackbarController,
  SnackbarController,
  SnackbarOptions,
  unregisterSnackbarController,
} from './snackbar-controller-registry'
import { DURATION_SHORT } from './snackbar-durations'

/**
 * The most snackbars on screen at once. Past this a new one pushes out the oldest, so a burst of
 * them never leaves a backlog to click through.
 */
const MAX_SHOWN = 3

interface ShownSnackbar {
  id: number
  message: string
  durationMillis: number
  options?: SnackbarOptions
  /** How many times this message was asked for while it was showing. */
  count: number
}

const SnackbarControllerContext = React.createContext<SnackbarController>({
  showSnackbar: () => {},
})

export function useSnackbarController() {
  return useContext(SnackbarControllerContext)
}

const Stack = styled.div`
  position: fixed;
  right: 24px;
  bottom: 24px;
  max-width: calc(100% - 48px);
  z-index: ${zIndexSnackbar};

  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-2);
`

const itemVariants: Variants = {
  initial: { opacity: 0, x: 48 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 48, transition: { duration: 0.12, ease: [0.3, 0, 1, 1] } },
}

const itemTransition: Transition = { duration: 0.2, ease: [0.2, 0, 0, 1] }

/**
 * Calls `onExpire` once `durationMillis` of unpaused time has passed, counting from the start again
 * whenever `restartKey` changes.
 */
function useExpiry(
  durationMillis: number,
  restartKey: number,
  paused: boolean,
  onExpire: () => void,
) {
  const remainingRef = useRef(durationMillis)
  const restartKeyRef = useRef(restartKey)
  const expire = useEffectEvent(onExpire)

  useEffect(() => {
    if (restartKeyRef.current !== restartKey) {
      restartKeyRef.current = restartKey
      remainingRef.current = durationMillis
    }
    if (paused) {
      return undefined
    }

    const startedAt = Date.now()
    const timer = setTimeout(() => expire(), remainingRef.current)
    return () => {
      clearTimeout(timer)
      remainingRef.current -= Date.now() - startedAt
    }
  }, [durationMillis, restartKey, paused])
}

function SnackbarItem({
  snackbar,
  paused,
  onDismiss,
}: {
  snackbar: ShownSnackbar
  paused: boolean
  onDismiss: (id: number) => void
}) {
  const dismiss = () => onDismiss(snackbar.id)
  useExpiry(snackbar.durationMillis, snackbar.count, paused, dismiss)

  const action = snackbar.options?.action
  return (
    <Snackbar
      message={snackbar.message}
      tone={snackbar.options?.tone}
      count={snackbar.count}
      actionLabel={action?.label}
      onAction={
        action
          ? () => {
              action.onClick()
              dismiss()
            }
          : undefined
      }
      onDismiss={dismiss}
      durationMillis={snackbar.durationMillis}
      paused={paused}
    />
  )
}

/**
 * Container component that provides a controller via `useSnackbarController` to any descendants and
 * shows the snackbars it's asked for, stacked in the bottom right corner over everything it
 * contains. Asking for a message that's already showing counts it again rather than stacking a
 * copy. The snackbars wait while the mouse or focus is on them, or the window isn't focused, so
 * none of them goes away unseen.
 */
export function SnackbarOverlay({ children }: { children: React.ReactNode }) {
  const idRef = useRef(0)
  const [shown, setShown] = useState<ReadonlyArray<ShownSnackbar>>([])
  // Tracked by id and checked against what's showing, since a snackbar removed from under the
  // mouse or focus doesn't reliably get a leave or blur event.
  const [hoveredId, setHoveredId] = useState<number>()
  const [focusedId, setFocusedId] = useState<number>()
  const windowFocused = useWindowFocus()
  const controller = useMemo<SnackbarController>(
    () => ({
      showSnackbar(message, options) {
        const id = idRef.current
        idRef.current = (idRef.current + 1) % Number.MAX_SAFE_INTEGER
        const durationMillis = options?.durationMillis ?? DURATION_SHORT
        setShown(shown => {
          const same = shown.find(s => s.message === message)
          // A repeat moves to the newest spot, so it's the last to be pushed out.
          const next: ShownSnackbar = same
            ? { ...same, durationMillis, options, count: same.count + 1 }
            : { id, message, durationMillis, options, count: 1 }
          return [...shown.filter(s => s !== same), next].slice(-MAX_SHOWN)
        })
      },
    }),
    [],
  )

  useEffect(() => {
    registerSnackbarController(controller)
    return () => {
      unregisterSnackbarController(controller)
    }
  }, [controller])

  const onDismiss = (id: number) => {
    setShown(shown => shown.filter(s => s.id !== id))
  }
  const paused = !windowFocused || shown.some(s => s.id === hoveredId || s.id === focusedId)

  return (
    <SnackbarControllerContext.Provider value={controller}>
      {children}
      <Stack>
        <AnimatePresence mode='popLayout' initial={false}>
          {shown.map(snackbar => (
            <m.div
              key={snackbar.id}
              layout={true}
              variants={itemVariants}
              initial='initial'
              animate='visible'
              exit='exit'
              transition={itemTransition}
              onMouseEnter={() => setHoveredId(snackbar.id)}
              onMouseLeave={() => setHoveredId(id => (id === snackbar.id ? undefined : id))}
              onFocus={() => setFocusedId(snackbar.id)}
              onBlur={() => setFocusedId(id => (id === snackbar.id ? undefined : id))}>
              <SnackbarItem snackbar={snackbar} paused={paused} onDismiss={onDismiss} />
            </m.div>
          ))}
        </AnimatePresence>
      </Stack>
    </SnackbarControllerContext.Provider>
  )
}
