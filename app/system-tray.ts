import { app, BrowserWindow, Menu, shell, Tray } from 'electron'
import path from 'path'
import { APP_ROOT } from './app-paths'
import logger from './logger'
import { getUserDataPath } from './user-data-path'

const NORMAL_ICON = path.join(APP_ROOT, 'assets', 'ggstats-tray.png')
const BALLOON_ICON = path.join(APP_ROOT, 'assets', 'ggstats-64.png')

export default class SystemTray {
  private systemTray: Tray

  constructor(
    readonly mainWindow: BrowserWindow | null,
    readonly onQuitClick: () => void,
  ) {
    this.systemTray = new Tray(NORMAL_ICON)
    this.systemTray.setToolTip(app.name)
    this.systemTray.setContextMenu(this.buildContextMenu())
    this.systemTray.on('click', this.onTrayClick)
  }

  buildContextMenu = () => {
    return Menu.buildFromTemplate([
      { label: 'Restore', type: 'normal', click: this.onTrayClick },
      { label: 'Open Logs Folder', type: 'normal', click: this.onOpenLogs },
      { label: `Quit ${app.name}`, type: 'normal', click: this.onQuitClick },
    ])
  }

  onOpenLogs = () => {
    shell.openPath(path.join(getUserDataPath(), 'logs')).catch(err => {
      logger.error(`Failed to open logs folder: ${err.stack ?? err}`)
    })
  }

  onTrayClick = () => {
    if (this.mainWindow?.isVisible()) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore()
      }
      this.mainWindow.focus()
    } else {
      this.mainWindow?.show()
    }
  }

  displayHowToCloseHint = () => {
    const message =
      'GG Stats is running in the background. Right click the system tray icon to quit.'
    this.systemTray.displayBalloon({
      icon: BALLOON_ICON,
      title: 'GG Stats',
      content: message,
    })
  }
}
