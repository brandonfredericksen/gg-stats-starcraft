import { HKCU, REG_SZ, WindowsRegistry } from '@shieldbattery/windows-registry'
import { app, screen } from 'electron'
import { EventEmitter } from 'node:events'
import { promises as fsPromises } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { singleton } from 'tsyringe'
import { getErrorStack } from '../../common/errors'
import { GameDebugScreenshot, GameDebugScreenshotReply } from '../../common/games/game-debug'
import {
  GameLaunchConfig,
  getAnalyzedReplay,
  isReplayMapInfo,
} from '../../common/games/game-launch-config'
import { GameStatsPayload, GameStatsSource } from '../../common/games/game-stats'
import { GameStatus, ReportedGameStatus, statusToString } from '../../common/games/game-status'
import { DisplayMode } from '../../common/settings/blizz-settings'
import { DEFAULT_LOCAL_SETTINGS } from '../../common/settings/default-settings'
import {
  cloneCustomTeamColors,
  resolveFfaColors,
  resolveSeatlessTeamColors,
  resolveTeamSelfOverride,
} from '../../common/settings/team-colors'
import { gameLogBaseName } from '../log-paths'
import log from '../logger'
import { LocalSettingsManager, ScrSettingsManager } from '../settings'
import { checkStarcraftPath } from './check-starcraft-path'
import { isCrashExitCode } from './crash-exit-code'

// How long to wait for a `/game/debug/screenshot` reply before giving up. A release DLL doesn't
// recognize `debugControl` at all, so a request to one never gets a reply and always times out.
const DEBUG_SCREENSHOT_TIMEOUT_MS = 10000

interface PendingDebugReply<T> {
  resolve: (payload: T) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface ActiveGameInfo {
  id: string
  status?: {
    state: GameStatus
    extra: any // TODO(tec27): Type the extra param based on the GameStatus
  }
  /**
   * A promise for when the game process has been launched, returning an instance of the process.
   */
  promise?: Promise<any>
  config?: GameLaunchConfig
}

function isGameConfig(
  possibleConfig: GameLaunchConfig | Record<string, never>,
): possibleConfig is GameLaunchConfig {
  return !!(possibleConfig as any).setup
}

/**
 * Whether someone is playing or watching a game, from its launch until it has finished. A replay
 * being analyzed in the background doesn't count, since nobody is in it.
 */
function isInUse(game: ActiveGameInfo) {
  const state = game.status?.state ?? GameStatus.Unknown
  return (
    !(game.config && getAnalyzedReplay(game.config)) &&
    state >= GameStatus.Launching &&
    state < GameStatus.Finished
  )
}

/**
 * How long a replay analysis gets to start StarCraft and load the replay before it's treated as
 * stuck, like on an error dialog nobody can see.
 */
const REPLAY_ANALYSIS_START_TIMEOUT_MS = 90 * 1000
/**
 * How long a replay analysis gets to reach the replay's end once it's loaded. Seeking there usually
 * takes seconds, but a long replay on a slow computer can take a lot longer.
 */
const REPLAY_ANALYSIS_PLAY_TIMEOUT_MS = 5 * 60 * 1000

export type ActiveGameManagerEvents = {
  gameCommand: [gameId: string, command: string, ...args: any[]]
  gameStatus: [statusInfo: ReportedGameStatus]
  replaySaved: [gameId: string, path: string]
  gameStats: [gameId: string, stats: GameStatsPayload, source: GameStatsSource]
  gameStatsFailed: [gameId: string]
  /** No game is running anymore, so StarCraft is free for another. */
  idle: []
}

@singleton()
export class ActiveGameManager extends EventEmitter<ActiveGameManagerEvents> {
  private activeGame: ActiveGameInfo | null = null
  private serverPort = 0
  /** Stops the active replay analysis if it takes too long, see {@link watchReplayAnalysis}. */
  private replayAnalysisWatchdog: ReturnType<typeof setTimeout> | undefined
  /** FIFO queues of pending `debugScreenshot` requests, keyed by game ID. */
  private pendingDebugScreenshots = new Map<string, PendingDebugReply<GameDebugScreenshotReply>[]>()

