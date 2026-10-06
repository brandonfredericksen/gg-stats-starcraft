import { BrowserWindow, Notification } from 'electron'
import { nanoid } from 'nanoid'
import { watch } from 'node:fs'
import { readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getErrorStack } from '../../common/errors'
import { ReplayStatsSource } from '../../common/games/game-stats'
import { makeReplayAnalysisConfig } from '../../common/games/replay-analysis-config'
import {
  AutoCaptureStatus,
  AutoCaptureSummary,
  ReplayToAnalyze,
  TypedIpcSender,
} from '../../common/ipc'
import { ActiveGameManager } from '../game/active-game-manager'
import { GameStatsStore } from '../game/game-stats-store'
import log from '../logger'
import { mapReplayHeaderToRecord, parseReplayBuffer } from '../replay-library/replay-parser'
import { hashReplay, saveReplay } from '../replay-library/replay-save'
import { LocalSettingsManager } from '../settings'
import { AnalysisQueue, QueuedReplay } from './analysis-queue'
import { displayMatchup, getArchiveName } from './archive-naming'
import { findReplayCopy } from './find-copy'
import { FileSignature, LastReplayDetector } from './last-replay-detector'

/** The replay StarCraft saves after every game, in its replay folder. */
const LAST_REPLAY_FILE = 'LastReplay.rep'
/** Where captured replays without an AutoSave copy are kept, in the replay folder. */
const ARCHIVE_FOLDER = 'GG Stats'

/** What's saved between runs. */
interface AutoCaptureState {
  /** The last version of `LastReplay.rep` that was captured. */
  lastSeen?: FileSignature
  queue: QueuedReplay[]
  /** Replays that couldn't be analyzed, kept so they can be retried. */
  failed: QueuedReplay[]
  /** Whether the user paused analyzing. */
  pausedByUser?: boolean
}

async function readState(statePath: string): Promise<AutoCaptureState> {
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    return {
      lastSeen: state.lastSeen,
      queue: Array.isArray(state.queue) ? state.queue : [],
      failed: Array.isArray(state.failed) ? state.failed : [],
      pausedByUser: state.pausedByUser === true,
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      log.error(`Error reading the auto capture state: ${getErrorStack(err)}`)
    }
    return { queue: [], failed: [] }
  }
}

async function statSignature(filePath: string): Promise<FileSignature | undefined> {
  try {
    const { size, mtimeMs } = await stat(filePath)
    return { size, modifiedMs: Math.floor(mtimeMs) }
  } catch {
    return undefined
  }
}

export interface AutoCaptureOptions {
  /** StarCraft's replay folder, `<Documents>\StarCraft\Maps\Replays`. */
  replayFolder: string
  /** Where the capture state is saved between runs. */
  statePath: string
  activeGameManager: ActiveGameManager
  gameStatsStore: GameStatsStore
  localSettings: LocalSettingsManager
  getWindow: () => BrowserWindow | null
  /**
   * Adds a replay to the replay library now. The folder watcher would find it too, but not always
   * before the game is announced, and "Last game" looks for the newest game there.
   */
  indexReplay: (replayPath: string) => Promise<void>
}

/**
 * Picks up each game's replay as soon as the game ends, wherever it was played, and analyzes it
 * in the background. A replay StarCraft also saved to AutoSave is analyzed from there;
 * otherwise it's archived in the replay folder first, since `LastReplay.rep` is replaced by the
 * next game.
 */
export class AutoCaptureService {
  private detector: LastReplayDetector | undefined
  private queue: AnalysisQueue | undefined
  private state: AutoCaptureState = { queue: [], failed: [] }
  private enabled = false
  /** Saves happen one at a time, in order, so an older state never replaces a newer one. */
  private saving = Promise.resolve()

  constructor(private readonly options: AutoCaptureOptions) {}

