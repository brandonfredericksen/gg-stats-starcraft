import { brotliDecompressSync, gunzipSync, zstdDecompressSync } from 'node:zlib'
import { CacheFiles, CacheWatcher } from './cache-watcher'
import { getBonusPool, getShieldBatteryDivision } from './sb-divisions'

/** ShieldBattery looked up someone's profile, like when the user opened it, at `atMs`. */
export interface ShieldBatteryProfileSighting {
  userId: number
  atMs: number
}

/** A player's season in one of ShieldBattery's matchmaking modes. */
export interface ShieldBatteryModeSeason {
  rating: number
  wins: number
  losses: number
  /** When they last played in it, in Unix ms, or 0 if the profile doesn't say. */
  lastPlayedMs: number
  /**
   * Their division, like `gold2`, or `unrated` before their first game. Missing when the profile
   * doesn't say when its season started, which the division depends on.
   */
  division?: string
}

/** What a profile ShieldBattery looked up says about the player. */
export interface ShieldBatteryProfile {
  userId: number
  name: string
  /** Their season in each matchmaking mode they've played in it, by mode, like `3v3bgh`. */
  seasons: Record<string, ShieldBatteryModeSeason>
}

/** Bytes found in the key of every entry {@link readShieldBatteryCacheKey} reads. */
export const SB_CACHE_MARKERS: ReadonlyArray<Uint8Array> = [
  Buffer.from('shieldbattery.net/api/1/users/', 'latin1'),
]

/** A profile's key: its URL, after what Chromium puts before it. */
const PROFILE_KEY = /^(?:\d+\/\d+\/)?https:\/\/shieldbattery\.net\/api\/1\/users\/(\d+)\/profile$/

export function readShieldBatteryCacheKey(
  key: string,
  _createdMs: number,
  atMs: number,
): ShieldBatteryProfileSighting | undefined {
  const match = PROFILE_KEY.exec(key)
  return match ? { userId: Number(match[1]), atMs } : undefined
}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]
const GZIP_MAGIC = [0x1f, 0x8b]
const OPEN_BRACE = 0x7b

function startsWith(body: Uint8Array, magic: ReadonlyArray<number>) {
  return magic.every((byte, i) => body[i] === byte)
}

/** The body uncompressed: the cache keeps it as it was sent. Throws if it isn't whole. */
function decompress(body: Uint8Array) {
  if (startsWith(body, ZSTD_MAGIC)) {
    return zstdDecompressSync(body)
  }
  if (startsWith(body, GZIP_MAGIC)) {
    return gunzipSync(body)
  }
  // Brotli has no magic bytes to tell it by.
  return body[0] === OPEN_BRACE ? body : brotliDecompressSync(body)
}

function toCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0
}

/**
 * The bonus pool of the profile's season at `atMs`, which the divisions depend on, or undefined if
 * the profile doesn't say when its season started.
 */
function getProfileBonusPool(
  seasonId: unknown,
  seasons: unknown,
  atMs: number,
): number | undefined {
  const season = (Array.isArray(seasons) ? seasons : []).find(
    (s: { id?: unknown } | null) => !!s && s.id === seasonId,
  ) as { startDate?: unknown; endDate?: unknown } | undefined
  if (typeof season?.startDate !== 'number') {
    return undefined
  }
  const endMs = typeof season.endDate === 'number' ? season.endDate : undefined
  return getBonusPool(atMs, season.startDate, endMs)
}

/**
 * Reads a profile ShieldBattery's server sent for `userId`, looked up at `atMs`. Undefined when it
 * isn't whole yet, like while the browser is still writing it, or is about someone else.
 */
export function parseShieldBatteryProfile(
  body: Uint8Array,
  userId: number,
  atMs: number,
): ShieldBatteryProfile | undefined {
  let json: {
    user?: { id?: unknown; name?: unknown }
    profile?: { ladder?: Record<string, unknown>; seasonId?: unknown }
    seasons?: unknown
  }
  try {
    json = JSON.parse(new TextDecoder().decode(decompress(body)))
  } catch {
    return undefined
  }
  const name = json?.user?.name
  if (json?.user?.id !== userId || typeof name !== 'string' || !name) {
    return undefined
  }
  const bonusPool = getProfileBonusPool(json.profile?.seasonId, json.seasons, atMs)
  const seasons: Record<string, ShieldBatteryModeSeason> = {}
  for (const [mode, value] of Object.entries(json.profile?.ladder ?? {})) {
    const season = value as Record<string, unknown> | null
    if (!season || typeof season !== 'object' || typeof season.rating !== 'number') {
      continue
    }
    const wins = toCount(season.wins)
    const losses = toCount(season.losses)
    const points = typeof season.points === 'number' ? season.points : 0
    seasons[mode] = {
      rating: Math.round(season.rating),
      wins,
      losses,
      lastPlayedMs: toCount(season.lastPlayedDate),
      division:
        bonusPool === undefined
          ? undefined
          : getShieldBatteryDivision(mode, { points, wins, losses }, bonusPool),
    }
  }
  return { userId, name, seasons }
}

/**
 * Watches ShieldBattery's own browser cache for the profiles it looks up. The ones it looked up
 * before, still in the cache, are reported as `pastBody`, for the ranks they show.
 */
export class ShieldBatteryCacheWatcher extends CacheWatcher<
  ShieldBatteryProfileSighting,
  ShieldBatteryProfile
> {
  constructor(files: CacheFiles, now?: () => number) {
    super(
      files,
      {
        markers: SB_CACHE_MARKERS,
        readKey: readShieldBatteryCacheKey,
        hasBody: () => true,
        readsPast: true,
        readBody: (body, sighting) =>
          parseShieldBatteryProfile(body, sighting.userId, sighting.atMs),
      },
      now,
    )
  }
}
