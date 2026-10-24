import { watch } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import path from 'node:path'
import { getErrorStack } from '../../common/errors'
import { LiveGame } from '../../common/live-game'
import { LocalSettings } from '../../common/settings/local-settings'
import log from '../logger'
import { LiveGameTracker } from './live-game-tracker'
import { ConnectLobbySocket, LobbyListener, LobbySocket } from './lobby-listener'
import { ReplayFolder, ReplaySavedWatcher } from './replay-saved-watcher'
import { CacheFiles, ScrCacheWatcher } from './scr-cache-watcher'
import { LogFiles, ShieldBatteryLogWatcher } from './shieldbattery-log-watcher'

/** Reads part of a file into `into`, or undefined if it isn't there. */
async function readPart(filePath: string, position: number, length: number, into: Uint8Array) {
  let handle
  try {
    handle = await open(filePath, 'r')
  } catch {
    return undefined
  }
  try {
    const { bytesRead } = await handle.read(into, 0, Math.min(length, into.length), position)
    return bytesRead
  } catch {
    // Like a file replaced while it was read: the next read tries again.
    return undefined
  } finally {
    await handle.close().catch(() => {})
  }
}

async function sizeOf(filePath: string) {
  try {
    return (await stat(filePath)).size
  } catch {
    return undefined
  }
}

function folderFiles(folder: string): CacheFiles {
  return {
    size: file => sizeOf(path.join(folder, file)),
    read: (file, position, length, into) =>
      readPart(path.join(folder, file), position, length, into),
  }
}

function watchedFolderFiles(folder: string): LogFiles {
  return {
    stat: async file => {
      try {
        const stats = await stat(path.join(folder, file))
        return { size: stats.size, id: `${stats.birthtimeMs}:${stats.ino}` }
      } catch {
        return undefined
      }
    },
    read: (file, position, length, into) =>
      readPart(path.join(folder, file), position, length, into),
    watch: (onChange, onError) => watchFolder(folder, onChange, onError),
  }
}

function watchFolder(folder: string, onChange: (file: string) => void, onError: () => void) {
  const watcher = watch(folder, { persistent: false }, (_event, file) => {
    if (file) {
      onChange(String(file))
    }
  })
  watcher.on('error', () => {
    watcher.close()
    onError()
  })
  return () => watcher.close()
}

function replayFolderOf(folder: string): ReplayFolder {
  return {
    modifiedMs: async file => {
      try {
        return (await stat(path.join(folder, file))).mtimeMs
      } catch {
        return undefined
      }
    },
    watch: (onChange, onError) => watchFolder(folder, onChange, onError),
  }
}

/**
 * Connects with Node's own WebSocket. No message is ever sent on it; only the protocol's own
 * handshake, ping replies and closing frame go out.
 */
const connectLobbySocket: ConnectLobbySocket = url => {
  const webSocket = new WebSocket(url)
  const socket: LobbySocket = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    close: () => webSocket.close(),
  }
  webSocket.onopen = () => socket.onopen?.()
  webSocket.onmessage = event => socket.onmessage?.({ data: event.data })
  webSocket.onclose = () => socket.onclose?.()
  webSocket.onerror = () => socket.onerror?.()
  return socket
}

interface SettingsSource {
  get: () => Promise<Partial<LocalSettings>>
  on: (event: 'change', listener: (settings: Partial<LocalSettings>) => void) => unknown
}

export interface LiveGameServiceOptions {
  localSettings: SettingsSource
  /** Where StarCraft's embedded browser keeps its cache, `blizzard_browser_cache` in the temp folder. */
  browserCacheFolder: string
  /** Where ShieldBattery writes its logs. */
  shieldBatteryLogFolder: string
  /** StarCraft's replay folder in Documents, where it saves the replay of every game. */
  replayFolder: string
  onChange: (game: LiveGame | undefined) => void
  /** For tests: what reads the files and opens the socket, instead of the real ones. */
  createCacheWatcher?: () => ScrCacheWatcher
  createShieldBatteryWatcher?: () => ShieldBatteryLogWatcher
  createReplaySavedWatcher?: () => ReplaySavedWatcher
  connectLobby?: ConnectLobbySocket
  now?: () => number
}

/** How often a game is checked for being too old to still be going. */
const EXPIRE_CHECK_MS = 60_000

/**
 * Shows who's in a game the user joins: ladder matches and lobbies on Battle.net from what StarCraft
 * leaves in its browser cache, and ShieldBattery games from its logs. Runs while the `liveGame`
 * setting is on, and lets go of everything when it's turned off.
 */
export class LiveGameService {
  private readonly tracker: LiveGameTracker
  private cacheWatcher: ScrCacheWatcher | undefined
  private shieldBatteryWatcher: ShieldBatteryLogWatcher | undefined
  private replaySavedWatcher: ReplaySavedWatcher | undefined
  private lobby: { id: string; listener: LobbyListener } | undefined
  private expireTimer: ReturnType<typeof setInterval> | undefined
  private enabled = false
  /** Set once stopped for good, like when the app quits, so a setting arriving late can't restart it. */
  private stopped = false

