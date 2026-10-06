/**
 * Debug-only commands for a running game process. This surface only exists in debug game builds
 * (compiled out of release builds via `#[cfg(debug_assertions)]`) and is only wired up on the app
 * side in dev app sessions (`isDev`). A request sent to a build that doesn't support it never gets
 * a reply, so callers must expect it to time out.
 */

/** The reply payload for a `debugControl`/`screenshot` request, sent as `/game/debug/screenshot`. */
export interface GameDebugScreenshotReply {
  /** `null` if capture failed; `error` then says why. */
  screenshot: { width: number; height: number; pngBase64: string } | null
  error: string | null
}

/** The result of a debug screenshot request: the captured frame written to a PNG on disk. */
export interface GameDebugScreenshot {
  path: string
  width: number
  height: number
}
