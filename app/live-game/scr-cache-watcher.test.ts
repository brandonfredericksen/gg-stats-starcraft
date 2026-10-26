import { describe, expect, test } from 'vitest'
import { ACTIVE_MS, CacheFiles, MISSING_POLL_MS, STALE_MS } from './cache-watcher'
import { buildTestCache, TestCacheEntry, toServerJson } from './chromium-cache-test-files'
import { ScrCacheWatcher } from './scr-cache-watcher'

const MATCH_PAGE = (guid: number) =>
  `http://127.0.0.1:50072/gamedata/webui/dist/MatchmakingGameLoadingPanel/MatchmakingGameLoadingPanel.html?locale=enUS&port=50072&guid=${guid}`
const PROFILE = (name: string) =>
  `http://127.0.0.1:50072/web-api/v2/aurora-profile-by-toon/${name}/30?request_flags=scr_mmgameloading`
const BODY = JSON.stringify(
  toServerJson({
    matchmakedCurrentSeason: 20,
    matchmakedStats: [
      { gameModeId: 1, seasonId: 20, toon: 'Opp', bucket: 3, rating: 1430, wins: 9, losses: 8 },
    ],
  }),
)

/** A cache whose files can be swapped, counting the bytes read from it. */
class TestCache implements CacheFiles {
  files: Record<string, Buffer> = {}
  bytesRead = 0

  set(entries: ReadonlyArray<TestCacheEntry>) {
    this.files = buildTestCache(entries).files
  }

  size = async (file: string) => this.files[file]?.length

  read = async (file: string, position: number, length: number, into: Uint8Array) => {
    const data = this.files[file]
    if (!data) {
      return undefined
    }
    const part = data.subarray(position, position + length)
    into.set(part)
    this.bytesRead += part.length
    return part.length
  }
}

function setup(entries: ReadonlyArray<TestCacheEntry>) {
  const cache = new TestCache()
  cache.set(entries)
  let now = 100_000
  const watcher = new ScrCacheWatcher(cache, () => now)
  const events: unknown[] = []
  watcher.on('sighting', s => events.push(s))
  watcher.on('body', (sighting, profile) => {
    if (sighting.kind === 'ladderProfile') {
      events.push({ name: sighting.name, gatewayId: sighting.gatewayId, profile })
    }
  })
  watcher.on('error', err => {
    throw err
  })
  return {
    cache,
    watcher,
    events,
    advance: (ms: number) => {
      now += ms
    },
    get now() {
      return now
    },
  }
}

