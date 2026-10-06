import type { Player, ReplayHeader } from '@shieldbattery/broodrep'
import type {
  Display,
  IpcMainEvent,
  IpcMainInvokeEvent,
  IpcRendererEvent,
  WebContents,
} from 'electron'
import { Promisable } from 'type-fest'
import { GameDebugScreenshot } from './games/game-debug'
import { GameLaunchConfig } from './games/game-launch-config'
import {
  GameStatsPayload,
  GameStatsSource,
  GameStatsSummary,
  ReplayStatsSource,
  SavedGameStats,
} from './games/game-stats'
import { ReportedGameStatus } from './games/game-status'
import { GgStatsFileResult } from './gg-stats-file'
import { MyStatsQuery, MyStatsResult } from './my-stats/my-stats'
import {
  ReplayBackfillProgress,
  ReplayLibraryEntry,
  ReplayLibraryFilters,
  ReplayLibraryStatus,
  ReplayPlaylist,
  ReplayTrashResult,
  SuggestedOwnName,
} from './replays-library'
import { LocalSettings, ScrSettings } from './settings/local-settings'
import { UpdateStatus } from './updates'

const IS_RENDERER = typeof process === 'undefined' || !process || process.type === 'renderer'
const ipcRenderer = IS_ELECTRON && IS_RENDERER ? window.GGSTATS_ELECTRON_API!.ipcRenderer : null
const ipcMain = IS_ELECTRON && !IS_RENDERER ? require('electron').ipcMain : null

/** What the renderer shows when a captured game has been analyzed. */
export interface AutoCaptureSummary {
  /** Like `PvZ`, if the teams could be worked out. */
  matchup?: string
  mapName: string
}

/** A replay from the library to analyze in the background. */
export interface ReplayToAnalyze {
  path: string
  name: string
  linkedGameId?: string
  /** When the game started, in unix ms, which seeds the replay. */
  gameTime: number
  mapName: string
  /** Like `PvZ`, if known. */
  matchup?: string
}

/** Where each automatically captured replay is in being analyzed. */
export interface AutoCaptureStatus {
  enabled: boolean
  /** Analyzing stopped after too many failures in a row, until it's resumed. */
  paused: boolean
  /** The user paused analyzing. Games still wait to be analyzed, and the one running finishes. */
  pausedByUser: boolean
  /** Paths of the replays waiting to be analyzed, besides the one being analyzed now. */
  queued: string[]
  /** The path of the replay being analyzed now. */
  running?: string
  /** Paths of the replays that couldn't be analyzed, until they're retried. */
  failed: string[]
}

/** RPCs that can be invoked by the renderer process to run code in the main process. */
interface IpcInvokeables {
  /**
   * Clears the current game config (e.g. cancels a game launch) provided the current game is
   * `gameId`.
   */
  activeGameClearConfig: (gameId: string) => void
  /**
   * Captures a screenshot from the active game process's debug build (debug game builds only).
   * Only registered in development (`isDev`); on a build that doesn't support it the request is
   * never acknowledged, so this rejects on a timeout rather than hanging forever.
   */
  activeGameDebugScreenshot: (gameId?: string) => GameDebugScreenshot
  /**
   * Tells the active game process to crash itself with the given fault (debug game builds only), to
   * exercise the DLL's crash handler. Only registered in development (`isDev`). Fire-and-forget:
   * the process dies; verify via the game log's `[CRASH]` lines, a fresh non-empty
   * `latest_crash.dmp`, and the crash exit code the app logs.
   */
  activeGameDebugCrash: (gameId: string, kind: 'accessViolation' | 'stackOverflow') => void
  /**
   * Tells the active game process to quit abruptly (a hard stop that skips BW cleanup / settings
   * save; the only teardown that works mid-game). Only registered in development (`isDev`).
   * Fire-and-forget: there's no reply.
   */
  activeGameForceQuit: (gameId: string) => void
  activeGameSetConfig: (config: GameLaunchConfig | Record<string, never>) => string | null

  logMessage: (level: string, message: string) => void

  /** Reveals `path` in the OS file manager (opens its containing folder and selects it). */
  pathsShowItemInFolder: (path: string) => Promise<void>

  replayParseMetadata: (replayPath: string) => Promise<{
    headerData: ReplayHeader
    players: Player[]
  }>

