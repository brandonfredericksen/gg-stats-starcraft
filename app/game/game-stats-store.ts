import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getErrorStack } from '../../common/errors'
import { COMMAND_STATS_VERSION, ReplayCommandStats } from '../../common/games/command-stats'
import {
  fromGameStatsPayload,
  GameStatsPayload,
  GameStatsSource,
  GameStatsSummary,
  ReplayFileInfo,
  SAVED_GAME_STATS_VERSION,
  SavedGameStats,
  summarizeGameStats,
} from '../../common/games/game-stats'
import {
  computeGameMetrics,
  GAME_METRICS_VERSION,
  GameMetrics,
} from '../../common/games/player-metrics'
import log from '../logger'

/**
 * How many games' stats are kept. Each is tens of kilobytes, so this is a few hundred megabytes at
 * most, and the more there are, the more My stats has to compare the user with.
 */
const MAX_SAVED_GAMES = 5000

/** The version of what an index entry holds, apart from the saved stats and metrics it's built from. */
const INDEX_ENTRY_VERSION = 3
/**
 * The version of the index cache. Changes with what an index entry holds, so a cache from an older
 * version is built again from the saved files instead of being misread.
 */
const INDEX_CACHE_VERSION = `${SAVED_GAME_STATS_VERSION}.${GAME_METRICS_VERSION}.${INDEX_ENTRY_VERSION}`
/** How long to wait after a change before writing the index cache, so a burst of saves writes once. */
const INDEX_CACHE_WRITE_DELAY_MS = 2000
/** Kept with the saved stats, under a name that isn't read as a game's stats. */
const INDEX_CACHE_FILE_NAME = 'index.cache'

/** Game ids are nanoids or UUIDs, so anything else isn't safe to use as a file name. */
const GAME_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

const SAVED_EXTENSION = '.json'
const TEMP_EXTENSION = '.tmp'
/** Temporary files older than this were left behind by a write that never finished. */
const ABANDONED_TEMP_FILE_MS = 60 * 60 * 1000

interface IndexEntry {
  savedAt: number
  /** Identifies the replay file the stats came from, see {@link getReplayKey}. */
  replayKey?: string
  /** The replay's path as it was saved, lowercased, which is quicker to match than `replayKey`. */
  replayPathKey?: string
  /** The replay's path as it was saved. */
  replayPath?: string
  /** Whether what the replay's commands say has been read and saved with the stats. */
  hasCommands: boolean
  linkedGameId?: string
  /**
   * Whether the stats came from playing the game, rather than analyzing its replay. Played stats
   * stop when the game ended for the player, while its replay may cover more.
   */
  played: boolean
  complete: boolean
  /** The replay file as it was when the stats were saved. */
  replayFile?: ReplayFileInfo
  /** The saved stats file this entry was read from, which tells whether a cached entry is current. */
  savedFile: ReplayFileInfo
  summary: GameStatsSummary
  metrics: GameMetrics
}

/** The index as it's kept on disk, so it doesn't have to be built from every saved file each start. */
interface IndexCache {
  version: string
  entries: Record<string, IndexEntry>
}

/** One game's numbers for My stats, from the best stats saved for its replay. */
export interface MetricsListing {
  /** The replay's path as it was saved, lowercased, if the stats have a replay. */
  replayPathKey?: string
  savedAt: number
  metrics: GameMetrics
}

function replayPathOf(source: GameStatsSource) {
  return source.kind === 'replay' ? source.path : source.replayPath
}

/**
 * Identifies a replay file however its path was written. The game reports a played game's replay
 * by one path and the replay library can know the same file by another (through a junction or a
 * redirected Documents folder, in a different case), so this goes by where the file really is.
 */
async function getReplayKey(replayPath: string) {
  let resolved: string
  try {
    resolved = await realpath(replayPath)
  } catch {
    resolved = path.resolve(replayPath)
  }
  return resolved.toLowerCase()
}

/** Identifies the version of a replay file, so a different file saved at the same path isn't mistaken for it. */
async function getReplayFileInfo(replayPath: string): Promise<ReplayFileInfo | undefined> {
  try {
    const { size, mtimeMs } = await stat(replayPath)
    return { size, modifiedMs: Math.floor(mtimeMs) }
  } catch {
    return undefined
  }
}