  async start() {
    const { activeGameManager, localSettings } = this.options
    this.state = await readState(this.options.statePath)
    this.queue = new AnalysisQueue(
      {
        launch: replay => this.launch(replay),
        isIdle: () => activeGameManager.isIdle(),
        save: replays => {
          this.state.queue = [...replays]
          this.saveState()
          this.sendStatus()
        },
      },
      this.state.queue,
    )
    // Before anything can start one, so a pause from the last run holds from the first moment.
    this.queue.hold(this.state.pausedByUser === true)
    this.queue
      .on('started', (gameId, replay) => {
        const source: ReplayStatsSource = {
          kind: 'replay',
          name: replay.name,
          path: replay.path,
          linkedGameId: replay.linkedGameId,
        }
        this.sender().send('autoCaptureAnalysisStarted', gameId, source)
        this.sendStatus()
      })
      .on('analyzed', (gameId, replay) => {
        // Replays the user picked from the library show their progress there instead.
        if (!replay.manual) {
          this.options
            .indexReplay(replay.path)
            .catch(err => {
              log.warning(`Error indexing captured replay ${replay.path}: ${getErrorStack(err)}`)
            })
            .finally(() => this.announce(gameId, replay.summary))
        }
      })
      .on('gaveUp', replay => {
        log.warning(`Gave up analyzing captured replay ${replay.path}`)
        this.state.failed = [
          ...this.state.failed.filter(r => r.path !== replay.path),
          { ...replay, attempts: 0, notBefore: undefined },
        ]
        this.saveState()
        this.sendStatus()
      })
      .on('paused', () => {
        log.warning('Stopped analyzing captured replays after too many failures in a row')
        this.sendStatus()
      })

    activeGameManager
      .on('gameStats', gameId => this.queue?.finish(gameId, 'analyzed'))
      .on('gameStatsFailed', gameId => this.queue?.finish(gameId, 'failed'))
      .on('gameStatus', status => {
        const running = this.queue?.runningGameId
        if (!running) {
          return
        }
        if (status.id !== running) {
          // Something else, like a replay the user asked for, took StarCraft over.
          this.queue!.finish(running, 'replaced')
        } else if (status.state === 'error' || status.state === 'unknown') {
          // Stats are reported before the game exits, so ending without them is a failure.
          this.queue!.finish(running, 'failed')
        }
        this.sendStatus()
      })
      // Not from inside whatever cleared the game, which may still be finishing up.
      .on('idle', () => setImmediate(() => this.queue?.tryStart()))

    localSettings.on('change', settings => this.setEnabled(settings.autoCapture !== false))
    this.setEnabled((await localSettings.get()).autoCapture !== false)
  }

  stop() {
    this.detector?.stop()
    this.queue?.stop()
  }

  getStatus(): AutoCaptureStatus {
    const runningPath = this.queue?.runningReplay?.path
    return {
      enabled: this.enabled,
      paused: this.queue?.paused ?? false,
      pausedByUser: this.state.pausedByUser === true,
      queued: (this.queue?.pending ?? []).map(r => r.path).filter(p => p !== runningPath),
      running: runningPath,
      failed: this.state.failed.map(r => r.path),
    }
  }

  retry(replayPath: string) {
    const replay = this.state.failed.find(r => r.path === replayPath)
    if (!replay) {
      return
    }
    this.state.failed = this.state.failed.filter(r => r !== replay)
    this.saveState()
    this.queue?.resume()
    this.queue?.add(replay)
    this.sendStatus()
  }

  /** Analyzes replays the user picked, one after another, skipping ones that have stats. */
  async analyze(replays: ReadonlyArray<ReplayToAnalyze>) {
    // Asking for games to be analyzed is asking for analyzing to happen, so it ends a pause.
    if (this.state.pausedByUser) {
      this.setPaused(false)
    }
    for (const replay of replays) {
      if (await this.options.gameStatsStore.findByReplayPath(replay.path)) {
        continue
      }
      this.state.failed = this.state.failed.filter(r => r.path !== replay.path)
      this.queue?.add({
        path: replay.path,
        name: replay.name,
        linkedGameId: replay.linkedGameId,
        seed: replay.gameTime / 1000,
        summary: { matchup: replay.matchup, mapName: replay.mapName },
        manual: true,
      })
    }
    this.queue?.resume()
    this.sendStatus()
  }

  /** Pauses analyzing, or resumes it. See `autoCaptureSetPaused`. */
  setPaused(paused: boolean) {
    this.state.pausedByUser = paused
    this.queue?.hold(paused)
    this.saveState()
    this.sendStatus()
  }

  /** Stops analyzing the replays still waiting, captured or picked by the user. */
  clearWaiting() {
    this.queue?.clearWaiting()
    this.sendStatus()
  }

  resume() {
    this.queue?.resume()
    this.sendStatus()
  }

  private sendStatus() {
    this.sender().send('autoCaptureStatusChanged', this.getStatus())
  }

