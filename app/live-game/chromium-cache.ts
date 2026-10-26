/**
 * Finds entries in a Chromium disk cache kept in its block file format, like the one StarCraft's
 * embedded browser keeps in `%TEMP%\blizzard_browser_cache`. Only what finding a few entries by
 * their keys takes: no index, no eviction lists, and nothing is ever written.
 *
 * Keys are in `data_1`, one 256 byte entry each after the file's 8 KB header. An entry points to its
 * rankings node in `data_0`, which says when it was last used, and to its data streams: the response
 * headers, then the body, either in another block file or in a file of its own.
 */

export const BLOCK_FILE_HEADER_SIZE = 8192
const ENTRY_SIZE = 256
const RANKINGS_NODE_SIZE = 36
const KEY_OFFSET = 96
/** An entry can take up to 4 blocks in a row, its key running on into the blocks after the first. */
const MAX_ENTRY_BLOCKS = 4
/** Longer keys are kept elsewhere, which this doesn't read. */
const MAX_INLINE_KEY = MAX_ENTRY_BLOCKS * ENTRY_SIZE - KEY_OFFSET - 1
const HTTP = Buffer.from('http', 'latin1')
/**
 * Newer Chromiums put a little before a key's URL, like `1/0/` for a request sent with credentials.
 * A key's `http` can start this many bytes in.
 */
const MAX_KEY_PREFIX = 8
/** Chromium keeps times as microseconds since 1601. */
const WINDOWS_EPOCH_US = 11644473600000000n
/** An entry that's neither evicted nor doomed. */
const ENTRY_NORMAL = 0
const ADDRESS_INITIALIZED = 0x80000000
const EXTERNAL_FILE = 0
const RANKINGS_FILE = 1
/** Entries are in data_1, a file of 256 byte blocks. */
const ENTRY_BLOCK_TYPE = 2
/** Block sizes by address type: 256 bytes, 1 KB and 4 KB block files. */
const BLOCK_SIZES: Readonly<Record<number, number>> = { 2: 256, 3: 1024, 4: 4096 }

/** Where some of an entry's data is: a file in the cache's folder, and where in it. */
export interface CacheLocation {
  file: string
  offset: number
}

export interface CacheEntry {
  key: string
  createdMs: number
  /** When the entry was last used, or when it was created if that can't be read. */
  lastUsedMs: number
  bodySize: number
  body?: CacheLocation
}

/** Turns a Chromium time into milliseconds since the Unix epoch, or 0 for an unset one. */
export function chromiumTimeToMs(value: bigint) {
  return value > WINDOWS_EPOCH_US ? Number((value - WINDOWS_EPOCH_US) / 1000n) : 0
}

/** Where a cache address points, or undefined for an unset or unknown one. */
export function decodeCacheAddress(address: number): CacheLocation | undefined {
  if (!(address & ADDRESS_INITIALIZED)) {
    return undefined
  }
  const type = (address >>> 28) & 0x7
  if (type === EXTERNAL_FILE) {
    return { file: `f_${(address & 0x0fffffff).toString(16).padStart(6, '0')}`, offset: 0 }
  }
  const blockSize = BLOCK_SIZES[type]
  if (!blockSize) {
    return undefined
  }
  return {
    file: `data_${(address >>> 16) & 0xff}`,
    offset: BLOCK_FILE_HEADER_SIZE + (address & 0xffff) * blockSize,
  }
}

/**
 * When the rankings node at `address` in `data0` says the entry at `entryStart` in data_1 was last
 * used, or 0. The node has to point back at the entry: a node reused for another entry after
 * data_1 was read would say when that one was used.
 */
function readLastUsed(
  address: number,
  entryStart: number,
  data0: Buffer | undefined,
  data0Length: number,
) {
  const type = (address >>> 28) & 0x7
  // Rankings nodes live in data_0. A node in any other file isn't one this reads.
  if (
    !data0 ||
    !(address & ADDRESS_INITIALIZED) ||
    type !== RANKINGS_FILE ||
    ((address >>> 16) & 0xff) !== 0
  ) {
    return 0
  }
  const offset = BLOCK_FILE_HEADER_SIZE + (address & 0xffff) * RANKINGS_NODE_SIZE
  if (offset + RANKINGS_NODE_SIZE > data0Length) {
    return 0
  }
  const contents = data0.readUInt32LE(offset + 24)
  if (
    ((contents >>> 28) & 0x7) !== ENTRY_BLOCK_TYPE ||
    ((contents >>> 16) & 0xff) !== 1 ||
    (contents & 0xffff) !== (entryStart - BLOCK_FILE_HEADER_SIZE) / ENTRY_SIZE
  ) {
    return 0
  }
  return chromiumTimeToMs(data0.readBigUInt64LE(offset))
}

