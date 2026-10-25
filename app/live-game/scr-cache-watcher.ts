import { EventEmitter } from 'node:events'
import { BLOCK_FILE_HEADER_SIZE, CacheEntry, findCacheEntries } from './chromium-cache'
import {
  LadderProfile,
  parseLadderProfile,
  readCacheKey,
  SCR_CACHE_MARKERS,
  ScrCacheSighting,
} from './scr-cache'

/** Reads parts of the files in the cache's folder. */
export interface CacheFiles {
  /** The file's size, or undefined if it isn't there. */
  size: (file: string) => Promise<number | undefined>
  /**
   * Reads up to `length` bytes at `position` into the start of `into`, returning how many were
   * read, or undefined if the file isn't there.
   */
  read: (
    file: string,
    position: number,
    length: number,
    into: Uint8Array,
  ) => Promise<number | undefined>
}

/** How often the cache's header is compared with the last one. */
export const POLL_MS = 1000
/**
 * How long after the cache changes it's read in full on every poll. Profiles are cached a second or
 * two after the match screen's page, and a reused entry only changes when it was last used, which
 * the header doesn't show.
 */
export const ACTIVE_MS = 15_000
/** A cache file bigger than this isn't read: StarCraft's stays around a few megabytes. */
export const MAX_FILE_SIZE = 64 * 1024 * 1024
/** Profiles are a few kilobytes. */
export const MAX_BODY_SIZE = 256 * 1024
/** How often a cache that isn't there is looked for. */
export const MISSING_POLL_MS = 10_000
/** An entry last used longer ago than this isn't about a game being joined now. */
export const STALE_MS = 60_000
/** How many polls a profile's body gets to show up in before it's given up on. */
const BODY_ATTEMPTS = 10

export type ScrCacheWatcherEvents = {
  sighting: [sighting: ScrCacheSighting]
  /** A profile read for a `ladderProfile` sighting, emitted after it. */
  profile: [name: string, gatewayId: number, profile: LadderProfile]
  error: [err: unknown]
}

interface PendingBody {
  name: string
  gatewayId: number
  attempts: number
}

/**
 * Watches StarCraft's embedded browser cache for pages and lookups made when the user joins a game:
 * the ladder's match screen and the profiles it looks up. Each entry is
 * reported when it's new or used again after the watcher started; what was there already isn't.
 *
 * It only ever reads, and costs next to nothing between games: one small read of a file's header a
 * second. Only when that header changes is the whole file read, for a little while.
 */
export class ScrCacheWatcher extends EventEmitter<ScrCacheWatcherEvents> {
  private timer: ReturnType<typeof setInterval> | undefined
  private polling = false
  private header = Buffer.alloc(BLOCK_FILE_HEADER_SIZE)
  private lastHeader = Buffer.alloc(BLOCK_FILE_HEADER_SIZE)
  private hasLastHeader = false
  private data1: Buffer | undefined
  private data0: Buffer | undefined
  private activeUntil = 0
  /** When each entry this reads was last used, as of the last full read. */
  private lastUsed = new Map<string, number>()
  private baselineTaken = false
  /** Profiles whose bodies weren't readable yet, by their keys. */
  private pendingBodies = new Map<string, PendingBody>()
  /** Changes when stopped, so a poll still reading then lets its results go. */
  private generation = 0
  /** Until when a missing cache isn't looked for again. */
  private missingUntil = 0

  constructor(
    private readonly files: CacheFiles,
    private readonly now: () => number = Date.now,
  ) {
    super()
  }

  start() {
    if (this.timer) {
      return
    }
    const poll = () => {
      // A poll reports its own errors.
      this.poll().catch(() => {})
    }
    this.timer = setInterval(poll, POLL_MS)
    this.timer.unref?.()
    poll()
  }

  stop() {
    this.generation += 1
    clearInterval(this.timer)
    this.timer = undefined
    this.data1 = undefined
    this.data0 = undefined
    this.lastUsed.clear()
    this.pendingBodies.clear()
    this.baselineTaken = false
    this.hasLastHeader = false
    this.activeUntil = 0
    this.missingUntil = 0
  }

  /** Checks the cache once. Exposed for tests; `start` calls it on a timer. */
  async poll() {
    if (this.polling) {
      return
    }
    this.polling = true
    const generation = this.generation
    try {
      await this.check(generation)
    } catch (err) {
      // Nothing listens once stopped, and an `error` nobody listens to would throw.
      if (generation === this.generation && this.listenerCount('error')) {
        this.emit('error', err)
      }
    } finally {
      this.polling = false
    }
  }