  /**
   * Returns the page of indexed replays matching `filters` selected by `filters.offset`/
   * `filters.limit`, ordered per `filters.sort` (newest-first by default), plus `total`, the
   * number of matches across all pages.
   */
  replayLibraryQuery: (
    filters: ReplayLibraryFilters,
  ) => Promise<{ entries: ReplayLibraryEntry[]; total: number }>
  /** Current status of the replay index (total indexed, backfill progress, watched folder). */
  replayLibraryStatus: () => Promise<ReplayLibraryStatus>
  /**
   * Bookmarks or unbookmarks replays in a single transaction. Resolves to the ids whose state
   * actually changed (replays already in the requested state are left out).
   */
  replayLibrarySetBookmarked: (replayIds: number[], bookmarked: boolean) => Promise<number[]>
  /** Lists the local playlists, ordered per their manual arrangement. */
  replayLibraryListPlaylists: () => Promise<ReplayPlaylist[]>
  /** Creates a new, empty playlist, appended after the existing ones. Returns its new id. */
  replayLibraryCreatePlaylist: (name: string) => Promise<number>
  replayLibraryRenamePlaylist: (id: number, name: string) => Promise<void>
  /** Deletes a playlist and its entries. */
  replayLibraryDeletePlaylist: (id: number) => Promise<void>
  /**
   * Appends replays to a playlist (already-present replays are left where they are). Resolves to
   * the ids that were actually added.
   */
  replayLibraryAddToPlaylist: (playlistId: number, replayIds: number[]) => Promise<number[]>
  /** Removes replays from a playlist, closing the gap in the remaining manual order. */
  replayLibraryRemoveFromPlaylist: (playlistId: number, replayIds: number[]) => Promise<void>
  /** Moves a replay to `toIndex` (clamped) within a playlist's manual order. */
  replayLibraryMovePlaylistEntry: (
    playlistId: number,
    replayId: number,
    toIndex: number,
  ) => Promise<void>
  /** Names that look like the user's own, besides the ones they've already said are. */
  replayLibrarySuggestOwnNames: (knownNames: string[]) => Promise<SuggestedOwnName[]>
  /** The maps with the most replays, for picking one to filter by. */
  replayLibraryGetFrequentMaps: () => Promise<string[]>
  /** Lists the playlists containing a replay, ordered per their manual arrangement. */
  replayLibraryGetPlaylistsForReplay: (
    replayId: number,
  ) => Promise<Array<{ id: number; name: string }>>
  /**
   * Moves already-indexed replay files to the Recycle Bin, recoverable unlike
   * `replayLibraryRemoveSavedReplay`'s hard delete. A path that doesn't resolve inside one of the
   * watched replay folders is refused (reported `failed`) -- so this can never be used to trash an
   * arbitrary file. Every path is attempted even if an earlier one fails, and the result reports
   * each path's outcome in order. The index (and any playlist membership) is reconciled by the
   * watcher afterward, not by this call.
   */
  replayLibraryTrashReplays: (paths: string[]) => Promise<ReplayTrashResult[]>

  /** Returns a game's saved stats, or null if none were saved. */
  gameStatsGet: (gameId: string) => Promise<SavedGameStats | null>
  /**
   * Returns the most recently saved stats for a replay file, or null if that file hasn't been
   * analyzed before (or has changed since).
   */
  gameStatsFindByReplay: (replayPath: string) => Promise<SavedGameStats | null>
  /** Summarizes the saved stats of each replay that has some, keyed by path. */
  gameStatsSummarizeReplays: (replayPaths: string[]) => Promise<Record<string, GameStatsSummary>>
  /** Sums up the user's analyzed games for My stats. */
  myStatsQuery: (query: MyStatsQuery) => Promise<MyStatsResult>

  autoCaptureGetStatus: () => Promise<AutoCaptureStatus>
  /** Analyzes a captured replay that failed again. */
  autoCaptureRetry: (replayPath: string) => Promise<void>
  /** Starts analyzing captured replays again after too many failures. */
  autoCaptureResume: () => Promise<void>
  /** Analyzes these replays one after another in the background, like captured games. */
  autoCaptureAnalyzeReplays: (replays: ReplayToAnalyze[]) => Promise<void>
  /**
   * Pauses analyzing or resumes it. A pause lets the game being analyzed finish, keeps every game
   * waiting, and lasts until it's resumed, across restarts.
   */
  autoCaptureSetPaused: (paused: boolean) => Promise<void>
  /** Drops the replays waiting to be analyzed. The one being analyzed now still finishes. */
  autoCaptureClearWaiting: () => Promise<void>

