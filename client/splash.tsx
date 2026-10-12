import { useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { LoadingIndicator } from './progress/loading-indicator'

/** How long the splash takes to fade out once the app has a page to show. */
const FADE_OUT_MS = 200

/**
 * The splash the page starts with, which the window shows until the app has rendered a page (see
 * `app/client-shell.ts`). Null once it's gone, and in tests, which have no shell.
 */
let splash = document.getElementById('splash')
const indicatorSlot = document.getElementById('splash-indicator')
let dismissing = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function removeSplash() {
  splash?.remove()
  splash = null
  for (const listener of listeners) {
    listener()
  }
}

function dismissSplash() {
  if (!splash || dismissing) {
    return
  }
  dismissing = true

  // A hidden window (one started to the tray, say) doesn't run animations, and nobody would see
  // this one anyway.
  if (document.visibilityState === 'hidden') {
    removeSplash()
    return
  }
  // Lets clicks through to the app while it fades. The window's drag regions don't go by
  // pointer-events, so the splash stops being one too.
  splash.style.pointerEvents = 'none'
  splash.style.setProperty('-webkit-app-region', 'no-drag')
  splash
    .animate({ opacity: [1, 0] }, { duration: FADE_OUT_MS, easing: 'ease-out' })
    .finished.then(removeSplash, removeSplash)
}

/** Whether the splash still covers the window, fading out included. */
export function isSplashShowing() {
  return splash !== null
}

/** The app's loading indicator, under the splash's logo for as long as the splash is up. */
export function SplashIndicator() {
  const slot = useSyncExternalStore(subscribe, () => (splash ? indicatorSlot : null))
  return slot ? createPortal(<LoadingIndicator showImmediately={true} />, slot) : null
}

/** Fades out the splash once this renders, which is the first moment the app has a page to show. */
export function DismissSplash() {
  useEffect(() => {
    dismissSplash()
  }, [])
  return null
}