function isSavedGameStats(value: unknown, gameId: string): value is SavedGameStats {
  const saved = value as Partial<SavedGameStats> | null
  return (
    saved?.version === SAVED_GAME_STATS_VERSION &&
    saved.gameId === gameId &&
    typeof saved.savedAt === 'number' &&
    (saved.source?.kind === 'replay' || saved.source?.kind === 'game') &&
    typeof saved.stats === 'object' &&
    saved.stats !== null
  )
}

/**
 * Moves what older versions saved under a since renamed field to where it's read now. Stats saved
 * before the rename keep their link to the game they belong with.
 */
function upgradeSavedGameStats(saved: SavedGameStats): SavedGameStats {
  const { source } = saved
  if (source.kind !== 'replay' || !('sbGameId' in source)) {
    return saved
  }
  const { sbGameId, ...rest } = source as typeof source & { sbGameId?: string }
  return {
    ...saved,
    source: { ...rest, linkedGameId: rest.linkedGameId ?? sbGameId },
  }
}

function isMissingFileError(err: unknown) {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

async function getFileInfo(filePath: string): Promise<ReplayFileInfo> {
  const { size, mtimeMs } = await stat(filePath)
  return { size, modifiedMs: Math.floor(mtimeMs) }
}

async function toIndexEntry(saved: SavedGameStats, savedFile: ReplayFileInfo): Promise<IndexEntry> {
  const replayPath = replayPathOf(saved.source)
  const stats = fromGameStatsPayload(saved.stats)
  return {
    savedAt: saved.savedAt,
    replayKey: replayPath ? await getReplayKey(replayPath) : undefined,
    replayPathKey: replayPath ? path.resolve(replayPath).toLowerCase() : undefined,
    replayPath,
    linkedGameId: saved.source.kind === 'replay' ? saved.source.linkedGameId : undefined,
    played: saved.source.kind === 'game',
    hasCommands: saved.commands?.version === COMMAND_STATS_VERSION,
    complete: saved.stats.complete !== false,
    replayFile: saved.replayFile,
    savedFile,
    summary: summarizeGameStats(saved.gameId, stats),
    metrics: computeGameMetrics(
      saved.gameId,
      stats,
      saved.commands?.version === COMMAND_STATS_VERSION ? saved.commands : undefined,
    ),
  }
}

/**
 * Saves the stats of played games and analyzed replays as one JSON file per game, so they can be
 * looked at again after the app restarts. Writes go through a temporary file so an interrupted
 * write can't leave a broken file behind, and a file that can't be read is treated as missing.
 */
export class GameStatsStore {
  /** Every saved game, built from the saved files the first time it's needed. */
  private index: Promise<Map<string, IndexEntry>> | undefined
  /**
   * Writes run one at a time so a read-modify-write can't interleave with another write, and reads
   * wait for the writes before them so they see what was just saved.
   */
  private writes: Promise<unknown> = Promise.resolve()
  private cacheWriteTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    readonly basePath: string,
    private readonly maxSavedGames = MAX_SAVED_GAMES,
    private readonly cachePath = path.join(basePath, INDEX_CACHE_FILE_NAME),
  ) {}

  private getPath(gameId: string) {
    if (!GAME_ID_PATTERN.test(gameId)) {
      throw new Error(`Invalid game id: ${gameId}`)
    }
    return path.join(this.basePath, gameId + SAVED_EXTENSION)
  }

  private enqueue<T>(write: () => Promise<T>): Promise<T> {
    const result = this.writes.then(write)
    this.writes = result.catch(() => {})
    return result
  }

  private async readSaved(gameId: string): Promise<SavedGameStats | undefined> {
    const saved = await this.readSavedFile(gameId)
    return typeof saved === 'object' ? saved : undefined
  }

  /**
   * Reads a game's saved stats, or says why they couldn't be: there are none, they can't be used
   * because they're corrupt or were saved by an older version, or they were saved by a newer version
   * of the app than this one, which a user going back to it can still read.
   */
  private async readSavedFile(
    gameId: string,
  ): Promise<SavedGameStats | 'missing' | 'unusable' | 'newer'> {
    let contents: string
    try {
      contents = await readFile(this.getPath(gameId), 'utf8')
    } catch (err) {
      if (!isMissingFileError(err)) {
        log.warning(`Couldn't read the saved stats for game ${gameId}: ${getErrorStack(err)}`)
      }
      return 'missing'
    }
    try {
      const saved: unknown = JSON.parse(contents)
      if (isSavedGameStats(saved, gameId)) {
        return upgradeSavedGameStats(saved)
      }
      const { version } = saved as Partial<SavedGameStats>
      if (typeof version === 'number' && version > SAVED_GAME_STATS_VERSION) {
        log.warning(`The saved stats for game ${gameId} are from a newer version`)
        return 'newer'
      }
      log.warning(`The saved stats for game ${gameId} are from an older version`)
    } catch (err) {
      log.warning(`The saved stats for game ${gameId} are corrupt: ${getErrorStack(err)}`)
    }
    return 'unusable'
  }

  /** Writes a game's stats and returns the file as written. */
  private async writeSaved(saved: SavedGameStats): Promise<ReplayFileInfo> {
    const filePath = this.getPath(saved.gameId)
    await mkdir(this.basePath, { recursive: true })
    await writeAtomically(filePath, JSON.stringify(saved))
    return await getFileInfo(filePath)
  }

  private async readCache(): Promise<Record<string, IndexEntry>> {
    try {
      const cache = JSON.parse(await readFile(this.cachePath, 'utf8')) as Partial<IndexCache>
      if (cache.version === INDEX_CACHE_VERSION && cache.entries) {
        return cache.entries
      }
    } catch (err) {
      if (!isMissingFileError(err)) {
        log.warning(`Couldn't read the saved stats index: ${getErrorStack(err)}`)
      }
    }
    return {}
  }

  /** Writes the index cache a little later, once a burst of changes is over. */
  private scheduleCacheWrite() {
    clearTimeout(this.cacheWriteTimer)
    this.cacheWriteTimer = setTimeout(() => {
      this.cacheWriteTimer = undefined
      this.enqueue(async () => {
        const cache: IndexCache = {
          version: INDEX_CACHE_VERSION,
          entries: Object.fromEntries(await this.getIndex()),
        }
        await writeAtomically(this.cachePath, JSON.stringify(cache))
      }).catch((err: unknown) => {
        log.warning(`Couldn't write the saved stats index: ${getErrorStack(err)}`)
      })
    }, INDEX_CACHE_WRITE_DELAY_MS)
    // A pending write is only an optimization, so it shouldn't keep the process running.
    this.cacheWriteTimer.unref?.()
  }

  private getIndex() {
    if (!this.index) {
      const index = this.buildIndex()
      this.index = index
      // A failed build is retried next time rather than remembered.
      index.catch(() => {
        if (this.index === index) {
          this.index = undefined
        }
      })
    }
    return this.index
  }

  private async buildIndex() {
    let fileNames: string[]
    try {
      fileNames = await readdir(this.basePath)
    } catch (err) {
      if (isMissingFileError(err)) {
        return new Map<string, IndexEntry>()
      }
      throw err
    }

    await Promise.all(
      fileNames
        .filter(fileName => fileName.endsWith(TEMP_EXTENSION))
        .map(fileName => this.removeIfAbandoned(path.join(this.basePath, fileName))),
    )

    const gameIds = fileNames
      .filter(fileName => fileName.endsWith(SAVED_EXTENSION))
      .map(fileName => fileName.slice(0, -SAVED_EXTENSION.length))
      .filter(gameId => GAME_ID_PATTERN.test(gameId))
    const cached = await this.readCache()
    let changed = Object.keys(cached).length !== gameIds.length
    const entries = await Promise.all(
      gameIds.map(async gameId => {
        let savedFile: ReplayFileInfo
        try {
          savedFile = await getFileInfo(this.getPath(gameId))
        } catch {
          return undefined
        }
        const cachedEntry = Object.hasOwn(cached, gameId) ? cached[gameId] : undefined
        if (
          cachedEntry?.savedFile?.size === savedFile.size &&
          cachedEntry.savedFile.modifiedMs === savedFile.modifiedMs
        ) {
          return [gameId, cachedEntry] as const
        }
        changed = true
        const saved = await this.readSavedFile(gameId)
        if (saved === 'unusable') {
          // Nothing can read these, so they'd only take up space and be read again every time.
          await rm(this.getPath(gameId), { force: true }).catch((err: unknown) => {
            log.warning(`Couldn't remove the stats for game ${gameId}: ${getErrorStack(err)}`)
          })
        }
        return typeof saved === 'object'
          ? ([gameId, await toIndexEntry(saved, savedFile)] as const)
          : undefined
      }),
    )
    if (changed) {
      this.scheduleCacheWrite()
    }
    return new Map(entries.filter(entry => entry !== undefined))
  }

  private async removeIfAbandoned(tempPath: string) {
    try {
      const { mtimeMs } = await stat(tempPath)
      if (Date.now() - mtimeMs > ABANDONED_TEMP_FILE_MS) {
        await rm(tempPath, { force: true })
      }
    } catch (err) {
      log.warning(`Couldn't clean up ${tempPath}: ${getErrorStack(err)}`)
    }
  }

  /**
   * Removes the oldest saved games once there are more than the store keeps. This is best effort:
   * a file that can't be removed is left for the next time.
   */
  private async prune(index: Map<string, IndexEntry>) {
    if (index.size <= this.maxSavedGames) {
      return
    }
    const oldest = Array.from(index)
      .sort(([, a], [, b]) => a.savedAt - b.savedAt)
      .slice(0, index.size - this.maxSavedGames)
    for (const [gameId] of oldest) {
      try {
        await rm(this.getPath(gameId), { force: true })
        index.delete(gameId)
      } catch (err) {
        log.warning(`Couldn't remove the saved stats for game ${gameId}: ${getErrorStack(err)}`)
      }
    }
  }

  save(gameId: string, source: GameStatsSource, stats: GameStatsPayload): Promise<SavedGameStats> {
    return this.enqueue(async () => {
      const replayPath = replayPathOf(source)
      const saved: SavedGameStats = {
        version: SAVED_GAME_STATS_VERSION,
        gameId,
        savedAt: Date.now(),
        source,
        replayFile: replayPath ? await getReplayFileInfo(replayPath) : undefined,
        stats,
      }
      const savedFile = await this.writeSaved(saved)
      const index = await this.getIndex()
      index.set(gameId, await toIndexEntry(saved, savedFile))
      await this.prune(index)
      this.scheduleCacheWrite()
      return saved
    })
  }

  /**
   * Games whose replay's commands haven't been read yet, newest first, with the replay they need.
   * Replays that are gone or have changed since the stats were saved are left out.
   */
  async listMissingCommandStats(): Promise<Array<{ gameId: string; replayPath: string }>> {
    await this.writes
    const missing = Array.from(await this.getIndex())
      .filter(([, entry]) => !entry.hasCommands && entry.replayPath)
      .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    const result: Array<{ gameId: string; replayPath: string }> = []
    for (const [gameId, entry] of missing) {
      const current = await getReplayFileInfo(entry.replayPath!)
      if (
        current &&
        entry.replayFile?.size === current.size &&
        entry.replayFile.modifiedMs === current.modifiedMs
      ) {
        result.push({ gameId, replayPath: entry.replayPath! })
      }
    }
    return result
  }

  /** Saves what a game's replay's commands say along with its stats. */
  saveCommandStats(gameId: string, commands: ReplayCommandStats): Promise<void> {
    return this.enqueue(async () => {
      const saved = await this.readSaved(gameId)
      if (!saved) {
        return
      }
      const updated: SavedGameStats = { ...saved, commands }
      const savedFile = await this.writeSaved(updated)
      const index = await this.getIndex()
      if (index.has(gameId)) {
        index.set(gameId, await toIndexEntry(updated, savedFile))
        this.scheduleCacheWrite()
      }
    })
  }

  /** Records where a played game's replay was saved, once it has been. */
  setReplayPath(gameId: string, replayPath: string): Promise<void> {
    return this.enqueue(async () => {
      const saved = await this.readSaved(gameId)
      if (saved?.source.kind !== 'game') {
        return
      }
      const updated: SavedGameStats = {
        ...saved,
        source: { ...saved.source, replayPath },
        replayFile: await getReplayFileInfo(replayPath),
      }
      const savedFile = await this.writeSaved(updated)
      const index = await this.getIndex()
      if (index.has(gameId)) {
        index.set(gameId, await toIndexEntry(updated, savedFile))
        this.scheduleCacheWrite()
      }
    })
  }

  /**
   * Returns the stats saved for a game: a game played or replay analyzed under this id, or the
   * latest analysis of a replay linked to the game with this id. Stats covering the whole
   * game are preferred, like an analysis of a game the player left early.
   */
  async get(gameId: string): Promise<SavedGameStats | undefined> {
    if (!GAME_ID_PATTERN.test(gameId)) {
      return undefined
    }
    await this.writes
    const saved = await this.readSaved(gameId)
    if (saved && saved.stats.complete !== false) {
      return saved
    }
    const analyses = Array.from(await this.getIndex())
      .filter(([, entry]) => entry.linkedGameId === gameId)
      // Complete ones first, then the newest.
      .sort(([, a], [, b]) => Number(b.complete) - Number(a.complete) || b.savedAt - a.savedAt)
    for (const [analysisId] of analyses) {
      const analysis = await this.readSaved(analysisId)
      if (analysis && (!saved || analysis.stats.complete !== false)) {
        return analysis
      }
    }
    return saved
  }

  /**
   * The numbers My stats works from, for every game with saved stats. A replay analyzed more than
   * once, or played and then analyzed, is listed once: stats covering the whole game first, then
   * the newest.
   */
  async listMetrics(): Promise<MetricsListing[]> {
    await this.writes
    const best = new Map<string, IndexEntry>()
    for (const [gameId, entry] of await this.getIndex()) {
      const key = entry.replayKey ?? `game:${gameId}`
      const current = best.get(key)
      if (
        !current ||
        (entry.complete && !current.complete) ||
        (entry.complete === current.complete && entry.savedAt > current.savedAt)
      ) {
        best.set(key, entry)
      }
    }
    return Array.from(best.values(), entry => ({
      replayPathKey: entry.replayPathKey,
      savedAt: entry.savedAt,
      metrics: entry.metrics,
    }))
  }

  /** The lowercased paths of every replay with saved stats, as they were saved. */
  async listAnalyzedReplayPaths(): Promise<string[]> {
    await this.writes
    const paths = new Set<string>()
    for (const entry of (await this.getIndex()).values()) {
      if (entry.replayPathKey && (entry.complete || !entry.played)) {
        paths.add(entry.replayPathKey)
      }
    }
    return Array.from(paths)
  }

  /**
   * Returns a summary of the most recently saved stats for each of `replayPaths` that has some,
   * keyed by path. Like {@link findByReplayPath}, stats saved for an older version of a file are
   * left out. Paths aren't resolved through links, so this stays quick for a whole replay library.
   */
  async summarizeReplays(
    replayPaths: ReadonlyArray<string>,
  ): Promise<Record<string, GameStatsSummary>> {
    await this.writes
    const latestByKey = new Map<string, IndexEntry>()
    for (const entry of (await this.getIndex()).values()) {
      if (!entry.complete && entry.played) {
        continue
      }
      for (const key of new Set([entry.replayKey, entry.replayPathKey])) {
        const latest = key ? latestByKey.get(key) : undefined
        if (key && (!latest || latest.savedAt < entry.savedAt)) {
          latestByKey.set(key, entry)
        }
      }
    }

    const result: Record<string, GameStatsSummary> = {}
    await Promise.all(
      replayPaths.map(async replayPath => {
        const entry = latestByKey.get(path.resolve(replayPath).toLowerCase())
        if (!entry) {
          return
        }
        const current = await getReplayFileInfo(replayPath)
        if (
          current &&
          entry.replayFile?.size === current.size &&
          entry.replayFile.modifiedMs === current.modifiedMs
        ) {
          result[replayPath] = entry.summary
        }
      }),
    )
    return result
  }

  /**
   * Returns the most recently saved stats for a replay file, if any were saved for the file as it
   * is now. Stats from playing a game that stop before it ended are left out, since analyzing its
   * replay may cover more.
   */
  async findByReplayPath(replayPath: string): Promise<SavedGameStats | undefined> {
    await this.writes
    const key = await getReplayKey(replayPath)
    const matches = Array.from(await this.getIndex())
      .filter(([, entry]) => (entry.complete || !entry.played) && entry.replayKey === key)
      .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    if (!matches.length) {
      return undefined
    }
    const current = await getReplayFileInfo(replayPath)
    if (!current) {
      return undefined
    }
    for (const [gameId] of matches) {
      const saved = await this.readSaved(gameId)
      if (
        saved?.replayFile?.size === current.size &&
        saved.replayFile.modifiedMs === current.modifiedMs
      ) {
        return saved
      }
    }
    return undefined
  }
}

/** Writes through a temporary file so an interrupted write can't leave a broken file behind. */
async function writeAtomically(filePath: string, contents: string) {
  // Unique so two writes of the same file, even from two copies of the app, can't collide.
  const tempPath = `${filePath}.${process.pid}-${Date.now()}${TEMP_EXTENSION}`
  try {
    await writeFile(tempPath, contents, 'utf8')
    await rename(tempPath, filePath)
  } catch (err) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw err
  }
}
