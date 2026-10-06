import isDev from 'electron-is-dev'
import { autoUpdater } from 'electron-updater'
import { UpdateStatus } from '../common/updates'
import { ActiveGameManager } from './game/active-game-manager'
import logger from './logger'
import { LocalSettingsManager } from './settings'

/** How long after starting to first look for an update, so it doesn't slow the start down. */
const FIRST_CHECK_DELAY_MS = 60 * 1000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Keeps the app up to date from GitHub releases. A new version downloads in the background and
 * installs when the app quits, or right away when the user asks to restart. Checking can be turned
 * off in settings, and never happens in development.
 */
export class Updater {
  private status: UpdateStatus = { kind: 'none' }
  private timer: ReturnType<typeof setTimeout> | undefined
  private restarting = false

  constructor(
    private readonly localSettings: LocalSettingsManager,
    private readonly activeGameManager: ActiveGameManager,
    private readonly onStatusChange: (status: UpdateStatus) => void,
  ) {}

  start() {
    if (isDev) {
      return
    }

    // Its own error messages carry the whole HTTP response, so errors are logged from the `error`
    // event instead, in one line.
    autoUpdater.logger = {
      info: message => logger.info(String(message)),
      warn: message => logger.warning(String(message)),
      error: () => {},
    }
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater
      .on('update-available', info =>
        this.setStatus({ kind: 'downloading', version: info.version }),
      )
      .on('update-downloaded', info => this.setStatus({ kind: 'ready', version: info.version }))
      .on('error', err => {
        const message = err instanceof Error ? err.message : String(err)
        logger.warning(`Error updating: ${message.split('\n')[0]}`)
        if (this.status.kind === 'downloading') {
          this.setStatus({ kind: 'none' })
        }
      })

    this.schedule(FIRST_CHECK_DELAY_MS)
  }

  getStatus(): UpdateStatus {
    return this.status
  }

  /**
   * Quits and installs the downloaded update, then starts the new version. Waits for a running
   * analysis to finish first, so its StarCraft isn't left behind.
   */
  restart() {
    if (this.status.kind !== 'ready' || this.restarting) {
      return
    }
    this.restarting = true
    const install = () => autoUpdater.quitAndInstall(true /* isSilent */, true /* forceRunAfter */)
    if (this.activeGameManager.isIdle()) {
      install()
    } else {
      logger.info('Installing the update once the running analysis finishes')
      this.activeGameManager.once('idle', install)
    }
  }

  private schedule(delayMs: number) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      // A failed check is logged from the updater's `error` event.
      this.check()
        .catch(() => {})
        .finally(() => this.schedule(CHECK_INTERVAL_MS))
    }, delayMs)
  }

  private async check() {
    if (this.status.kind !== 'none') {
      return
    }
    const { checkForUpdates } = await this.localSettings.get()
    if (checkForUpdates === false) {
      return
    }
    await autoUpdater.checkForUpdates()
  }

  private setStatus(status: UpdateStatus) {
    this.status = status
    this.onStatusChange(status)
  }
}