/**
 * The entry starting at `start`, if one does: a normal entry whose key is `http` something, maybe
 * after a short prefix, kept in the entry itself.
 */
function readEntry(
  data1: Buffer,
  length: number,
  start: number,
  data0: Buffer | undefined,
  data0Length: number,
): CacheEntry | undefined {
  if (start + ENTRY_SIZE > length || data1.readInt32LE(start + 20) !== ENTRY_NORMAL) {
    return undefined
  }
  const keyLength = data1.readInt32LE(start + 32)
  const longKey = data1.readUInt32LE(start + 36)
  const keyStart = start + KEY_OFFSET
  if (
    longKey !== 0 ||
    keyLength < HTTP.length ||
    keyLength > MAX_INLINE_KEY ||
    keyStart + keyLength > length
  ) {
    return undefined
  }
  const httpAt = data1.indexOf(HTTP, keyStart)
  if (httpAt === -1 || httpAt - keyStart > Math.min(MAX_KEY_PREFIX, keyLength - HTTP.length)) {
    return undefined
  }
  const createdMs = chromiumTimeToMs(data1.readBigUInt64LE(start + 24))
  if (!createdMs) {
    return undefined
  }
  const lastUsedMs = readLastUsed(data1.readUInt32LE(start + 8), start, data0, data0Length)
  return {
    key: data1.toString('latin1', keyStart, keyStart + keyLength),
    createdMs,
    lastUsedMs: Math.max(lastUsedMs, createdMs),
    bodySize: Math.max(0, data1.readInt32LE(start + 44)),
    body: decodeCacheAddress(data1.readUInt32LE(start + 60)),
  }
}

/**
 * The entry whose key holds the bytes at `at` to `end`. A long key runs on into the blocks after
 * its entry's first, so the entry can start up to three blocks before the one `at` is in.
 */
function findEntryAround(
  file: Buffer,
  length: number,
  at: number,
  end: number,
  data0: Buffer | undefined,
  data0Length: number,
) {
  const block =
    BLOCK_FILE_HEADER_SIZE + Math.floor((at - BLOCK_FILE_HEADER_SIZE) / ENTRY_SIZE) * ENTRY_SIZE
  for (let back = 0; back < MAX_ENTRY_BLOCKS; back++) {
    const start = block - back * ENTRY_SIZE
    if (start < BLOCK_FILE_HEADER_SIZE) {
      break
    }
    if (at < start + KEY_OFFSET) {
      continue
    }
    const entry = readEntry(file, length, start, data0, data0Length)
    if (entry && end <= start + KEY_OFFSET + entry.key.length) {
      return { start, entry }
    }
  }
  return undefined
}

/**
 * The entries in the first `length` bytes of `data1` whose keys contain one of `markers`, each once.
 * Searching for the markers' bytes, rather than reading every entry, keeps this to a few native
 * scans of the file and a string for each match only. `data0` is the rankings file, for when each
 * entry was last used.
 */
export function findCacheEntries(
  data1: Buffer,
  length: number,
  data0: Buffer | undefined,
  data0Length: number,
  markers: ReadonlyArray<Uint8Array>,
): CacheEntry[] {
  // The buffer is reused between reads, so only its first `length` bytes are this file.
  const file = data1.subarray(0, length)
  const found = new Map<number, CacheEntry>()
  for (const marker of markers) {
    let at = file.indexOf(marker, BLOCK_FILE_HEADER_SIZE)
    while (at !== -1) {
      const match = findEntryAround(file, length, at, at + marker.length, data0, data0Length)
      if (match) {
        found.set(match.start, match.entry)
      }
      // Past the rest of this entry's key, or this match.
      at = file.indexOf(
        marker,
        match ? match.start + KEY_OFFSET + match.entry.key.length : at + marker.length,
      )
    }
  }
  return Array.from(found.values())
}
