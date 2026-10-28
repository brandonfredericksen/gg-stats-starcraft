import { watch } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import path from 'node:path'
import { getErrorStack } from '../../common/errors'
import { LiveGame } from '../../common/live-game'
import { LocalSettings } from '../../common/settings/local-settings'
import log from '../logger'
import { CacheFiles } from './cache-watcher'
import { LiveGameTracker } from './live-game-tracker'
import { PlayerRanksStore } from './player-ranks-store'
import { ReplayFolder, ReplaySavedWatcher } from './replay-saved-watcher'
import { ShieldBatteryCacheWatcher } from './sb-cache'
import { ScrCacheWatcher } from './scr-cache-watcher'
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
  /** Where ShieldBattery's own browser keeps its cache. */
  shieldBatteryCacheFolder: string
  /** StarCraft's replay folder in Documents, where it saves the replay of every game. */
  replayFolder: string
  onChange: (game: LiveGame | undefined) => void
  /** Remembers the ranks in the profiles the watchers read, for players' pages. */
  ranks?: Pick<PlayerRanksStore, 'ladderProfile' | 'shieldBatteryProfile'>
  /** For tests: what reads the files, instead of the real ones. */
  createCacheWatcher?: () => ScrCacheWatcher
  createShieldBatteryWatcher?: () => ShieldBatteryLogWatcher
  createShieldBatteryCacheWatcher?: () => ShieldBatteryCacheWatcher
  createReplaySavedWatcher?: () => ReplaySavedWatcher
  now?: () => number
}

/** How often a game is checked for being too old to still be going. */
const EXPIRE_CHECK_MS = 60_000

/**
 * Shows who's in a game the user joins: ladder matches on Battle.net from what StarCraft leaves in
 * its browser cache, and ShieldBattery games from its logs, with the profiles the user opens in it
 * from its browser cache. Runs while the `liveGame` setting is on, and lets go of everything when
 * it's turned off.
 */
export class LiveGameService {
  private readonly tracker: LiveGameTracker
  private cacheWatcher: ScrCacheWatcher | undefined
  private shieldBatteryWatcher: ShieldBatteryLogWatcher | undefined
  private shieldBatteryCacheWatcher: ShieldBatteryCacheWatcher | undefined
  private replaySavedWatcher: ReplaySavedWatcher | undefined
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
        case 'matchPage':
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
    cacheWatcher.on('body', (sighting, profile) => {
      if (sighting.kind === 'ladderProfile') {
        this.tracker.profileRead(sighting.name, sighting.gatewayId, profile)
        this.options.ranks?.ladderProfile(sighting.name, sighting.gatewayId, profile, sighting.atMs)
      }
    })
    cacheWatcher.on('error', err => {
      log.warning(`Couldn't read StarCraft's browser cache: ${getErrorStack(err)}`)
    })
    cacheWatcher.start()
    this.cacheWatcher = cacheWatcher

    const shieldBatteryWatcher =
      this.options.createShieldBatteryWatcher?.() ??
      new ShieldBatteryLogWatcher(watchedFolderFiles(this.options.shieldBatteryLogFolder))
    shieldBatteryWatcher.on('matchFound', match => this.tracker.shieldBatteryMatchFound(match))
    shieldBatteryWatcher.on('matchChanged', match => this.tracker.shieldBatteryMatchChanged(match))
    shieldBatteryWatcher.on('matchCanceled', () => this.tracker.shieldBatteryMatchCanceled())
    shieldBatteryWatcher.on('players', (players, map) =>
      this.tracker.shieldBatteryGame(players, map),
    )
    shieldBatteryWatcher.on('ended', () => this.tracker.gameEnded(this.now()))
    shieldBatteryWatcher.on('error', err => {
      log.warning(`Couldn't read ShieldBattery's logs: ${getErrorStack(err)}`)
    })
    shieldBatteryWatcher.start()
    this.shieldBatteryWatcher = shieldBatteryWatcher

    const shieldBatteryCacheWatcher =
      this.options.createShieldBatteryCacheWatcher?.() ??
      new ShieldBatteryCacheWatcher(folderFiles(this.options.shieldBatteryCacheFolder))
    shieldBatteryCacheWatcher.on('body', (sighting, profile) => {
      this.tracker.shieldBatteryProfile(profile, sighting.atMs)
      this.options.ranks?.shieldBatteryProfile(profile, sighting.atMs)
    })
    shieldBatteryCacheWatcher.on('pastBody', (sighting, profile) => {
      this.options.ranks?.shieldBatteryProfile(profile, sighting.atMs)
    })
    shieldBatteryCacheWatcher.on('error', err => {
      log.warning(`Couldn't read ShieldBattery's browser cache: ${getErrorStack(err)}`)
    })
    shieldBatteryCacheWatcher.start()
    this.shieldBatteryCacheWatcher = shieldBatteryCacheWatcher

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
    this.shieldBatteryCacheWatcher?.stop()
    this.shieldBatteryCacheWatcher?.removeAllListeners()
    this.shieldBatteryCacheWatcher = undefined
    this.replaySavedWatcher?.stop()
    this.replaySavedWatcher?.removeAllListeners()
    this.replaySavedWatcher = undefined
    clearInterval(this.expireTimer)
    this.expireTimer = undefined
    this.tracker.clear()
  }
}