  private async check(generation: number) {
    const now = this.now()
    if (now < this.missingUntil) {
      return
    }
    const read = await this.files.read('data_1', 0, BLOCK_FILE_HEADER_SIZE, this.header)
    if (generation !== this.generation) {
      return
    }
    if (read === undefined || read < BLOCK_FILE_HEADER_SIZE) {
      // No cache yet, or one being made: whatever's there once there is one is new. It's looked for
      // less often, since StarCraft may never make one.
      this.hasLastHeader = false
      this.baselineTaken = true
      this.lastUsed.clear()
      this.missingUntil = now + MISSING_POLL_MS
      return
    }
    if (!this.hasLastHeader || !this.header.equals(this.lastHeader)) {
      // The first read only takes what's there to start from: nothing's been seen changing yet.
      if (this.baselineTaken) {
        this.activeUntil = now + ACTIVE_MS
      }
      this.header.copy(this.lastHeader)
      this.hasLastHeader = true
    }
    if (this.baselineTaken && now >= this.activeUntil) {
      // Nothing's changing: let the big buffers go until something does. A profile still not
      // readable by now won't be about the next game.
      this.data1 = undefined
      this.data0 = undefined
      this.pendingBodies.clear()
      return
    }
    await this.readAll(generation)
  }

  private async readFile(file: string, buffer: Buffer | undefined) {
    const size = await this.files.size(file)
    if (size === undefined || size > MAX_FILE_SIZE) {
      return undefined
    }
    const into = buffer && buffer.length >= size ? buffer : Buffer.allocUnsafe(size)
    const length = await this.files.read(file, 0, size, into)
    return length === undefined ? undefined : { buffer: into, length }
  }

  private async readAll(generation: number) {
    const data1 = await this.readFile('data_1', this.data1)
    if (!data1 || generation !== this.generation) {
      return
    }
    this.data1 = data1.buffer
    const data0 = await this.readFile('data_0', this.data0)
    if (generation !== this.generation) {
      return
    }
    this.data0 = data0?.buffer

    const entries = findCacheEntries(
      data1.buffer,
      data1.length,
      data0?.buffer,
      data0?.length ?? 0,
      SCR_CACHE_MARKERS,
    ).sort((a, b) => a.lastUsedMs - b.lastUsedMs)

    const present = new Set<string>()
    for (const entry of entries) {
      present.add(entry.key)
      const before = this.lastUsed.get(entry.key)
      if (before !== undefined && entry.lastUsedMs <= before) {
        continue
      }
      this.lastUsed.set(entry.key, entry.lastUsedMs)
      // An old entry can look new when a read caught it mid write and it was forgotten. A game
      // being joined is only ever seconds old.
      if (!this.baselineTaken || entry.lastUsedMs < this.now() - STALE_MS) {
        continue
      }
      const sighting = readCacheKey(entry.key, entry.createdMs, entry.lastUsedMs)
      if (!sighting) {
        continue
      }
      this.emit('sighting', sighting)
      if (sighting.kind === 'ladderProfile') {
        this.pendingBodies.set(entry.key, {
          name: sighting.name,
          gatewayId: sighting.gatewayId,
          attempts: 0,
        })
      }
    }
    this.baselineTaken = true

    for (const key of this.lastUsed.keys()) {
      if (!present.has(key)) {
        this.lastUsed.delete(key)
      }
    }
    await this.readPendingBodies(entries, generation)
  }

  private async readPendingBodies(entries: ReadonlyArray<CacheEntry>, generation: number) {
    for (const [key, pending] of this.pendingBodies) {
      const entry = entries.find(e => e.key === key)
      pending.attempts += 1
      if (!entry) {
        this.pendingBodies.delete(key)
        continue
      }
      const profile = await this.readProfile(entry, pending.name, pending.gatewayId)
      if (generation !== this.generation) {
        return
      }
      if (profile) {
        this.pendingBodies.delete(key)
        this.emit('profile', pending.name, pending.gatewayId, profile)
      } else if (pending.attempts >= BODY_ATTEMPTS) {
        this.pendingBodies.delete(key)
      }
    }
  }

  private async readProfile(entry: CacheEntry, name: string, gatewayId: number) {
    if (!entry.body || entry.bodySize <= 0 || entry.bodySize > MAX_BODY_SIZE) {
      return undefined
    }
    const body = Buffer.allocUnsafe(entry.bodySize)
    const read = await this.files.read(entry.body.file, entry.body.offset, entry.bodySize, body)
    return read === entry.bodySize ? parseLadderProfile(body, name, gatewayId) : undefined
  }
}
