import { ThemeMode } from '../../common/settings/local-settings'

/** Shows the given theme, which the global styles pick up from the root element. */
export function applyThemeMode(mode: ThemeMode) {
  if (mode === 'system') {
    delete document.documentElement.dataset.theme
  } else {
    document.documentElement.dataset.theme = mode
  }
}