  settingsLocalGet: () => Promise<Partial<LocalSettings>>
  settingsScrGet: () => Promise<Partial<ScrSettings>>
  settingsLocalMerge: (settings: Readonly<Partial<LocalSettings>>) => void
  settingsScrMerge: (settings: Readonly<Partial<ScrSettings>>) => void

  settingsAutoPickStarcraftPath: () => Promise<boolean>
  settingsCheckStarcraftPath: (path: string) => Promise<{ path: boolean; version: boolean }>
  settingsBrowseForStarcraft: (
    defaultPath: string,
  ) => Promise<{ canceled: boolean; filePaths: string[] }>
  /** Opens a generic folder-picker dialog. */
  settingsBrowseForFolder: (options: {
    title?: string
    defaultPath?: string
  }) => Promise<{ canceled: boolean; filePaths: string[] }>
  /**
   * Returns the default replay folder path (`Documents/Starcraft/maps/replays`), since the
   * renderer can't compute the OS documents directory itself.
   */
  settingsGetDefaultReplayFolder: () => Promise<string>
  settingsGetMonitorInfo: () => Promise<{ primary: Display; monitors: Display[] }>

  ggStatsCheckFiles: () => Promise<GgStatsFileResult[]>

  updaterGetStatus: () => Promise<UpdateStatus>
  /** Restarts into the downloaded update, once any running analysis finishes. */
  updaterRestart: () => void

  windowGetStatus: () => Promise<{ focused: boolean; maximized: boolean }>
}

/** Events that can be sent from the renderer process to the main process. */
interface IpcRendererSendables {
  /**
   * Sent once the renderer has fully bootstrapped (IPC listeners registered, initial state loaded,
   * and the React app mounted). Messages sent from the main process before a listener exists are
   * silently dropped, so anything the main process wants to deliver around startup (e.g. replay
   * files passed as launch args) must be held until this arrives.
   */
  rendererReady: () => void

  windowClose: (shouldDisplayCloseHint: boolean) => void
  windowMaximize: () => void
  windowMinimize: () => void
}

/** Events that can be sent from the main process to a renderer process. */
interface IpcMainSendables {
  activeGameReplaySaved: (gameId: string, replayPath: string) => void
  activeGameStats: (gameId: string, stats: GameStatsPayload, source: GameStatsSource) => void
  /** Sent when a game ended without being able to report its stats. */
  activeGameStatsFailed: (gameId: string) => void
  activeGameStatus: (status: ReportedGameStatus) => void

  /** Sent when a captured game's replay starts being analyzed, so the renderer can follow it. */
  autoCaptureAnalysisStarted: (gameId: string, source: ReplayStatsSource) => void
  /** Sent when a captured game's replay was analyzed. */
  autoCaptureAnalyzed: (gameId: string, summary: AutoCaptureSummary) => void
  /** Sent when the notification for an analyzed game was clicked, to show its stats. */
  autoCaptureOpenStats: (gameId: string) => void
  autoCaptureStatusChanged: (status: AutoCaptureStatus) => void

  /** Sent when saved stats gained something My stats shows, outside a game ending. */
  myStatsChanged: () => void

  /** Sent whenever the replay index changes (files added/removed/updated). */
  replayLibraryChanged: () => void
  /**
   * Sent as the replay index backfills, so the UI can show progress. `undefined` signals the
   * backfill has finished (or had no work), letting the UI clear the indicator without a separate
   * status fetch.
   */
  replayLibraryBackfillProgress: (progress: ReplayBackfillProgress | undefined) => void

  replaysOpen: (replayPaths: string[]) => void

  settingsLocalChanged: (settings: Readonly<Partial<LocalSettings>>) => void
  settingsScrChanged: (settings: Readonly<Partial<ScrSettings>>) => void

  updaterStatusChanged: (status: UpdateStatus) => void

  /** Sent when the window is focused or unfocused. */
  windowFocusChanged: (focused: boolean) => void
  windowMaximizedState: (isMaximized: boolean) => void
}

