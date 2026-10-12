/*
 * The splash the window opens on and the loader a page shows until it has something to show are the
 * same: the logo, with the loading line plotting under it, in the middle of the panel pages show in.
 * The app draws the splash (`app/client-shell.ts`) and the client draws a page's loader
 * (`client/progress/loading-indicator.tsx`), so the splash fades out over a page's loader without
 * the logo moving.
 */

/** Where the app serves the logo. */
export const LOADING_LOGO_URL = '/assets/splash-logo.webp'

/** How big the logo is, in CSS pixels. Its image is twice that, for sharp HiDPI. */
export const LOADING_LOGO_SIZE = 128

/** The shadow under the logo, as a CSS `filter`. */
export const LOADING_LOGO_SHADOW = 'drop-shadow(0 12px 24px rgb(0 0 0 / 0.5))'

/** How far under the logo the loading line sits. */
export const LOADING_LINE_GAP = 32
