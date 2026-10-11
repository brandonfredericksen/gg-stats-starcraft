import type { SnackbarTone } from '../material/snackbar'

export interface SnackbarOptions {
  /**
   * How long the snackbar stays up, not counting time it spends waiting on the mouse, focus or an
   * unfocused window. Defaults to `DURATION_SHORT`.
   */
  durationMillis?: number
  /** Picks the snackbar's icon and accent color. Defaults to `info`. */
  tone?: SnackbarTone
  /** An optional action button to show on the snackbar. Using it also dismisses the snackbar. */
  action?: {
    label: string
    onClick: () => void
  }
}

export interface SnackbarController {
  showSnackbar(message: string, options?: SnackbarOptions): void
}

// NOTE(tec27): This lets us deal with sending snackbars from outside the normal React component
// tree. Not ideal that this needs to exist, but I'd rather have this than need to restructure
// all the existing places that do this right now.
const registry = new Set<SnackbarController>()

export function registerSnackbarController(controller: SnackbarController) {
  registry.add(controller)
}

export function unregisterSnackbarController(controller: SnackbarController) {
  registry.delete(controller)
}

/**
 * A utility for showing snackbars from outside the React component tree. If you are showing a
 * snackbar from inside a component, use `useSnackbarController` instead.
 */
export function externalShowSnackbar(message: string, options?: SnackbarOptions) {
  for (const controller of registry) {
    controller.showSnackbar(message, options)
  }
}