  private setEnabled(enabled: boolean) {
    if (enabled === this.enabled) {
      return
    }
    this.enabled = enabled
    this.queue?.setEnabled(enabled)
    this.sendStatus()
    if (enabled) {
      this.detector = new LastReplayDetector(
        path.join(this.options.replayFolder, LAST_REPLAY_FILE),
        {
          stat: statSignature,
          readFile: filePath => readFile(filePath),
          watchFolder: (folder, onChange) => {
            try {
              const watcher = watch(folder, (_event, fileName) => {
                if (fileName) {
                  onChange(fileName)
                }
              })
              watcher.on('error', err =>
                log.warning(`Stopped watching ${folder}: ${getErrorStack(err)}`),
              )
              return () => watcher.close()
            } catch (err) {
              // Polling still notices new replays, like before StarCraft creates the folder.
              log.warning(`Couldn't watch ${folder}: ${getErrorStack(err)}`)
              return () => {}
            }
          },
        },
        this.state.lastSeen,
      )
      this.detector
        .on('replay', (data, signature) => {
          this.capture(data, signature).catch(err => {
            log.error(`Error capturing a replay: ${getErrorStack(err)}`)
          })
        })
        .on('error', err => log.error(`Error checking for a new replay: ${getErrorStack(err)}`))
      this.detector.start()
      log.info('Capturing replays automatically')
    } else {
      this.detector?.stop()
      this.detector = undefined
      log.info('Stopped capturing replays automatically')
    }
  }

  private async capture(data: Buffer, signature: FileSignature) {
    this.state.lastSeen = signature
    this.saveState()

    const replay = mapReplayHeaderToRecord(
      {
        path: LAST_REPLAY_FILE,
        fileMtime: signature.modifiedMs,
        fileSize: signature.size,
        contentHash: hashReplay(data),
      },
      ...parseReplayParts(data),
    )
    const { folder, fileName } = getArchiveName(replay)
    const archiveFolder = path.join(this.options.replayFolder, ARCHIVE_FOLDER, folder)

    let replayPath = await findReplayCopy(
      data,
      signature,
      [
        {
          folder: path.join(this.options.replayFolder, 'AutoSave'),
          includeSubfolders: true,
          nearReplayTime: true,
        },
        { folder: archiveFolder, includeSubfolders: false, nearReplayTime: false },
      ],
      {
        readdir: async folderPath => {
          try {
            const entries = await readdir(folderPath, { withFileTypes: true })
            return entries.map(e => ({ name: e.name, isDirectory: e.isDirectory() }))
          } catch {
            return []
          }
        },
        stat: statSignature,
        readFile: filePath => readFile(filePath),
      },
    )
    if (replayPath) {
      log.info(`Captured a game whose replay StarCraft already saved at ${replayPath}`)
    } else {
      replayPath = (await saveReplay(archiveFolder, fileName.replace(/\.rep$/, ''), data)).path
      log.info(`Captured a game and saved its replay to ${replayPath}`)
    }

    if (await this.options.gameStatsStore.findByReplayPath(replayPath)) {
      return
    }
    this.queue?.add({
      path: replayPath,
      name: path.basename(replayPath),
      linkedGameId: replay.linkedGameId,
      seed: replay.gameTime / 1000,
      summary: {
        matchup: replay.matchup ? displayMatchup(replay.matchup) : undefined,
        mapName: replay.mapName,
      },
    })
  }

  private launch(replay: QueuedReplay): string | null {
    return this.options.activeGameManager.setGameConfig(
      makeReplayAnalysisConfig({
        gameId: nanoid(),
        name: replay.name,
        path: replay.path,
        analyze: true,
        linkedGameId: replay.linkedGameId,
        seed: replay.seed,
      }),
    )
  }

  private announce(gameId: string, summary: AutoCaptureSummary) {
    this.sender().send('autoCaptureAnalyzed', gameId, summary)

    const window = this.options.getWindow()
    const inTray = !window || !window.isVisible() || window.isMinimized()
    this.options.localSettings
      .get()
      .then(settings => {
        if (!inTray || settings.autoCaptureNotifications === false || !Notification.isSupported()) {
          return
        }
        const notification = new Notification({
          title: 'New game analyzed',
          body: summary.matchup ? `${summary.matchup} on ${summary.mapName}` : summary.mapName,
        })
        notification.on('click', () => {
          const current = this.options.getWindow()
          current?.show()
          current?.focus()
          this.sender().send('autoCaptureOpenStats', gameId)
        })
        notification.show()
      })
      .catch(err => log.error(`Error showing a notification: ${getErrorStack(err)}`))
  }

  private sender() {
    return TypedIpcSender.from(this.options.getWindow()?.webContents)
  }

  private saveState() {
    const { statePath } = this.options
    const json = JSON.stringify(this.state)
    this.saving = this.saving
      .then(async () => {
        const tempPath = `${statePath}.tmp`
        await writeFile(tempPath, json)
        await rename(tempPath, statePath)
      })
      .catch(err => log.error(`Error saving the auto capture state: ${getErrorStack(err)}`))
  }
}

function parseReplayParts(data: Buffer) {
  const { headerData, players, clientData } = parseReplayBuffer(data)
  return [headerData, players, clientData] as const
}