  constructor(private readonly options: LiveGameServiceOptions) {
    this.tracker = new LiveGameTracker(options.onChange, options.now)
  }

  private now() {
    return (this.options.now ?? Date.now)()
  }

  get game() {
    return this.tracker.game
  }

  async start() {
    this.options.localSettings.on('change', settings =>
      this.setEnabled(settings.liveGame !== false),
    )
    this.setEnabled((await this.options.localSettings.get()).liveGame !== false)
  }

  stop() {
    this.setEnabled(false)
    this.stopped = true
  }

  private setEnabled(enabled: boolean) {
    if (enabled === this.enabled || (enabled && this.stopped)) {
      return
    }
    this.enabled = enabled
    if (enabled) {
      this.startWatching()
    } else {
      this.stopWatching()
    }
  }

  private startWatching() {
    const cacheWatcher =
      this.options.createCacheWatcher?.() ??
      new ScrCacheWatcher(folderFiles(this.options.browserCacheFolder))
    cacheWatcher.on('sighting', sighting => {
      switch (sighting.kind) {
        case 'lobbyPage':
          this.listenToLobby(sighting.port, sighting.panelId, sighting.createdMs)
          break
        case 'matchPage':
          // A game the user joined replaces any lobby they were in.
          this.stopLobby()
          this.tracker.matchScreen(
            sighting.port,
            sighting.panelId,
            sighting.createdMs,
            sighting.atMs,
          )
          break
        case 'ladderProfile':
          this.tracker.ladderProfile(sighting)
          break
      }
    })
    cacheWatcher.on('profile', (name, gatewayId, profile) =>
      this.tracker.profileRead(name, gatewayId, profile),
    )
    cacheWatcher.on('error', err => {
      log.warning(`Couldn't read StarCraft's browser cache: ${getErrorStack(err)}`)
    })
    cacheWatcher.start()
    this.cacheWatcher = cacheWatcher

    const shieldBatteryWatcher =
      this.options.createShieldBatteryWatcher?.() ??
      new ShieldBatteryLogWatcher(watchedFolderFiles(this.options.shieldBatteryLogFolder))
    shieldBatteryWatcher.on('players', players => {
      this.stopLobby()
      this.tracker.shieldBatteryGame(players)
    })
    shieldBatteryWatcher.on('ended', () => this.tracker.gameEnded(this.now()))
    shieldBatteryWatcher.on('error', err => {
      log.warning(`Couldn't read ShieldBattery's log: ${getErrorStack(err)}`)
    })
    shieldBatteryWatcher.start()
    this.shieldBatteryWatcher = shieldBatteryWatcher

    const replaySavedWatcher =
      this.options.createReplaySavedWatcher?.() ??
      new ReplaySavedWatcher(replayFolderOf(this.options.replayFolder))
    replaySavedWatcher.on('saved', savedMs => this.tracker.gameEnded(savedMs))
    replaySavedWatcher.start()
    this.replaySavedWatcher = replaySavedWatcher

    this.expireTimer = setInterval(() => this.tracker.expire(), EXPIRE_CHECK_MS)
    this.expireTimer.unref?.()
  }

  private stopWatching() {
    this.cacheWatcher?.stop()
    this.cacheWatcher?.removeAllListeners()
    this.cacheWatcher = undefined
    this.shieldBatteryWatcher?.stop()
    this.shieldBatteryWatcher?.removeAllListeners()
    this.shieldBatteryWatcher = undefined
    this.replaySavedWatcher?.stop()
    this.replaySavedWatcher?.removeAllListeners()
    this.replaySavedWatcher = undefined
    clearInterval(this.expireTimer)
    this.expireTimer = undefined
    this.stopLobby()
    this.tracker.clear()
  }

  private stopLobby() {
    this.lobby?.listener.stop()
    this.lobby?.listener.removeAllListeners()
    this.lobby = undefined
  }

  /** Listens to the lobby whose page was made at `createdMs`, which tells it from another. */
  private listenToLobby(port: number, panelId: number, createdMs: number) {
    const id = `lobby-${port}-${panelId}-${createdMs}`
    if (this.lobby?.id === id) {
      return
    }
    this.stopLobby()
    const listener = new LobbyListener(
      port,
      panelId,
      this.options.connectLobby ?? connectLobbySocket,
    )
    this.lobby = { id, listener }
    listener.on('players', players => this.tracker.lobby(id, players))
    listener.on('starting', () => this.tracker.lobbyStarting(id))
    listener.on('end', () => {
      this.tracker.lobbyEnded(id)
      if (this.lobby?.listener === listener) {
        this.stopLobby()
      }
    })
    listener.start()
  }
}