  constructor(
    private localSettings: LocalSettingsManager,
    private scrSettings: ScrSettingsManager,
  ) {
    super()
  }

  getStatus(): ReportedGameStatus | null {
    const game = this.activeGame
    if (game) {
      return {
        id: game.id,
        state: statusToString(game.status?.state ?? GameStatus.Unknown),
        extra: game.status?.extra,
        isReplay: true,
        isReplayAnalysis: game.config ? getAnalyzedReplay(game.config) !== undefined : false,
      }
    } else {
      return null
    }
  }

  /** Whether no game is running, so StarCraft is free for another. */
  isIdle() {
    return !this.activeGame
  }

  private clearActiveGame() {
    this.activeGame = null
    this.emit('idle')
  }

  setServerPort(port: number) {
    this.serverPort = port
  }

  clearGameConfig(gameId: string) {
    if (this.activeGame?.id === gameId) {
      log.verbose(`Got clearGameConfig for ${gameId}, quitting`)
      clearTimeout(this.replayAnalysisWatchdog)
      this.emit('gameCommand', gameId, 'quit')
      this.setStatus(GameStatus.Unknown)
      this.clearActiveGame()
      this.rejectPendingDebugScreenshots(gameId, 'Game config cleared')
    } else {
      log.verbose(`Got clearGameConfig for ${gameId}, but it is not the active game`)
    }
  }

  /**
   * Sets the current game configuration. If this differs from the previous one, a new game client
   * will be launched. Only replays are launched: this app never takes part in a live game.
   *
   * @returns the ID of the active game client, or null if there isn't one
   */
  setGameConfig(config: GameLaunchConfig | Record<string, never>): string | null {
    if (isGameConfig(config) && !isReplayMapInfo(config.setup.map)) {
      log.error(`Not launching game ${config.setup.gameId}, since it isn't a replay`)
      return null
    }
    const current = this.activeGame
    if (
      isGameConfig(config) &&
      getAnalyzedReplay(config) &&
      current &&
      current.id !== config.setup.gameId &&
      isInUse(current)
    ) {
      // Launching replaces the active game, which would end what the user is playing or watching.
      log.warning(`Not analyzing a replay while game ${current.id} is in use`)
      return null
    }
    clearTimeout(this.replayAnalysisWatchdog)
    if (current && current.id !== config.setup?.gameId) {
      // Means that a previous game left hanging somehow; quit it
      this.emit('gameCommand', current.id, 'quit')
    }
    if (!isGameConfig(config)) {
      this.setStatus(GameStatus.Unknown)
      this.clearActiveGame()
      return null
    }

    const gameId = config.setup.gameId
    const activeGamePromise = doLaunch(
      gameId,
      this.serverPort,
      this.localSettings,
      this.scrSettings,
      getAnalyzedReplay(config) !== undefined,
    ).then(
      async proc => {
        try {
          const code = await proc.waitForExit()
          this.handleGameExit(gameId, code)
        } catch (err) {
          this.handleGameExitWaitError(gameId, err as Error)
        }
      },
      err => this.handleGameLaunchError(gameId, err),
    )
    this.activeGame = {
      id: gameId,
      promise: activeGamePromise,
      config,
      status: { state: GameStatus.Unknown, extra: null },
    }
    log.verbose(`Creating new game ${gameId}`)
    this.setStatus(GameStatus.Launching)
    if (getAnalyzedReplay(config)) {
      this.watchReplayAnalysis(gameId, REPLAY_ANALYSIS_START_TIMEOUT_MS)
    }
    return gameId
  }

