import crypto from 'crypto'
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeTheme,
  protocol,
  screen,
  Session,
  shell,
} from 'electron'
import isDev from 'electron-is-dev'
import localShortcut from 'electron-localshortcut'
import { readFile } from 'fs/promises'
import path from 'node:path'
import { container } from 'tsyringe'
import { URL } from 'url'
import swallowNonBuiltins from '../common/async/swallow-non-builtins'
import { getErrorStack } from '../common/errors'
import { GameIconsManifest } from '../common/game-icons'
import { TypedIpcMain, TypedIpcSender } from '../common/ipc'
import { DEFAULT_LOCAL_SETTINGS } from '../common/settings/default-settings'
import { LocalSettings } from '../common/settings/local-settings'
import { LEGACY_APP_ID, setAppId } from './app-id'
import { APP_ROOT } from './app-paths'
import { AutoCaptureService } from './auto-capture'
import { checkGgStatsFiles } from './check-gg-stats-files'
import { getClientShellTemplate, renderClientShell } from './client-shell'
import currentSession from './current-session'
import { registerCurrentProgram } from './file-association'
import { findInstallPath } from './find-install-path'
import { ActiveGameManager } from './game/active-game-manager'
import { checkStarcraftPath } from './game/check-starcraft-path'
import { CommandStatsBackfill } from './game/command-stats-backfill'
import createGameServer, { GameServer } from './game/game-server'
import { GameStatsStore } from './game/game-stats-store'
import { analyzeFolder, exportLadderBaseline, getLadderRunArgs } from './ladder-baseline/ladder-run'
import { getLaunchReplayPaths } from './launch-args'
import logger from './logger'
import { setupMyStats } from './my-stats'
import { ReplayLibraryService, setupReplayLibrary } from './replay-library'
import { parseReplayMetadata, readReplayChat } from './replay-library/replay-parser'
import { LocalSettingsManager, ScrSettingsManager } from './settings'
import type { NewInstanceNotification } from './single-instance'
import SystemTray from './system-tray'
import { Updater } from './updater'
import { getUserDataPath } from './user-data-path'

process
  .on('uncaughtException', function (err) {
    // NOTE(tec27): Electron seems to emit null errors sometimes? Not much we can do about logging
    // them. (One I have definitely seen this for is 'ResizeObserver loop limit exceeded', which
    // is an error that can be safely ignored anyway)
    if (!err) return

    console.error(err.stack ?? err)
    logger.error(err.stack ?? String(err))
    // TODO(tec27): We used to exit here, what's the right thing now? Close window? Show error
    // dialog to user?
  })
  .on('unhandledRejection', function (err) {
    logger.error((err as any).stack ?? String(err))
    if (err instanceof TypeError || err instanceof SyntaxError || err instanceof ReferenceError) {
      // TODO(tec27): We used to exit here, what's the right thing now? Close window? Show error
      // dialog to user?
    }
    // Other promise rejections are likely less severe, leave the process up but log it
  })

const ipcMain = new TypedIpcMain()

getUserDataPath()

// Dev builds are named `GG Stats-Local`, so they never share an id with an installed GG Stats.
const modelId =
  (app.name.split('-')[1] ?? '').toLowerCase() === 'local' ? 'app.ggstats.local' : 'app.ggstats'
setAppId(modelId)
app.setAppUserModelId(modelId)