describe('ScrCacheWatcher', () => {
  test("doesn't report what was cached before it started", async () => {
    const t = setup([{ key: MATCH_PAGE(1), createdMs: 99_000, lastUsedMs: 99_000 }])
    await t.watcher.poll()
    await t.watcher.poll()
    expect(t.events).toEqual([])
  })

  test('reports a match screen and its profiles, then the profiles once read', async () => {
    const t = setup([{ key: MATCH_PAGE(1), createdMs: 50_000, lastUsedMs: 50_000 }])
    await t.watcher.poll()

    t.advance(1000)
    t.cache.set([
      { key: MATCH_PAGE(1), createdMs: 50_000, lastUsedMs: 50_000 },
      { key: MATCH_PAGE(2), createdMs: t.now, lastUsedMs: t.now },
      { key: PROFILE('Opp'), createdMs: t.now + 1, lastUsedMs: t.now + 2, body: BODY },
    ])
    await t.watcher.poll()
    expect(t.events).toEqual([
      { kind: 'matchPage', port: 50072, panelId: 2, createdMs: t.now, atMs: t.now },
      { kind: 'ladderProfile', name: 'Opp', gatewayId: 30, createdMs: t.now + 1, atMs: t.now + 2 },
      {
        name: 'Opp',
        gatewayId: 30,
        profile: {
          battleTag: undefined,
          ladder: { rating: 1430, rank: 'd', wins: 9, losses: 8 },
          otherAccounts: [],
        },
      },
    ])
  })

  test('reports a profile used again, like in a rematch', async () => {
    const t = setup([{ key: PROFILE('Opp'), createdMs: 1000, lastUsedMs: 1000, body: BODY }])
    await t.watcher.poll()
    t.advance(1000)
    // A new match screen changes the header; the profile only changes when it was last used.
    t.cache.set([
      { key: PROFILE('Opp'), createdMs: 1000, lastUsedMs: t.now, body: BODY },
      { key: MATCH_PAGE(3), createdMs: t.now, lastUsedMs: t.now },
    ])
    await t.watcher.poll()
    expect(t.events).toMatchObject([
      { kind: 'matchPage', panelId: 3 },
      { kind: 'ladderProfile', name: 'Opp' },
      { name: 'Opp', profile: { ladder: { rating: 1430 } } },
    ])
  })

  test('waits for a profile whose body is still being written', async () => {
    const t = setup([])
    await t.watcher.poll()
    t.advance(1000)
    t.cache.set([{ key: PROFILE('Opp'), createdMs: t.now, lastUsedMs: t.now, body: '{"matchm' }])
    await t.watcher.poll()
    expect(t.events).toHaveLength(1)
    t.advance(1000)
    t.cache.set([
      { key: PROFILE('Opp'), createdMs: t.now - 1000, lastUsedMs: t.now - 1000, body: BODY },
    ])
    await t.watcher.poll()
    expect(t.events).toHaveLength(2)
    expect(t.events[1]).toMatchObject({ name: 'Opp', profile: { ladder: { wins: 9 } } })
  })

  test("doesn't report an old entry that looks new", async () => {
    const t = setup([])
    await t.watcher.poll()
    t.advance(1000)
    t.cache.set([
      { key: MATCH_PAGE(9), createdMs: t.now - STALE_MS - 1, lastUsedMs: t.now - STALE_MS - 1 },
    ])
    await t.watcher.poll()
    expect(t.events).toEqual([])
  })

  test("only reads the header while the cache doesn't change", async () => {
    const t = setup([{ key: MATCH_PAGE(1), createdMs: 1000, lastUsedMs: 1000 }])
    await t.watcher.poll()
    t.advance(ACTIVE_MS)
    await t.watcher.poll()
    const before = t.cache.bytesRead
    for (let i = 0; i < 10; i++) {
      t.advance(1000)
      await t.watcher.poll()
    }
    expect(t.cache.bytesRead - before).toBe(10 * 8192)
  })

  test('reports what a cache made after it started has, looking for it every few seconds', async () => {
    const t = setup([])
    t.cache.files = {}
    await t.watcher.poll()
    t.cache.set([{ key: MATCH_PAGE(4), createdMs: t.now, lastUsedMs: t.now }])
    t.advance(1000)
    await t.watcher.poll()
    expect(t.events).toEqual([])
    t.advance(MISSING_POLL_MS)
    await t.watcher.poll()
    expect(t.events).toMatchObject([{ kind: 'matchPage', panelId: 4 }])
  })

  test("doesn't read the whole cache again and again after starting", async () => {
    const t = setup([{ key: MATCH_PAGE(1), createdMs: 1000, lastUsedMs: 1000 }])
    await t.watcher.poll()
    const before = t.cache.bytesRead
    t.advance(1000)
    await t.watcher.poll()
    expect(t.cache.bytesRead - before).toBe(8192)
  })

  test('forgets entries that are gone, and everything when stopped', async () => {
    const t = setup([{ key: MATCH_PAGE(1), createdMs: 1000, lastUsedMs: 1000 }])
    await t.watcher.poll()
    t.cache.set([])
    t.advance(1000)
    await t.watcher.poll()
    expect((t.watcher as unknown as { lastUsed: Map<string, number> }).lastUsed.size).toBe(0)
    t.watcher.stop()
    expect((t.watcher as unknown as { data1?: Buffer }).data1).toBeUndefined()
  })
})