  /**
   * Stops a replay analysis that doesn't report its stats within `timeoutMs`, since nobody can see
   * it to notice it's stuck. Replaces any earlier deadline.
   */
  private watchReplayAnalysis(gameId: string, timeoutMs: number) {
    clearTimeout(this.replayAnalysisWatchdog)
    this.replayAnalysisWatchdog = setTimeout(() => {
      if (this.activeGame?.id === gameId) {
        log.warning(`Replay analysis ${gameId} didn't report its stats in time, stopping it`)
        this.clearGameConfig(gameId)
      }
    }, timeoutMs)
  }

  /** Notifies the manager that a game instance has connected and is ready for configuration. */
  async handleGameConnected(id: string) {
    if (!this.activeGame || this.activeGame.id !== id) {
      // Not our active game, must be one we started before and abandoned
      this.emit('gameCommand', id, 'quit')
      log.verbose(`Game ${id} is not any of our active games, sending quit command`)
      return
    }

    this.setStatus(GameStatus.Configuring)
    const config = this.activeGame.config!
    const { map } = config.setup
    // Only replays are ever launched, see `setGameConfig`.
    config.setup.mapPath = isReplayMapInfo(map) ? map.path : undefined

    const local = await this.localSettings.get()
    // The stored settings should already have every field populated (via the defaults/migration
    // in `app/settings.ts`), but fall back to the defaults for anything that's still missing so
    // the resolvers below always have complete team-color settings to work with.
    const resolvedLocal = {
      ...DEFAULT_LOCAL_SETTINGS,
      ...local,
      customTeamColors:
        local.customTeamColors ?? cloneCustomTeamColors(DEFAULT_LOCAL_SETTINGS.customTeamColors),
      customFfaColors: local.customFfaColors ?? [...DEFAULT_LOCAL_SETTINGS.customFfaColors],
    }
    const desiredMonitorBounds =
      local.monitorId !== undefined
        ? screen.getAllDisplays().find(d => d.id === local.monitorId)?.bounds
        : undefined
    const monitorBounds = desiredMonitorBounds
      ? [
          desiredMonitorBounds.x,
          desiredMonitorBounds.y,
          desiredMonitorBounds.width,
          desiredMonitorBounds.height,
        ]
      : undefined

    // A replay watcher has no seat, so relational palettes that assume a "you" exists degrade.
    const resolvedTeamColors = resolveSeatlessTeamColors(resolvedLocal)

    this.emit('gameCommand', id, 'localUser', config.localUser)
    this.emit('gameCommand', id, 'blockedUsers', config.blockedUsers)
    const isAnalysis = getAnalyzedReplay(config) !== undefined
    const scr = await this.scrSettings.get()
    this.emit('gameCommand', id, 'settings', {
      local,
      // A replay being analyzed runs hidden, so it shouldn't take over the display.
      scr: isAnalysis ? { ...scr, displayMode: DisplayMode.Windowed } : scr,
      settingsFilePath: isAnalysis
        ? await this.getAnalysisSettingsFilePath()
        : this.scrSettings.gameFilepath,
      monitorBounds,
      replayNameTemplate: config.replayNameTemplate,
      // `local` only stores the active preset *names* plus the custom pools; the DLL has no
      // preset tables of its own, so the active preset is mapped to concrete colors here and the
      // DLL only ever receives resolved hex pools.
      teamColors: {
        usage: resolvedLocal.teamColorUsage,
        shuffle: resolvedLocal.shuffleColors,
        team: resolvedTeamColors,
        teamSelf: resolveTeamSelfOverride(resolvedLocal, resolvedTeamColors) ?? null,
        ffa: resolveFfaColors(resolvedLocal),
        ffaSelf: resolvedLocal.ffaSelfColor ?? null,
      },
    })

    this.emit('gameCommand', id, 'setupGame', config.setup)
  }

  /** The silent settings for a replay analysis, or the user's own if those can't be written. */
  private async getAnalysisSettingsFilePath() {
    try {
      return await this.scrSettings.writeSilentGameSettingsFile()
    } catch (err) {
      log.error(`Error writing the settings for a replay analysis: ${getErrorStack(err)}`)
      return this.scrSettings.gameFilepath
    }
  }