// Set up our main file's protocol to enable the necessary features
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ggstats',
    privileges: {
      // Ensure we have localStorage/cookies available
      standard: true,
      // Act like https
      secure: true,
      bypassCSP: false,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

// Keep a reference to the window and system tray objects so they don't get GC'd and closed
let mainWindow: BrowserWindow | null
let systemTray: SystemTray
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let gameServer: GameServer
let replayLibrary: ReplayLibraryService | undefined
// The replay folders last handed to the library service, so a settings change is only forwarded
// when the resolved list actually differs. Seeded when the service is created.
let lastReplayFolders: string[] | undefined
// Whether the renderer has reported itself fully bootstrapped (see `rendererReady` in
// common/ipc.ts). Until then, `replaysOpen` sends are queued rather than sent: on a cold start the
// launch args are handled before the renderer's IPC listeners exist, and messages sent with no
// listener attached are silently dropped.
let rendererReady = false
let pendingReplaysToOpen: string[] = []

export function notifyNewInstance(data: NewInstanceNotification) {
  if (mainWindow) {
    if (!mainWindow.isVisible()) {
      mainWindow.show()
    } else {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }
  }

  if (data.args.length > 1) {
    handleLaunchArgs(data.args.slice(1))
  }
}

function handleLaunchArgs(args: string[]) {
  logger.info(`Handling launch args: ${JSON.stringify(args)}`)

  const replayPaths = getLaunchReplayPaths(args)

  if (replayPaths.length) {
    const replays = replayPaths.map(p => path.resolve('.', p))
    if (rendererReady) {
      TypedIpcSender.from(mainWindow?.webContents).send('replaysOpen', replays)
    } else {
      pendingReplaysToOpen.push(...replays)
    }
    mainWindow?.show()
  }
}

/** The default replay folder, indexed when the user hasn't configured their own. */
function defaultReplayFolder(): string {
  return path.join(app.getPath('documents'), 'Starcraft', 'maps', 'replays')
}

/**
 * The absolute folders the replay library should index for the given settings: the user's
 * configured list, normalized with empty entries dropped. `undefined` (the folders were never
 * configured) falls back to the default folder; an explicit empty array (the user removed every
 * configured folder) resolves to `[]`, indexing nothing. Both are ordinary durable states.
 */
function resolveReplayFolders(settings: Readonly<Partial<LocalSettings>>): string[] {
  const configured = settings.replayLibraryFolders
  if (configured === undefined) {
    return [defaultReplayFolder()]
  }
  return configured.map(folder => path.normalize(folder)).filter(folder => folder.length > 0)
}

async function createLocalSettings() {
  const sessionName = process.env.GGSTATS_SESSION
  const fileName = sessionName ? `settings-${sessionName}.json` : 'settings.json'
  const settings = new LocalSettingsManager(path.join(getUserDataPath(), fileName))
  await settings.untilInitialized()
  return settings
}

async function createScrSettings() {
  const sessionName = process.env.GGSTATS_SESSION
  const fileName = sessionName ? `scr-settings-${sessionName}.json` : 'scr-settings.json'
  const settings = new ScrSettingsManager(
    path.join(getUserDataPath(), fileName),
    path.join(app.getPath('documents'), 'StarCraft', 'CSettings.json'),
    path.join(getUserDataPath(), sessionName ? `CSettings-${sessionName}.json` : 'CSettings.json'),
  )
  await settings.untilInitialized()
  return settings
}

function setupIpc(localSettings: LocalSettingsManager, scrSettings: ScrSettingsManager) {
  ipcMain.on('rendererReady', () => {
    logger.verbose('Renderer reported ready')
    rendererReady = true
    if (pendingReplaysToOpen.length) {
      TypedIpcSender.from(mainWindow?.webContents).send('replaysOpen', pendingReplaysToOpen)
      pendingReplaysToOpen = []
    }
  })

  ipcMain.handle('logMessage', (event, level, message) => {
    logger.log(level, message)
  })

  ipcMain.handle('settingsLocalGet', async () => {
    try {
      return await localSettings.get()
    } catch (err: unknown) {
      logger.error('Error getting local settings: ' + err)
      throw err
    }
  })
  ipcMain.handle('settingsScrGet', async () => {
    try {
      return await scrSettings.get()
    } catch (err: unknown) {
      logger.error('Error getting SC:R settings: ' + err)
      throw err
    }
  })
  ipcMain.handle('settingsLocalMerge', (event, settings) => {
    // This will trigger a change if things changed, which will then emit a `settingsLocalChanged`
    localSettings.merge(settings).catch(err => {
      logger.error('Error merging local settings: ' + err)
    })
  })
  ipcMain.handle('settingsScrMerge', (event, settings) => {
    // This will trigger a change if things changed, which will then emit a `settingsScrChanged`
    scrSettings.merge(settings).catch(err => {
      logger.error('Error merging SC:R settings: ' + err)
    })
  })
  ipcMain.handle('windowGetStatus', async () => {
    if (!mainWindow) {
      return {
        focused: false,
        maximized: false,
      }
    }

    return {
      focused: mainWindow.isFocused(),
      maximized: mainWindow.isMaximized(),
    }
  })

  let lastRunAppAtSystemStart: boolean | undefined
  let lastRunAppAtSystemStartMinimized: boolean | undefined

  /** Keeps whether Windows starts the app in step with its settings. */
  const applyStartWithWindows = (settings: Readonly<Partial<LocalSettings>>) => {
    const atStart = settings.runAppAtSystemStart ?? DEFAULT_LOCAL_SETTINGS.runAppAtSystemStart
    const minimized =
      settings.runAppAtSystemStartMinimized ?? DEFAULT_LOCAL_SETTINGS.runAppAtSystemStartMinimized
    // A development build would register the bare Electron binary to start with Windows.
    if (
      app.isPackaged &&
      (lastRunAppAtSystemStart !== atStart || lastRunAppAtSystemStartMinimized !== minimized)
    ) {
      if (lastRunAppAtSystemStart === undefined) {
        // Windows names the entry after the app id, and builds from before app.ggstats used
        // another one. Left in place, it would start the app a second time.
        app.setLoginItemSettings({ openAtLogin: false, name: LEGACY_APP_ID })
      }
      app.setLoginItemSettings({
        openAtLogin: atStart,
        args: [minimized ? '--hidden' : ''],
      })
      lastRunAppAtSystemStart = atStart
      lastRunAppAtSystemStartMinimized = minimized
    }
  }
  // Settings loaded at startup don't count as a change, and may have been migrated to new values.
  localSettings
    .get()
    .then(applyStartWithWindows)
    .catch(err => {
      logger.error(`Error setting whether to start with Windows: ${getErrorStack(err)}`)
    })

  localSettings.on('change', settings => {
    applyStartWithWindows(settings)

    if (replayLibrary) {
      const folders = resolveReplayFolders(settings)
      if (
        !lastReplayFolders ||
        folders.length !== lastReplayFolders.length ||
        folders.some((folder, i) => folder !== lastReplayFolders![i])
      ) {
        lastReplayFolders = folders
        replayLibrary.setWatchedFolders(folders)
      }
    }

    TypedIpcSender.from(mainWindow?.webContents).send('settingsLocalChanged', settings)
  })
  scrSettings.on('change', settings => {
    TypedIpcSender.from(mainWindow?.webContents).send('settingsScrChanged', settings)
  })

  ipcMain
    .on('windowClose', (_, shouldDisplayCloseHint) => {
      if (!mainWindow) {
        return
      }
      if (systemTray) {
        mainWindow.hide()
        if (shouldDisplayCloseHint) systemTray.displayHowToCloseHint()
      } else {
        mainWindow.close()
      }
    })
    .on('windowMaximize', () => {
      if (!mainWindow) {
        return
      }
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow.maximize()
      }
    })
    .on('windowMinimize', () => {
      if (!mainWindow) {
        return
      }
      mainWindow.minimize()
    })

  ipcMain.handle('gameIconsGet', async () => {
    try {
      const text = await readFile(path.join(GAME_ICONS_DIR, 'cmdicons.json'), 'utf8')
      return JSON.parse(text) as GameIconsManifest
    } catch {
      return undefined
    }
  })

  ipcMain.handle('pathsShowItemInFolder', async (event, path) => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle('settingsAutoPickStarcraftPath', async event => {
    let starcraftPath = await findInstallPath()
    const found = !!starcraftPath
    if (!starcraftPath) {
      starcraftPath = process.env['ProgramFiles(x86)']
        ? `${process.env['ProgramFiles(x86)']}\\Starcraft`
        : `${process.env.ProgramFiles}\\Starcraft`
    }
    localSettings.merge({ starcraftPath }).catch(swallowNonBuiltins)

    return found
  })

  ipcMain.handle('settingsCheckStarcraftPath', async (event, path) => checkStarcraftPath(path))

  ipcMain.handle('settingsBrowseForStarcraft', async (event, defaultPath) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select StarCraft folder',
      defaultPath,
      properties: ['openDirectory'],
    })

    return { canceled, filePaths }
  })

  ipcMain.handle('settingsBrowseForFolder', async (event, options) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      title: options.title,
      defaultPath: options.defaultPath,
      properties: ['openDirectory'],
    })

    return { canceled, filePaths }
  })

  ipcMain.handle('settingsGetDefaultReplayFolder', async () => defaultReplayFolder())

  ipcMain.handle('settingsGetMonitorInfo', async event => {
    const primary = screen.getPrimaryDisplay()
    const monitors = screen.getAllDisplays()
    return { primary, monitors }
  })

  const activeGameManager = container.resolve(ActiveGameManager)
  const gameStatsStore = container.resolve(GameStatsStore)

  activeGameManager
    .on('gameStatus', status => {
      TypedIpcSender.from(mainWindow?.webContents).send('activeGameStatus', status)
    })
    .on('replaySaved', (gameId, replayPath) => {
      TypedIpcSender.from(mainWindow?.webContents).send('activeGameReplaySaved', gameId, replayPath)
      gameStatsStore.setReplayPath(gameId, replayPath).catch(err => {
        logger.error(`Error saving the replay path for game ${gameId}: ${getErrorStack(err)}`)
      })
    })
    .on('gameStats', (gameId, stats, source) => {
      TypedIpcSender.from(mainWindow?.webContents).send('activeGameStats', gameId, stats, source)
      // Showing the stats doesn't wait on saving them; if saving fails they're still shown now.
      gameStatsStore.save(gameId, source, stats).catch(err => {
        logger.error(`Error saving the stats for game ${gameId}: ${getErrorStack(err)}`)
      })
    })
    .on('gameStatsFailed', gameId => {
      TypedIpcSender.from(mainWindow?.webContents).send('activeGameStatsFailed', gameId)
    })

  ipcMain.handle('activeGameClearConfig', (event, gameId) =>
    activeGameManager.clearGameConfig(gameId),
  )
  ipcMain.handle('activeGameSetConfig', (event, config) => {
    try {
      return activeGameManager.setGameConfig(config)
    } catch (err: any) {
      logger.error(`Error setting game config: ${getErrorStack(err)}`)
      return null
    }
  })
  if (isDev) {
    // Dev-only handlers: a release game build doesn't implement the underlying commands anyway,
    // but there's no reason to expose these outside of development.
    ipcMain.handle('activeGameDebugScreenshot', (event, gameId) =>
      activeGameManager.debugScreenshot(gameId),
    )
    ipcMain.handle('activeGameDebugCrash', (event, gameId, kind) =>
      activeGameManager.debugCrashGame(gameId, kind),
    )
    ipcMain.handle('activeGameForceQuit', (event, gameId) =>
      activeGameManager.forceQuitGame(gameId),
    )
  }
  ipcMain.handle(
    'gameStatsGet',
    async (event, gameId) => (await gameStatsStore.get(gameId)) ?? null,
  )
  ipcMain.handle('gameStatsSummarizeReplays', (event, replayPaths) =>
    gameStatsStore.summarizeReplays(replayPaths),
  )
  ipcMain.handle(
    'gameStatsFindByReplay',
    async (event, replayPath) => (await gameStatsStore.findByReplayPath(replayPath)) ?? null,
  )

  ipcMain.handle('replayParseMetadata', async (event, replayPath) => {
    return parseReplayMetadata(replayPath)
  })

  ipcMain.handle('replayReadChat', async (event, replayPath) => readReplayChat(replayPath))

  ipcMain.handle('ggStatsCheckFiles', () => checkGgStatsFiles())
}

