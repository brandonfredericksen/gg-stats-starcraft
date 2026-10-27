import { gzipSync, zstdCompressSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { buildTestCache } from './chromium-cache-test-files'
import {
  parseShieldBatteryProfile,
  readShieldBatteryCacheKey,
  ShieldBatteryCacheWatcher,
  ShieldBatteryProfile,
} from './sb-cache'

const SEASON_START_MS = 1790000000000
/** Two weeks into the season, when its bonus pool is 400. */
const AT_MS = SEASON_START_MS + 14 * 24 * 60 * 60_000

const PROFILE_KEY = (userId: number) =>
  `1/0/https://shieldbattery.net/api/1/users/${userId}/profile`

/** A profile as ShieldBattery's server sends it, cut down to the parts that are read. */
function profileJson(userId: number, name: string) {
  return JSON.stringify({
    user: { id: userId, name, created: 1 },
    profile: {
      userId,
      ladder: {
        '3v3bgh': {
          userId,
          matchmakingType: '3v3bgh',
          rating: 1623.3499,
          points: 4300,
          wins: 113,
          losses: 98,
          lastPlayedDate: 1792992343957,
        },
        '2v2bgh': { rating: 1824.1, wins: 33, losses: 12 },
        '1v1': { rating: 2100, points: 8500, wins: 40, losses: 2 },
        '1v1fastest': { rating: 1500, points: 0, wins: 0, losses: 0 },
        broken: null,
      },
      seasonId: 12,
      userStats: { rWins: 146, rLosses: 110 },
    },
    seasons: [
      { id: 11, startDate: SEASON_START_MS - 1e10, endDate: SEASON_START_MS, name: 'Old' },
      { id: 12, startDate: SEASON_START_MS, name: 'Now' },
    ],
  })
}

describe('readShieldBatteryCacheKey', () => {
  test('reads whose profile a key is, with or without what Chromium puts before it', () => {
    expect(readShieldBatteryCacheKey(PROFILE_KEY(15293), 1, 2)).toEqual({ userId: 15293, atMs: 2 })
    expect(
      readShieldBatteryCacheKey('https://shieldbattery.net/api/1/users/7/profile', 1, 2),
    ).toEqual({ userId: 7, atMs: 2 })
  })

  test("reads nothing from other lookups, or another site's", () => {
    expect(
      readShieldBatteryCacheKey('1/0/https://shieldbattery.net/api/1/users/batch-info?u=1', 1, 2),
    ).toBeUndefined()
    expect(
      readShieldBatteryCacheKey('1/0/https://example.com/api/1/users/7/profile', 1, 2),
    ).toBeUndefined()
  })
})

describe('parseShieldBatteryProfile', () => {
  const expected: ShieldBatteryProfile = {
    userId: 15293,
    name: 'alpha',
    seasons: {
      // With a pool of 400, team Silver 3 runs from 3620 to 4320 points.
      '3v3bgh': {
        rating: 1623,
        wins: 113,
        losses: 98,
        lastPlayedMs: 1792992343957,
        division: 'silver3',
      },
      '2v2bgh': { rating: 1824, wins: 33, losses: 12, lastPlayedMs: 0, division: 'bronze1' },
      // Solo Champion starts at 8000 points plus the whole pool.
      '1v1': { rating: 2100, wins: 40, losses: 2, lastPlayedMs: 0, division: 'champion' },
      '1v1fastest': { rating: 1500, wins: 0, losses: 0, lastPlayedMs: 0, division: 'unrated' },
    },
  }

  test('reads a body kept with zstd, gzip or none', () => {
    const json = profileJson(15293, 'alpha')
    expect(parseShieldBatteryProfile(zstdCompressSync(json), 15293, AT_MS)).toEqual(expected)
    expect(parseShieldBatteryProfile(gzipSync(json), 15293, AT_MS)).toEqual(expected)
    expect(parseShieldBatteryProfile(Buffer.from(json), 15293, AT_MS)).toEqual(expected)
  })

  test("reads nothing from a body that isn't whole yet, or is about someone else", () => {
    const body = zstdCompressSync(profileJson(15293, 'alpha'))
    expect(
      parseShieldBatteryProfile(body.subarray(0, body.length - 8), 15293, AT_MS),
    ).toBeUndefined()
    expect(parseShieldBatteryProfile(body, 1, AT_MS)).toBeUndefined()
  })

  test("leaves divisions out when the profile doesn't say when its season started", () => {
    const json = JSON.parse(profileJson(15293, 'alpha'))
    delete json.seasons
    const profile = parseShieldBatteryProfile(Buffer.from(JSON.stringify(json)), 15293, AT_MS)
    expect(profile?.seasons['3v3bgh'].division).toBeUndefined()
  })
})

describe('ShieldBatteryCacheWatcher', () => {
  test('reports a profile looked up after it started, and not one from before', async () => {
    let now = 100_000
    const entries = [
      {
        key: PROFILE_KEY(1),
        createdMs: 10_000,
        lastUsedMs: 10_000,
        body: zstdCompressSync(profileJson(1, 'old')),
      },
    ]
    let files = buildTestCache(entries).files
    const cache = {
      size: async (file: string) => files[file]?.length,
      read: async (file: string, position: number, length: number, into: Uint8Array) => {
        const part = files[file]?.subarray(position, position + length)
        if (!part) {
          return undefined
        }
        into.set(part)
        return part.length
      },
    }
    const watcher = new ShieldBatteryCacheWatcher(cache, () => now)
    const read: Array<[string, number]> = []
    watcher.on('body', (sighting, profile) => read.push([profile.name, sighting.atMs]))
    await watcher.poll()
    now += 2000
    files = buildTestCache([
      ...entries,
      {
        key: PROFILE_KEY(2),
        createdMs: now,
        lastUsedMs: now,
        body: zstdCompressSync(profileJson(2, 'clicked')),
      },
    ]).files
    await watcher.poll()
    expect(read).toEqual([['clicked', now]])
  })
})