  handleGameLaunchError(id: string, err: Error) {
    log.error(`Error while launching game ${id}: ${err.stack}`)
    if (this.activeGame && this.activeGame.id === id) {
      clearTimeout(this.replayAnalysisWatchdog)
      this.setStatus(GameStatus.Error, err)
      this.clearActiveGame()
    }
  }

  handleSetupProgress(gameId: string, info: any) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }
    this.setStatus(info.state, info.extra)
    if (info.state === GameStatus.Error) {
      // A failed setup waits to be told to quit, which nobody would do for a hidden analysis.
      this.quitIfAnalyzingReplay(gameId)
    }
  }

  handleGameStart(gameId: string) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }
    this.setStatus(GameStatus.Playing)
    const config = this.activeGame.config
    if (config && getAnalyzedReplay(config)) {
      this.watchReplayAnalysis(gameId, REPLAY_ANALYSIS_PLAY_TIMEOUT_MS)
    }
  }

  /**
   * Tells the active game process to crash itself with the given fault (debug game builds only), so
   * the DLL's crash handling can be exercised end to end. Fire-and-forget: the process dies, and
   * the usual exit handling (including the crash dump check) runs.
   */
  debugCrashGame(gameId: string, kind: 'accessViolation' | 'stackOverflow'): void {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      log.verbose(`Got debugCrashGame for ${gameId}, but it is not the active game`)
      return
    }

    this.emit('gameCommand', gameId, 'debugControl', { type: 'crash', kind })
  }

  /**
   * Tells the active game process to quit abruptly (debug game builds only, but the underlying
   * `quit` command ships in all builds). This is a hard stop: it cancels the game process's async
   * runtime so the process exits even mid-game (when a graceful `cleanup_and_quit` can't run,
   * because the game thread is blocked inside the game loop) — so it does NOT run BW's exit cleanup
   * or save settings. Routes through the app so this manager tears down its own state cleanly,
   * unlike an external process kill. Fire-and-forget.
   */
  forceQuitGame(gameId: string): void {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      log.verbose(`Got forceQuitGame for ${gameId}, but it is not the active game`)
      return
    }

    this.emit('gameCommand', gameId, 'quit')
  }

  /**
   * Captures a screenshot from the active game process (debug game builds only). Defaults
   * `gameId` to the current active game, rejecting if there isn't one or it doesn't match. Rejects
   * on a {@link DEBUG_SCREENSHOT_TIMEOUT_MS} timeout since a build that doesn't support the
   * underlying `debugControl` command never replies, and rejects if the DLL reports a capture
   * error. On success, decodes the PNG and writes it to a file in the OS temp dir, resolving its
   * path and dimensions.
   */
  async debugScreenshot(gameId?: string): Promise<GameDebugScreenshot> {
    const id = gameId ?? this.activeGame?.id
    if (!id || !this.activeGame || this.activeGame.id !== id) {
      throw new Error(
        gameId
          ? `No active game matching '${gameId}' to screenshot`
          : 'No active game to screenshot',
      )
    }

    const replyPromise = this.enqueuePendingDebugReply(
      this.pendingDebugScreenshots,
      id,
      DEBUG_SCREENSHOT_TIMEOUT_MS,
      `Timed out waiting for debug screenshot from game ${id} (it may not be a debug build)`,
    )
    this.emit('gameCommand', id, 'debugControl', { type: 'screenshot' })
    const reply = await replyPromise

    if (!reply.screenshot) {
      throw new Error(reply.error ?? 'Game process reported a screenshot capture error')
    }

    const { width, height, pngBase64 } = reply.screenshot
    const filePath = path.join(os.tmpdir(), `ggstats-game-screenshot-${id}-${Date.now()}.png`)
    await fsPromises.writeFile(filePath, Buffer.from(pngBase64, 'base64'))

    return { path: filePath, width, height }
  }

  /** Resolves the oldest pending `debugScreenshot` request for `gameId`, if any. */
  handleDebugScreenshot(gameId: string, payload: GameDebugScreenshotReply) {
    this.resolvePendingDebugReply(this.pendingDebugScreenshots, gameId, payload, 'debug screenshot')
  }

  /**
   * Registers a pending debug reply for `gameId` in `map`, returning a promise that resolves when
   * a matching reply arrives (via {@link resolvePendingDebugReply}) or rejects after `timeoutMs`
   * with `timeoutMessage`, or on game teardown (via {@link rejectPendingDebugScreenshots}).
   */
  private enqueuePendingDebugReply<T>(
    map: Map<string, PendingDebugReply<T>[]>,
    gameId: string,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: PendingDebugReply<T> = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removePendingDebugReply(map, gameId, entry)
          reject(new Error(timeoutMessage))
        }, timeoutMs),
      }

      const queue = map.get(gameId) ?? []
      queue.push(entry)
      map.set(gameId, queue)
    })
  }

  /** Resolves the oldest pending entry for `gameId` in `map`, if any. */
  private resolvePendingDebugReply<T>(
    map: Map<string, PendingDebugReply<T>[]>,
    gameId: string,
    payload: T,
    logLabel: string,
  ) {
    const queue = map.get(gameId)
    const entry = queue?.shift()
    if (!entry) {
      log.verbose(`Got ${logLabel} for ${gameId} but none was pending`)
      return
    }
    if (queue!.length === 0) {
      map.delete(gameId)
    }

    clearTimeout(entry.timer)
    entry.resolve(payload)
  }

  private removePendingDebugReply<T>(
    map: Map<string, PendingDebugReply<T>[]>,
    gameId: string,
    entry: PendingDebugReply<T>,
  ) {
    const queue = map.get(gameId)
    if (!queue) {
      return
    }
    const index = queue.indexOf(entry)
    if (index !== -1) {
      queue.splice(index, 1)
    }
    if (queue.length === 0) {
      map.delete(gameId)
    }
  }

  /** Rejects and clears any pending debug screenshots for `gameId`. */
  private rejectPendingDebugScreenshots(gameId: string, reason: string) {
    const queue = this.pendingDebugScreenshots.get(gameId)
    if (!queue) {
      return
    }
    this.pendingDebugScreenshots.delete(gameId)
    for (const entry of queue) {
      clearTimeout(entry.timer)
      entry.reject(new Error(reason))
    }
  }

  handleGameFinished(gameId: string) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    this.setStatus(GameStatus.Finished)
    this.emit('gameCommand', gameId, 'cleanup_and_quit')
  }

  handleReplaySaved(gameId: string, path: string) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    log.verbose(`Replay saved to: ${path}`)
    this.emit('replaySaved', gameId, path)
  }

  handleGameStats(gameId: string, stats: GameStatsPayload) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    log.verbose(`Game stats received for game ${gameId}`)
    const { config } = this.activeGame
    const analyzedReplay = config && getAnalyzedReplay(config)
    const source: GameStatsSource = analyzedReplay
      ? {
          kind: 'replay',
          name: config.setup.name,
          path: analyzedReplay.path,
          linkedGameId: analyzedReplay.linkedGameId,
        }
      : { kind: 'game' }
    this.emit('gameStats', gameId, stats, source)
    this.quitIfAnalyzingReplay(gameId)
  }

  handleGameStatsFailed(gameId: string) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    log.error(`Game ${gameId} couldn't collect its stats`)
    this.emit('gameStatsFailed', gameId)
    this.quitIfAnalyzingReplay(gameId)
  }

  /** A replay analyzed in the background has nothing left to do once it has reported. */
  private quitIfAnalyzingReplay(gameId: string) {
    const config = this.activeGame?.config
    if (config && getAnalyzedReplay(config)) {
      clearTimeout(this.replayAnalysisWatchdog)
      this.emit('gameCommand', gameId, 'quit')
    }
  }

  handleGameExit(id: string, exitCode: number) {
    if (!this.activeGame || this.activeGame.id !== id) {
      return
    }

    log.verbose(`Game ${id} exited with code 0x${exitCode.toString(16)}`)
    clearTimeout(this.replayAnalysisWatchdog)
    if (isCrashExitCode(exitCode)) {
      logCrashDumpPresence().catch(err => {
        log.warning(`Error checking for a crash dump: ${getErrorStack(err)}`)
      })
    }

    Promise.resolve()
      .then(() => this.scrSettings.syncWithGameSettingsFile())
      .catch(err => {
        log.error(`Error syncing settings with game settings file: ${err?.stack ?? err}`)
      })

    const status = this.activeGame.status?.state ?? GameStatus.Unknown
    if (status < GameStatus.Finished) {
      if (status >= GameStatus.Playing) {
        this.setStatus(GameStatus.Unknown)
      } else {
        this.setStatus(
          GameStatus.Error,
          new Error(`Game exited unexpectedly with code 0x${exitCode.toString(16)}`),
        )
      }
    }

    this.clearActiveGame()
    this.rejectPendingDebugScreenshots(id, 'Game exited')
  }

  handleGameExitWaitError(id: string, err: Error) {
    log.error(`Error while waiting for game ${id} to exit: ${String(err.stack ?? err)}`)
  }

  private setStatus(state: GameStatus, extra: any = null) {
    if (this.activeGame) {
      this.activeGame.status = { state, extra }
      this.emit('gameStatus', this.getStatus()!)
      log.verbose(`Game status updated to '${statusToString(state)}' [${JSON.stringify(extra)}]`)
    }
  }
}