/**
 * A wrapper around Electron's `ipcMain` that provides strongly typed events and invokes.
 */
export class TypedIpcMain {
  /**
   * Adds a handler for an `invoke`able IPC. This handler will be called whenever a
   * renderer calls `ipcRenderer.invoke(channel, ...args)`.
   *
   * If `listener` returns a Promise, the eventual result of the promise will be
   * returned as a reply to the remote caller. Otherwise, the return value of the
   * listener will be used as the value of the reply.
   *
   * The `event` that is passed as the first argument to the handler is the same as
   * that passed to a regular event listener. It includes information about which
   * WebContents is the source of the invoke request.
   */
  handle<K extends keyof IpcInvokeables>(
    channel: K,
    listener: (
      event: IpcMainInvokeEvent,
      ...args: Parameters<IpcInvokeables[K]>
    ) => Promisable<ReturnType<IpcInvokeables[K]>>,
  ): void {
    ipcMain?.handle(channel, listener as any)
  }

  /**
   * Handles a single `invoke`able IPC message, then removes the listener. See
   * `ipcMain.handle(channel, listener)`.
   */
  handleOnce<K extends keyof IpcInvokeables>(
    channel: K,
    listener: (
      event: IpcMainInvokeEvent,
      ...args: Parameters<IpcInvokeables[K]>
    ) => Promisable<ReturnType<IpcInvokeables[K]>>,
  ): void {
    ipcMain?.handleOnce(channel, listener as any)
  }

  /**
   * Removes any handler for `channel`, if present.
   */
  removeHandler(channel: keyof IpcInvokeables): void {
    ipcMain?.removeHandler(channel)
  }

  /**
   * Listens to `channel`, when a new message arrives `listener` would be called with
   * `listener(event, args...)`.
   */
  on<K extends keyof IpcRendererSendables>(
    channel: K,
    listener: (
      event: IpcMainEvent,
      ...args: Parameters<IpcRendererSendables[K]>
    ) => ReturnType<IpcRendererSendables[K]>,
  ): this {
    ipcMain?.on(channel, listener as any)
    return this
  }

  /**
   * Adds a one time `listener` function for the event. This `listener` is invoked
   * only the next time a message is sent to `channel`, after which it is removed.
   */
  once<K extends keyof IpcRendererSendables>(
    channel: K,
    listener: (
      event: IpcMainEvent,
      ...args: Parameters<IpcRendererSendables[K]>
    ) => ReturnType<IpcRendererSendables[K]>,
  ): this {
    ipcMain?.once(channel, listener as any)
    return this
  }

  /**
   * Removes listeners of the specified `channel`.
   */
  removeAllListeners(channel: keyof IpcRendererSendables): this {
    ipcMain?.removeAllListeners(channel)
    return this
  }

  /**
   * Removes the specified `listener` from the listener array for the specified
   * `channel`.
   */
  removeListener<K extends keyof IpcRendererSendables>(
    channel: K,
    listener: IpcRendererSendables[K],
  ): this {
    ipcMain?.removeListener(channel, listener)
    return this
  }
}

/**
 * A wrapper around an Electron `WebContents` for sending strongly-typed events to the renderer
 * process. This should be initialized with a particular window's `WebContents`, or `event.sender`
 * if it's for responding to a particular event (in which case `invoke` may be a better approach).
 */
export class TypedIpcSender {
  constructor(private sender?: WebContents) {}

  // NOTE(tec27): This just makes the general usage bit less awkward by avoiding the `new` keyword
  static from(sender?: WebContents) {
    return new TypedIpcSender(sender)
  }

  /**
   * Send an asynchronous message to the renderer process via `channel`, along with
   * arguments. Arguments will be serialized with the Structured Clone Algorithm,
   * just like `postMessage`, so prototype chains will not be included. Sending
   * Functions, Promises, Symbols, WeakMaps, or WeakSets will throw an exception.
   *
   * > **NOTE**: Sending non-standard JavaScript types such as DOM objects or special
   * Electron objects will throw an exception.
   *
   * The renderer process can handle the message by listening to `channel` with the
   * `ipcRenderer` module.
   */
  send<K extends keyof IpcMainSendables>(
    channel: K,
    ...args: Parameters<IpcMainSendables[K]>
  ): void {
    this.sender?.send(channel, ...args)
  }
}

