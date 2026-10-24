import { BLOCK_FILE_HEADER_SIZE } from './chromium-cache'

const WINDOWS_EPOCH_US = 11644473600000000n

/** A Chromium time for `ms` since the Unix epoch. */
export function toChromiumTime(ms: number) {
  return BigInt(ms) * 1000n + WINDOWS_EPOCH_US
}

export interface TestCacheEntry {
  key: string
  createdMs: number
  /** Missing leaves the entry without a rankings node. */
  lastUsedMs?: number
  /** The response body, put in its own `f_` file. */
  body?: string
  /** An evicted or doomed entry. */
  state?: number
}

/**
 * Builds the cache files Chromium would have for `entries`: `data_1` with the entries, `data_0`
 * with their rankings nodes, and an `f_` file per body, all in `files` by name. Headers are zeros
 * but for a counter, so a changed set of entries changes the header, as it does in a real cache.
 */
export function buildTestCache(entries: ReadonlyArray<TestCacheEntry>) {
  // A long key runs on into the blocks after its entry's first, as in Chromium.
  const blocks = entries.map(e => Math.ceil((96 + e.key.length + 1) / 256))
  const data1 = Buffer.alloc(BLOCK_FILE_HEADER_SIZE + blocks.reduce((a, b) => a + b, 0) * 256)
  const data0 = Buffer.alloc(BLOCK_FILE_HEADER_SIZE + entries.length * 36)
  data1.writeUInt32LE(entries.length, 16)
  const files: Record<string, Buffer> = { [`data_${1}`]: data1, [`data_${0}`]: data0 }
  let start = BLOCK_FILE_HEADER_SIZE
  entries.forEach((entry, i) => {
    if (entry.lastUsedMs !== undefined) {
      // A rankings node in data_0, block i.
      data1.writeUInt32LE((0x80000000 | (1 << 28) | i) >>> 0, start + 8)
      data0.writeBigUInt64LE(toChromiumTime(entry.lastUsedMs), BLOCK_FILE_HEADER_SIZE + i * 36)
      // The node points back at its entry, a block in data_1.
      const block = (start - BLOCK_FILE_HEADER_SIZE) / 256
      data0.writeUInt32LE(
        (0x80000000 | (2 << 28) | (1 << 16) | block) >>> 0,
        BLOCK_FILE_HEADER_SIZE + i * 36 + 24,
      )
    }
    data1.writeInt32LE(entry.state ?? 0, start + 20)
    data1.writeBigUInt64LE(toChromiumTime(entry.createdMs), start + 24)
    data1.writeInt32LE(entry.key.length, start + 32)
    if (entry.body !== undefined) {
      const body = Buffer.from(entry.body, 'utf8')
      const fileNumber = i + 1
      files[`f_${fileNumber.toString(16).padStart(6, '0')}`] = body
      data1.writeInt32LE(body.length, start + 44)
      data1.writeUInt32LE((0x80000000 | fileNumber) >>> 0, start + 60)
    }
    data1.write(entry.key, start + 96, 'latin1')
    start += blocks[i] * 256
  })
  return { data1, data0, files }
}

/**
 * Turns a fixture's camelCase keys into the snake_case StarCraft's server sends. Other keys, like
 * player names and gateway ids, stay as they are.
 */
export function toServerJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toServerJson)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        /^[a-z]+(?:[A-Z][a-z]*)+$/.test(key)
          ? key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)
          : key,
        toServerJson(v),
      ]),
    )
  }
  return value
}