const injectPath32 = path.resolve(app.getAppPath(), '../game/dist/ggstats.dll')
const injectPath64 = path.resolve(app.getAppPath(), '../game/dist/ggstats_64.dll')

async function doLaunch(
  gameId: string,
  serverPort: number,
  localSettings: LocalSettingsManager,
  scrSettings: ScrSettingsManager,
  inBackground: boolean,
) {
  const settings = await localSettings.get()
  const injectPath = settings.launch32Bit ? injectPath32 : injectPath64
  try {
    await fsPromises.access(injectPath)
  } catch (err) {
    throw new Error(`Could not access/find the game DLL at ${injectPath}`, { cause: err })
  }

  let { starcraftPath } = settings
  if (!starcraftPath) {
    throw new Error('No Starcraft path set')
  }
  const checkResult = await checkStarcraftPath(starcraftPath)
  if (!checkResult.path || !checkResult.version) {
    throw new Error(`StarCraft path ${starcraftPath} not valid: ` + JSON.stringify(checkResult))
  }

  // Ensure that our local settings file is up-to-date with the current settings
  await scrSettings.writeGameSettingsFile()

  const userDataPath = app.getPath('userData')
  let appPath = settings.launch32Bit
    ? path.join(starcraftPath, 'x86', 'StarCraft.exe')
    : path.join(starcraftPath, 'x86_64', 'StarCraft.exe')
  try {
    // Attempt to resolve the real path, just to ensure our capitalization matches Windows' for the
    // compat settings registry key
    ;[appPath, starcraftPath] = await Promise.all([
      fsPromises.realpath(appPath),
      fsPromises.realpath(starcraftPath),
    ])
  } catch (err) {
    log.warn(`Failed to resolve real path for StarCraft executable: ${getErrorStack(err)}`)
    // If we can't resolve the real path, we just use the original path we had
  }

  log.debug(`Attempting to launch "${appPath}" with StarCraft path: "${starcraftPath}"`)

  const legacyCursorSizingArg = settings.legacyCursorSizing ? '-legacy-cursor-sizing' : ''
  // The DLL writes its log to `<name>.<slot>.log`; tell it the GGSTATS_SESSION-namespaced base so
  // concurrent dev instances don't share a log file. Prod (no GGSTATS_SESSION) → plain `game`.
  const logNameArg = `-log-name=${gameLogBaseName()}`
  // The DLL needs to know before SC:R creates its window that it must never be shown, take focus
  // or confine the cursor, and the game setup message arrives too late for that.
  const backgroundArg = inBackground ? '-background' : ''
  // NOTE(tec27): SC:R uses -launch as an argument to skip bnet launcher.
  const args =
    `"${appPath}" ${gameId} ${serverPort} "${userDataPath}" ` +
    `-launch ${legacyCursorSizingArg} ${logNameArg} ${backgroundArg}`

  // NOTE(tec27): We dynamically import this so that it doesn't crash the process on startup if
  // an antivirus decides to delete the native module
  const { launchProcess } = await import('./native/process/index')

  // People sometimes turn on compatibility settings for the game process for misguided reasons,
  // which then cause issues that they blame on us. So, we turn them off by overwriting the registry
  // key with a blank string, launch the game, and then restore whatever value they had set. This is
  // best effort, if it fails we just continue trying to launch
  const registry = new WindowsRegistry()
  let compatValue: string | undefined
  try {
    compatValue = (await registry.read(
      HKCU,
      'Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers',
      appPath,
    )) as string | undefined
    if (compatValue !== undefined && typeof compatValue !== 'string') {
      throw new Error(
        'Got unexpected type for compatibility settings: ' + JSON.stringify(compatValue),
      )
    }
  } catch (err) {
    log.warn(`Failed to read compatibility settings from registry: ${getErrorStack(err)}`)
    compatValue = undefined
  }

  try {
    if (compatValue) {
      log.debug(`Found compatibility settings for StarCraft: "${compatValue}"`)
      log.debug(`Overriding compatibility settings before launch...`)
      try {
        await registry.write(
          HKCU,
          'Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers',
          appPath,
          REG_SZ,
          '',
        )
      } catch (err) {
        log.warn(`Failed to write blank compatibility settings to registry: ${getErrorStack(err)}`)
      }
    }

    const proc = await launchProcess({
      appPath,
      args: args as any,
      currentDir: starcraftPath,
      dllPath: injectPath,
      dllFunc: 'OnInject',
      logCallback: ((msg: string) => log.verbose(`[Inject] ${msg}`)) as any,
    })
    log.verbose('Process launched')
    return proc
  } finally {
    if (compatValue) {
      log.debug(`Restoring compatibility settings after launch...`)
      try {
        await registry.write(
          HKCU,
          'Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers',
          appPath,
          REG_SZ,
          compatValue,
        )
      } catch (err) {
        log.warn(`Failed to restore compatibility settings to registry: ${getErrorStack(err)}`)
      }
    }
  }
}

/**
 * Records whether the game DLL managed to leave a crash dump for a crash that just ended the
 * process, so bug reports without a dump say whether one was ever written.
 */
async function logCrashDumpPresence(): Promise<void> {
  const dumpPath = path.join(app.getPath('userData'), 'logs', 'latest_crash.dmp')
  let stats
  try {
    stats = await fsPromises.stat(dumpPath)
  } catch (err) {
    if ((err as any)?.code === 'ENOENT') {
      log.warning('Game exited with a crash code but no crash dump was written')
      return
    }
    throw err
  }

  const ageMs = Date.now() - stats.mtimeMs
  if (ageMs > 2 * 60 * 1000) {
    log.warning(
      `Game exited with a crash code but the only crash dump is ${Math.round(ageMs / 1000)}s ` +
        `old (${stats.size} bytes)`,
    )
  } else if (stats.size === 0) {
    log.warning('Game exited with a crash code and the crash dump is empty')
  } else {
    log.verbose(`Crash dump written (${stats.size} bytes)`)
  }
}