/**
 * A wrapper around Electron's `ipcRenderer` that provides strongly typed events and invokes. This
 * is safe to import and use in code that is potentially run on the web too (it will just no-op in
 * that case).
 */
export class TypedIpcRenderer {
  /**
   * Resolves with the response from the main process.
   *
   * Send a message to the main process via `channel` and expect a result
   * asynchronously. Arguments will be serialized with the Structured Clone
   * Algorithm, just like `window.postMessage`, so prototype chains will not be
   * included. Sending Functions, Promises, Symbols, WeakMaps, or WeakSets will throw
   * an exception.
   *
   * > **NOTE:** Sending non-standard JavaScript types such as DOM objects or special
   * Electron objects will throw an exception.
   *
   * Since the main process does not have support for DOM objects such as
   * `ImageBitmap`, `File`, `DOMMatrix` and so on, such objects cannot be sent over
   * Electron's IPC to the main process, as the main process would have no way to
   * decode them. Attempting to send such objects over IPC will result in an error.
   *
   * The main process should listen for `channel` with `ipcMain.handle()`.
   *
   * If you need to transfer a `MessagePort` to the main process, use
   * `ipcRenderer.postMessage`.
   *
   * If you do not need a response to the message, consider using `send`.
   */
  invoke<K extends keyof IpcInvokeables>(
    channel: K,
    ...args: Parameters<IpcInvokeables[K]>
  ): Promise<Awaited<ReturnType<IpcInvokeables[K]>>> | undefined {
    return ipcRenderer?.invoke(channel, ...args)
  }

  /**
   * Send an asynchronous message to the main process via `channel`, along with
   * arguments. Arguments will be serialized with the Structured Clone Algorithm,
   * just like `window.postMessage`, so prototype chains will not be included.
   * Sending Functions, Promises, Symbols, WeakMaps, or WeakSets will throw an
   * exception.
   *
   * > **NOTE:** Sending non-standard JavaScript types such as DOM objects or special
   * Electron objects will throw an exception.
   *
   * Since the main process does not have support for DOM objects such as
   * `ImageBitmap`, `File`, `DOMMatrix` and so on, such objects cannot be sent over
   * Electron's IPC to the main process, as the main process would have no way to
   * decode them. Attempting to send such objects over IPC will result in an error.
   *
   * The main process handles it by listening for `channel` with the `ipcMain`
   * module.
   *
   * If you need to transfer a `MessagePort` to the main process, use
   * `ipcRenderer.postMessage`.
   *
   * If you want to receive a single response from the main process, like the result
   * of a method call, consider using `ipcRenderer.invoke`.
   */
  send<K extends keyof IpcRendererSendables>(
    channel: K,
    ...args: Parameters<IpcRendererSendables[K]>
  ): void {
    ipcRenderer?.send(channel, ...args)
  }

  /**
   * Listens to `channel`, when a new message arrives `listener` would be called with
   * `listener(event, args...)`.
   */
  on<K extends keyof IpcMainSendables>(
    channel: K,
    listener: (
      event: IpcRendererEvent,
      ...args: Parameters<IpcMainSendables[K]>
    ) => ReturnType<IpcMainSendables[K]>,
  ): this {
    ipcRenderer?.on(channel, listener as any)
    return this
  }

  /**
   * Adds a one time `listener` function for the event. This `listener` is invoked
   * only the next time a message is sent to `channel`, after which it is removed.
   */
  once<K extends keyof IpcMainSendables>(
    channel: K,
    listener: (
      event: IpcRendererEvent,
      ...args: Parameters<IpcMainSendables[K]>
    ) => ReturnType<IpcMainSendables[K]>,
  ): this {
    ipcRenderer?.once(channel, listener as any)
    return this
  }

  /**
   * Removes listeners of the specified `channel`.
   */
  removeAllListeners(channel: keyof IpcMainSendables): this {
    ipcRenderer?.removeAllListeners(channel)
    return this
  }

  /**
   * Removes the specified `listener` from the listener array for the specified
   * `channel`.
   */
  removeListener<K extends keyof IpcMainSendables>(
    channel: K,
    listener: (
      event: IpcRendererEvent,
      ...args: Parameters<IpcMainSendables[K]>
    ) => ReturnType<IpcMainSendables[K]>,
  ): this {
    ipcRenderer?.removeListener(channel, listener as any)
    return this
  }
}