/** Origin the renderer's modules are served from while hot-reloading. */
const DEV_SERVER_ORIGIN = 'http://localhost:5566'
/**
 * Where the dev server serves the shell, with its client and the React Refresh preamble already
 * injected. The path is the shell's location relative to the Vite root, which is the repo root.
 */
const DEV_SHELL_URL = `${DEV_SERVER_ORIGIN}/app/index.html`

/**
 * Content types for everything served over `ggstats://`. Chromium enforces JavaScript MIME
 * types on module scripts, so an unlabelled (or mislabelled) `.js` fails to load outright rather
 * than being sniffed -- which is what the entire renderer is delivered as.
 */
const CONTENT_TYPES = new Map([
  ['.css', 'text/css'],
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.json', 'application/json'],
  ['.opus', 'audio/ogg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
])

/**
 * Where the game DLL saves StarCraft's command card icons from the player's install, see
 * `game/src/game_icons.rs`.
 */
const GAME_ICONS_DIR = path.join(getUserDataPath(), 'game-icons')

function contentTypeFor(pathname: string): string {
  return CONTENT_TYPES.get(path.posix.extname(pathname).toLowerCase()) ?? 'application/octet-stream'
}

function setupCspProtocol(curSession: Session) {
  // Register a protocol that will perform two functions:
  // - Return our shell HTML and the assets it references
  // - Add fake headers to the response such that we set up CSP with a nonce (necessary for
  //   styled-components to work properly), and unfortunately not really possible to do without
  //   HTTP headers
  curSession.protocol.handle('ggstats', async req => {
    const url = new URL(req.url)

    const pathname = path.posix.normalize(url.pathname)

    try {
      if (pathname === '/game-icons/cmdicons.png') {
        const contents = await readFile(path.join(GAME_ICONS_DIR, 'cmdicons.png'))
        return new Response(new Uint8Array(contents), {
          headers: { 'content-type': 'image/png' },
        })
      } else if (pathname.match(/^\/(assets|dist)\/.+$/)) {
        const contents = await readFile(path.join(APP_ROOT, pathname))
        // TODO(tec27): Unsure if this is the best way to convert this to something that TS 5.9 is
        // happy with to pass to Response?
        const data = new Uint8Array(contents)
        return new Response(data, { headers: { 'content-type': contentTypeFor(pathname) } })
      } else {
        const nonce = crypto.randomBytes(16).toString('base64')
        const isHot = !!process.env.GGSTATS_HOT

        const template = await getClientShellTemplate(
          isHot ? { shellUrl: DEV_SHELL_URL, origin: DEV_SERVER_ORIGIN } : undefined,
        )
        const result = renderClientShell(template, {
          cspNonce: nonce,
          reactDevToolsUrl: process.env.GGSTATS_REACT_DEV ? 'http://localhost:8097' : undefined,
        })

        // While hot-reloading the renderer's modules come from the dev server, which is a
        // different origin than the document. No 'unsafe-eval' is needed alongside it: the dev
        // server serves real modules rather than eval'd bundles.
        const devServerPolicy = isHot ? ` ${DEV_SERVER_ORIGIN}` : ''
        const allowedFonts = "'self'" + (isDev ? ' data:' : '')

        return new Response(result, {
          headers: {
            'content-type': 'text/html',
            'content-security-policy':
              `script-src 'self' 'nonce-${nonce}'${devServerPolicy};` +
              `style-src 'self' 'nonce-${nonce}';` +
              `font-src ${allowedFonts};` +
              "object-src 'none';" +
              "form-action 'none';",
          },
        })
      }
    } catch (err) {
      logger.error(`Error reading file for ggstats:// protocol: ${(err as any)?.stack ?? err}`)
      return new Response('Internal Server Error', {
        status: 500,
        statusText: 'Internal Server Error',
      })
    }
  })
}

function registerHotkeys() {
  const isMac = process.platform === 'darwin'
  localShortcut.register(mainWindow!, isMac ? 'Cmd+Alt+I' : 'Ctrl+Shift+I', () =>
    mainWindow?.webContents.toggleDevTools(),
  )
  localShortcut.register(mainWindow!, 'F12', () => mainWindow?.webContents.toggleDevTools())

  localShortcut.register(mainWindow!, 'CmdOrCtrl+R', () => {
    // TODO(tec27): Also allow for this if the user has the debug privilege
    if (isDev) {
      mainWindow?.webContents.reloadIgnoringCache()
    }
  })
  localShortcut.register(mainWindow!, 'CmdOrCtrl+Shift+R', () => {
    // TODO(tec27): Also allow for this if the user has the debug privilege
    if (isDev) {
      mainWindow?.webContents.reloadIgnoringCache()
    }
  })
  localShortcut.register(mainWindow!, 'F5', () => {
    // TODO(tec27): Also allow for this if the user has the debug privilege
    if (isDev) {
      mainWindow?.webContents.reloadIgnoringCache()
    }
  })

  localShortcut.register(mainWindow!, 'F11', () => {
    mainWindow?.setFullScreen(!mainWindow?.isFullScreen())
  })
}

function calculateOptimalWindowSize() {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

  const targetAspectRatio = 16 / 9

  const padding = 40
  const maxWidth = screenWidth - padding
  const maxHeight = screenHeight - padding

  let optimalWidth: number
  let optimalHeight: number

  if (maxWidth >= 1920 && maxHeight >= 1080) {
    optimalWidth = 1920
    optimalHeight = 1080
  } else if (maxWidth >= 1600 && maxHeight >= 900) {
    optimalWidth = 1600
    optimalHeight = 900
  } else if (maxWidth >= 1280 && maxHeight >= 720) {
    optimalWidth = 1280
    optimalHeight = 720
  } else {
    // Smaller displays: calculate based on available space with 16:9 ratio
    const widthBasedHeight = Math.round(maxWidth / targetAspectRatio)
    const heightBasedWidth = Math.round(maxHeight * targetAspectRatio)

    if (widthBasedHeight <= maxHeight) {
      optimalWidth = maxWidth
      optimalHeight = widthBasedHeight
    } else {
      optimalWidth = heightBasedWidth
      optimalHeight = maxHeight
    }
  }

  // Ensure the calculated size fits within the available space
  optimalWidth = Math.min(optimalWidth, maxWidth)
  optimalHeight = Math.min(optimalHeight, maxHeight)

  // Ensure minimum size requirements are met
  optimalWidth = Math.max(optimalWidth, 1024)
  optimalHeight = Math.max(optimalHeight, 640)

  return { width: optimalWidth, height: optimalHeight }
}

function isDarkTheme(themeMode: LocalSettings['themeMode']) {
  return themeMode === 'dark' || (themeMode !== 'light' && nativeTheme.shouldUseDarkColors)
}

/**
 * The window border Windows 11 draws around the app. It's set explicitly, since otherwise Windows
 * uses the system accent color when that's turned on for window borders. Matches the
 * outline-variant color of the app's theme.
 */
function getWindowBorderColor(themeMode: LocalSettings['themeMode']) {
  return isDarkTheme(themeMode) ? '#2c2c31' : '#e0e0e4'
}

async function createWindow() {
  const localSettings = container.resolve(LocalSettingsManager)
  const curSession = currentSession()

  // TODO(tec27): verify that window positioning is still valid on current monitor setup
  const { winX, winY, winWidth, winHeight, winMaximized, themeMode } = await localSettings.get()

  const optimalSize = calculateOptimalWindowSize()

  mainWindow = new BrowserWindow({
    width: winWidth && winWidth > 0 ? winWidth : optimalSize.width,
    height: winHeight && winHeight > 0 ? winHeight : optimalSize.height,
    x: winX && winX !== -1 ? winX : undefined,
    y: winY && winY !== -1 ? winY : undefined,
    minWidth: 1024,
    minHeight: 640,

    acceptFirstMouse: true,
    accentColor: getWindowBorderColor(themeMode),
    // NOTE(tec27): This should always match the background in root CSS
    backgroundColor: isDarkTheme(themeMode) ? '#0f0f11' : '#e8e8eb',
    frame: false,
    transparent: false,
    show: false,
    title: 'GG Stats',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      session: curSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  let currentThemeMode = themeMode
  const updateBorderColor = () => {
    mainWindow?.setAccentColor(getWindowBorderColor(currentThemeMode))
  }
  nativeTheme.on('updated', updateBorderColor)
  localSettings.on('change', settings => {
    if (settings.themeMode !== currentThemeMode) {
      currentThemeMode = settings.themeMode
      updateBorderColor()
    }
  })

  let needsMaximize = false

  if (winMaximized) {
    // BrowserWindow#maximize() causes the window to show, and our content might not be ready yet
    // (or we might be set to start minimized), so we don't want to show things yet. Instead we just
    // mark this as needing to happen, and handle doing it in the `show` event.
    needsMaximize = true
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const handleResizeOrMove = () => {
    debounceTimer = null
    if (!mainWindow || mainWindow.isMaximized()) {
      return
    }
    const { x: winX, y: winY, width: winWidth, height: winHeight } = mainWindow.getBounds()
    localSettings.merge({ winX, winY, winWidth, winHeight }).catch(err => {
      logger.error('Error saving new window bounds: ' + err)
    })
  }

  mainWindow
    .on('maximize', () => {
      localSettings.merge({ winMaximized: true }).catch(err => {
        logger.error('Error saving new window maximized state: ' + err)
      })
      TypedIpcSender.from(mainWindow?.webContents).send('windowMaximizedState', true)
    })
    .on('unmaximize', () => {
      localSettings.merge({ winMaximized: false }).catch(err => {
        logger.error('Error saving new window maximized state: ' + err)
      })
      TypedIpcSender.from(mainWindow?.webContents).send('windowMaximizedState', false)
    })
    .on('resize', () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
      debounceTimer = setTimeout(handleResizeOrMove, 100)
    })
    .on('move', () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
      debounceTimer = setTimeout(handleResizeOrMove, 100)
    })
    .on('focus', () => {
      TypedIpcSender.from(mainWindow?.webContents).send('windowFocusChanged', true)
    })
    .on('blur', () => {
      TypedIpcSender.from(mainWindow?.webContents).send('windowFocusChanged', false)
    })
    .on('show', () => {
      if (needsMaximize && mainWindow) {
        mainWindow.maximize()
        TypedIpcSender.from(mainWindow.webContents).send('windowMaximizedState', true)
        needsMaximize = false
      }
    })

  // Readiness is per-document: a committed main-frame navigation tears down the renderer that
  // reported ready, and the fresh document has to bootstrap and report in again before sends can
  // be delivered. This watches the commit (`did-navigate`) rather than load start deliberately:
  // navigation attempts that never commit (e.g. a file dropped onto the window, which
  // `will-navigate` rejects) fire `did-start-loading` but leave the current, still-ready renderer
  // in place, and marking it unready then would queue sends forever since no new bootstrap ever
  // follows. In-page routing fires `did-navigate-in-page` and doesn't affect readiness.
  mainWindow.webContents.on('did-navigate', () => {
    rendererReady = false
  })
  // A crashed renderer's listeners are gone with it, so sends must queue rather than drop.
  mainWindow.webContents.on('render-process-gone', () => {
    rendererReady = false
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== 'ggstats://app' && !url.startsWith('ggstats://app/')) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url)
      const protocol = parsedUrl.protocol.toLowerCase()

      // Whitelist safe protocols to prevent someone from e.g. linking to a local file and causing
      // users to launch it
      if (protocol === 'http:' || protocol === 'https:') {
        shell.openExternal(url).catch(err => {
          logger.error('Error opening external URL: ' + err)
        })
      }
    } catch (err) {
      logger.error('Error while parsing window.open URL: ' + err)
    }

    return { action: 'deny' }
  })

  registerHotkeys()

  if (!process.argv.includes('--hidden')) {
    mainWindow.once('ready-to-show', () => {
      mainWindow!.show()
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow.loadURL('ggstats://app')
}

app.on('ready', () => {
  // Analyzing a folder of ladder replays for the baseline, with no window, instead of opening.
  const ladderRun = getLadderRunArgs(process.argv)
  const localSettingsPromise = createLocalSettings()
  const scrSettingsPromise = createScrSettings()
  const programRegistrationPromise = registerCurrentProgram()

  // We don't display this anyway, and it registers shortcuts for things that we don't want (e.g.
  // Ctrl+W to close, Ctrl+R to refresh [which we don't want outside of dev])
  Menu.setApplicationMenu(null)

  Promise.resolve()
    .then(async () => {
      const [localSettings, scrSettings] = await Promise.all([
        localSettingsPromise,
        scrSettingsPromise,
        programRegistrationPromise,
      ])

      container.register(LocalSettingsManager, { useValue: localSettings })
      container.register(ScrSettingsManager, { useValue: scrSettings })
      if (ladderRun) {
        if (!process.env.GGSTATS_SESSION) {
          throw new Error('Analyzing a folder needs its own GGSTATS_SESSION, apart from your stats')
        }
        // Only the folder's replays, and none of the user's own games captured along the way.
        await localSettings.merge({ autoCapture: false, replayLibraryFolders: [ladderRun.folder] })
      }

      // Namespaced by GGSTATS_SESSION (like the settings/log files) so concurrent dev instances in the
      // same game don't write over each other's stats; without it (i.e. production) the bare name
      // is used.
      const statsDirName = process.env.GGSTATS_SESSION
        ? `game-stats-${process.env.GGSTATS_SESSION}`
        : 'game-stats'
      const gameStatsStore = new GameStatsStore(path.join(app.getPath('userData'), statsDirName))
      container.register(GameStatsStore, { useValue: gameStatsStore })

      setupIpc(localSettings, scrSettings)
      setupCspProtocol(currentSession())
      gameServer = createGameServer(localSettings)
      if (!ladderRun) {
        await createWindow()
      }

      try {
        const watchedFolders = resolveReplayFolders(await localSettings.get())
        lastReplayFolders = watchedFolders
        // Namespaced by GGSTATS_SESSION (like the settings/log files) so concurrent dev instances don't
        // contend over one index file; without it (i.e. production) the bare name is used.
        const sessionName = process.env.GGSTATS_SESSION
        const dbFileName = sessionName
          ? `replay-library-${sessionName}.sqlite`
          : 'replay-library.sqlite'
        replayLibrary = setupReplayLibrary({
          dbPath: path.join(app.getPath('userData'), dbFileName),
          watchedFolders,
          getSender: () => TypedIpcSender.from(mainWindow?.webContents),
          getAnalyzedReplayPaths: () => gameStatsStore.listAnalyzedReplayPaths(),
        })
      } catch (err) {
        // A failure to set up the replay index shouldn't take down the whole app.
        logger.error(`Error setting up the replay library: ${getErrorStack(err)}`)
      }
      setupMyStats(gameStatsStore, () => replayLibrary?.getGameTimes() ?? new Map())
      const commandStatsBackfill = new CommandStatsBackfill(
        gameStatsStore,
        async replayPath => {
          if (!replayLibrary) {
            throw new Error('The replay library is not running')
          }
          return await replayLibrary.readCommandStats(replayPath)
        },
        () => TypedIpcSender.from(mainWindow?.webContents).send('myStatsChanged'),
      )
      commandStatsBackfill.start()
      // New stats, and a played game's replay once it's saved, have commands to read.
      container
        .resolve(ActiveGameManager)
        .on('gameStats', () => commandStatsBackfill.schedule(5000))
        .on('replaySaved', () => commandStatsBackfill.schedule(5000))

      const autoCapture = new AutoCaptureService({
        replayFolder: defaultReplayFolder(),
        statePath: path.join(
          getUserDataPath(),
          process.env.GGSTATS_SESSION
            ? `auto-capture-${process.env.GGSTATS_SESSION}.json`
            : 'auto-capture.json',
        ),
        activeGameManager: container.resolve(ActiveGameManager),
        gameStatsStore,
        localSettings,
        getWindow: () => mainWindow,
        indexReplay: async replayPath => {
          await replayLibrary?.indexFile(replayPath)
        },
      })
      const autoCaptureStarted = autoCapture.start().catch(err => {
        // Analyzing replays by hand still works without it.
        logger.error(`Error starting auto capture: ${getErrorStack(err)}`)
      })
      ipcMain.handle('autoCaptureGetStatus', async () => autoCapture.getStatus())
      ipcMain.handle('autoCaptureRetry', async (_event, replayPath) =>
        autoCapture.retry(replayPath),
      )
      ipcMain.handle('autoCaptureResume', async () => autoCapture.resume())
      ipcMain.handle('autoCaptureAnalyzeReplays', (_event, replays) => autoCapture.analyze(replays))
      ipcMain.handle('autoCaptureClearWaiting', async () => autoCapture.clearWaiting())
      ipcMain.handle('autoCaptureSetPaused', async (_event, paused) =>
        autoCapture.setPaused(paused),
      )

      if (ladderRun) {
        await autoCaptureStarted
        const result = await analyzeFolder({
          folder: ladderRun.folder,
          retryFailed: ladderRun.retryFailed,
          autoCapture,
          backfill: commandStatsBackfill,
        })
        if (result.stopped) {
          console.error('Stopped analyzing after too many failures in a row. See the app log.')
        }
        if (ladderRun.exportPath && !result.quit) {
          await exportLadderBaseline({
            folder: ladderRun.folder,
            exportPath: ladderRun.exportPath,
            gameStatsStore,
          })
        }
        autoCapture.stop()
        app.exit(result.stopped ? 1 : 0)
        return
      }

      const updater = new Updater(localSettings, container.resolve(ActiveGameManager), status =>
        TypedIpcSender.from(mainWindow?.webContents).send('updaterStatusChanged', status),
      )
      updater.start()
      ipcMain.handle('updaterGetStatus', async () => updater.getStatus())
      ipcMain.handle('updaterRestart', () => updater.restart())

      systemTray = new SystemTray(mainWindow, () => app.quit())

      TypedIpcSender.from(mainWindow?.webContents).send(
        'windowMaximizedState',
        mainWindow?.isMaximized() ?? false,
      )
      TypedIpcSender.from(mainWindow?.webContents).send(
        'windowFocusChanged',
        mainWindow?.isFocused() ?? false,
      )

      if (!isDev && process.argv.length > 1) {
        handleLaunchArgs(process.argv.slice(1))
      }

      app.on('will-quit', () => {
        autoCapture.stop()
        localSettings.saveSettingsToDiskSync()
        scrSettings.saveSettingsToDiskSync()
      })
    })
    .catch(err => {
      logger.error(`Error initializing: ${err.stack ?? err}`)
      console.error(err)
      if (ladderRun) {
        app.exit(1)
        return
      }
      dialog.showErrorBox(
        'GG Stats Error',
        `There was an error starting GG Stats: ${err.message}\n${err.stack}`,
      )
      app.quit()
    })
})
app.on('window-all-closed', () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (!mainWindow) {
    createWindow().catch(err => {
      logger.error('Error creating window: ' + (err.stack ?? err))
      console.error(err)
      dialog.showErrorBox(
        'GG Stats Error',
        `There was an error starting GG Stats: ${err.message}\n${err.stack}`,
      )
      app.quit()
    })
  }
})
