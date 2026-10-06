let appId = 'app.ggstats'

/** The app id of builds before 1.1.0, which Windows still knows them by. */
export const LEGACY_APP_ID = 'io.github.brandonfredericksen.ggstats'

export function setAppId(id: string) {
  appId = id
}

/**
 * Returns the identifier the OS uses for this installation (e.g. for its taskbar entry and file
 * associations).
 */
export function getAppId() {
  return appId
}
