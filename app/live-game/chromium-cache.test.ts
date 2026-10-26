import { describe, expect, test } from 'vitest'
import { chromiumTimeToMs, decodeCacheAddress, findCacheEntries } from './chromium-cache'
import { buildTestCache, toChromiumTime } from './chromium-cache-test-files'

const LOBBY_KEY =
  'http://127.0.0.1:50072/gamedata/webui/dist/GameLobbyPanel/GameLobbyPanel.html?locale=enUS&port=50072&guid=12382'
const IMAGE_KEY = 'http://127.0.0.1:50072/gamedata/webui/dist/lib/images/rank_U.png'
const MARKERS = [Buffer.from('GameLobbyPanel.html?')]

describe('chromiumTimeToMs', () => {
  test('converts microseconds since 1601 to Unix milliseconds', () => {
    expect(chromiumTimeToMs(toChromiumTime(1_761_336_930_000))).toBe(1_761_336_930_000)
  })

  test('is 0 for an unset time', () => {
    expect(chromiumTimeToMs(0n)).toBe(0)
  })
})

describe('decodeCacheAddress', () => {
  test('reads block file addresses', () => {
    // Seen on a profile's headers and body in StarCraft's cache.
    expect(decodeCacheAddress(0xa0010c51)).toEqual({ file: 'data_1', offset: 8192 + 0x0c51 * 256 })
    expect(decodeCacheAddress(0xb20200c0)).toEqual({ file: 'data_2', offset: 8192 + 0xc0 * 1024 })
  })

  test('reads external file addresses', () => {
    expect(decodeCacheAddress(0x80000299)).toEqual({ file: 'f_000299', offset: 0 })
  })

  test('ignores unset and unknown addresses', () => {
    expect(decodeCacheAddress(0)).toBeUndefined()
    expect(decodeCacheAddress(0x00000299)).toBeUndefined()
    expect(decodeCacheAddress((0x80000000 | (6 << 28)) >>> 0)).toBeUndefined()
  })
})

describe('findCacheEntries', () => {
  test('finds entries by their keys, with when they were made and last used', () => {
    const { data1, data0 } = buildTestCache([
      { key: IMAGE_KEY, createdMs: 1000, lastUsedMs: 1000 },
      { key: LOBBY_KEY, createdMs: 2000, lastUsedMs: 5000 },
    ])
    expect(findCacheEntries(data1, data1.length, data0, data0.length, MARKERS)).toEqual([
      { key: LOBBY_KEY, createdMs: 2000, lastUsedMs: 5000, bodySize: 0, body: undefined },
    ])
  })

  test("ignores a rankings node that doesn't point back at its entry", () => {
    const { data1, data0 } = buildTestCache([
      { key: IMAGE_KEY, createdMs: 1000, lastUsedMs: 1000 },
      { key: LOBBY_KEY, createdMs: 2000, lastUsedMs: 5000 },
    ])
    // The lobby page's node, reused for the other entry.
    data0.writeUInt32LE((0x80000000 | (2 << 28) | (1 << 16) | 0) >>> 0, 8192 + 36 + 24)
    const [entry] = findCacheEntries(data1, data1.length, data0, data0.length, MARKERS)
    expect(entry.lastUsedMs).toBe(2000)
  })

  test('uses the creation time without a rankings node', () => {
    const { data1 } = buildTestCache([{ key: LOBBY_KEY, createdMs: 2000 }])
    const [entry] = findCacheEntries(data1, data1.length, undefined, 0, MARKERS)
    expect(entry.lastUsedMs).toBe(2000)
  })

  test('points to the body', () => {
    const { data1, files } = buildTestCache([{ key: LOBBY_KEY, createdMs: 2000, body: '{"a":1}' }])
    expect(Object.keys(files)).toContain('f_000001')
    const [entry] = findCacheEntries(data1, data1.length, undefined, 0, MARKERS)
    expect(entry.bodySize).toBe(7)
    expect(entry.body).toEqual({ file: 'f_000001', offset: 0 })
  })

  test('skips evicted entries', () => {
    const { data1 } = buildTestCache([{ key: LOBBY_KEY, createdMs: 2000, state: 1 }])
    expect(findCacheEntries(data1, data1.length, undefined, 0, MARKERS)).toEqual([])
  })

  test('only reads the given length of a reused buffer', () => {
    const { data1 } = buildTestCache([
      { key: IMAGE_KEY, createdMs: 1000 },
      { key: LOBBY_KEY, createdMs: 2000 },
    ])
    expect(findCacheEntries(data1, 8192 + 256, undefined, 0, MARKERS)).toEqual([])
  })

  test('finds an entry once though its key matches several markers', () => {
    const { data1 } = buildTestCache([{ key: LOBBY_KEY, createdMs: 2000 }])
    const markers = [Buffer.from('GameLobbyPanel.html?'), Buffer.from('guid=')]
    expect(findCacheEntries(data1, data1.length, undefined, 0, markers)).toHaveLength(1)
  })

  test('finds an entry whose key runs on into the blocks after its first', () => {
    const name = encodeURIComponent('가나다라마바사아자차카타파하')
    const key = `http://127.0.0.1:50072/web-api/v2/aurora-profile-by-toon/${name}/30?request_flags=scr_mmgameloading`
    const { data1 } = buildTestCache([
      { key: LOBBY_KEY, createdMs: 1000 },
      { key, createdMs: 2000 },
      { key: LOBBY_KEY.replace('12382', '9'), createdMs: 3000 },
    ])
    expect(key.length).toBeGreaterThan(160)
    const markers = [Buffer.from('request_flags=scr_mmgameloading'), ...MARKERS]
    expect(
      findCacheEntries(data1, data1.length, undefined, 0, markers).map(e => e.createdMs),
    ).toEqual([2000, 1000, 3000])
  })

  test('finds a key with a little before its URL, but not one with a lot', () => {
    const { data1 } = buildTestCache([
      { key: `1/0/${LOBBY_KEY}`, createdMs: 1000 },
      { key: `something else entirely ${LOBBY_KEY}`, createdMs: 2000 },
    ])
    expect(findCacheEntries(data1, data1.length, undefined, 0, MARKERS)).toEqual([
      expect.objectContaining({ key: `1/0/${LOBBY_KEY}`, createdMs: 1000 }),
    ])
  })

  test("ignores a marker that isn't in a key", () => {
    const { data1 } = buildTestCache([{ key: IMAGE_KEY, createdMs: 1000 }])
    // The marker's bytes in the entry's fields before its key.
    data1.write('GameLobbyPanel.html?', 8192 + 64, 'latin1')
    expect(findCacheEntries(data1, data1.length, undefined, 0, MARKERS)).toEqual([])
  })
})
