import { rankFromBucket } from '../../common/games/ladder'
import { LiveLadderStanding } from '../../common/live-game'

/**
 * What StarCraft's embedded browser caches that tells about a ladder game the user joined. The match
 * screen's page is cached under its URL, which carries the port of StarCraft's local server and the
 * page's panel id, and the screen looks up each player's profile by name and gateway. `atMs` is
 * when the entry was last used, and `createdMs` when it was made, which never changes, so it tells
 * one page from another.
 */
export type ScrCacheSighting =
  | { kind: 'matchPage'; port: number; panelId: number; createdMs: number; atMs: number }
  | { kind: 'ladderProfile'; name: string; gatewayId: number; createdMs: number; atMs: number }

/** Bytes found in the keys of every entry {@link readCacheKey} reads, to find them quickly. */
export const SCR_CACHE_MARKERS: ReadonlyArray<Uint8Array> = [
  Buffer.from('MatchmakingGameLoadingPanel.html?', 'latin1'),
  Buffer.from('request_flags=scr_mmgameloading', 'latin1'),
]

const PAGE_KEY =
  /^http:\/\/127\.0\.0\.1:\d+\/gamedata\/webui\/dist\/MatchmakingGameLoadingPanel\/MatchmakingGameLoadingPanel\.html\?(.*)$/
const PROFILE_KEY =
  /^http:\/\/127\.0\.0\.1:\d+\/web-api\/v2\/aurora-profile-by-toon\/([^/?]+)\/(\d+)\?request_flags=scr_mmgameloading$/

function toPort(value: string | null) {
  const port = value && /^\d{1,5}$/.test(value) ? Number(value) : 0
  return port > 0 && port < 65536 ? port : undefined
}

/** What an entry's key says, if it's one of the entries this reads. */
export function readCacheKey(
  key: string,
  createdMs: number,
  atMs: number,
): ScrCacheSighting | undefined {
  const page = PAGE_KEY.exec(key)
  if (page) {
    const params = new URLSearchParams(page[1])
    const port = toPort(params.get('port'))
    const guid = params.get('guid')
    if (port === undefined || !guid || !/^\d{1,9}$/.test(guid)) {
      return undefined
    }
    return { kind: 'matchPage', port, panelId: Number(guid), createdMs, atMs }
  }
  const profile = PROFILE_KEY.exec(key)
  if (profile) {
    let name: string
    try {
      name = decodeURIComponent(profile[1])
    } catch {
      return undefined
    }
    return name
      ? { kind: 'ladderProfile', name, gatewayId: Number(profile[2]), createdMs, atMs }
      : undefined
  }
  return undefined
}

/** What the match screen's profile lookup says about a player. */
export interface LadderProfile {
  battleTag?: string
  ladder?: LiveLadderStanding
  /** The other accounts on the same Battle.net account, on any gateway. */
  otherAccounts: string[]
}

interface ProfileStat {
  game_mode_id?: unknown
  season_id?: unknown
  toon?: unknown
  toon_guid?: unknown
  rating?: unknown
  bucket?: unknown
  wins?: unknown
  losses?: unknown
}

const ONE_VS_ONE = 1

function toCount(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

function sameName(a: unknown, b: string) {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase()
}

/**
 * Every account on the Battle.net account, by gateway id, then name, to the account's id. A name
 * can be on several gateways, each its own account.
 */
type AccountsByGateway = Record<string, Record<string, unknown>>

function readAccounts(value: unknown): AccountsByGateway {
  if (!value || typeof value !== 'object') {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, Record<string, unknown>] =>
        !!entry[1] && typeof entry[1] === 'object',
    ),
  )
}

/**
 * Reads a profile StarCraft's server sent the match screen for `name` on `gatewayId`. Undefined
 * when it isn't whole JSON yet, like while the browser is still writing it.
 */
export function parseLadderProfile(
  body: Uint8Array,
  name: string,
  gatewayId: number,
): LadderProfile | undefined {
  let profile: {
    battle_tag?: unknown
    matchmaked_current_season?: unknown
    matchmaked_stats?: unknown
    toon_guid_by_gateway?: unknown
  }
  try {
    profile = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return undefined
  }
  if (!profile || typeof profile !== 'object') {
    return undefined
  }
  const accounts = readAccounts(profile.toon_guid_by_gateway)
  const ownGuid = Object.entries(accounts[String(gatewayId)] ?? {}).find(([toon]) =>
    sameName(toon, name),
  )?.[1]

  const season = profile.matchmaked_current_season
  const stats = (Array.isArray(profile.matchmaked_stats) ? profile.matchmaked_stats : []).filter(
    (s: ProfileStat | null): s is ProfileStat =>
      !!s && s.game_mode_id === ONE_VS_ONE && s.season_id === season && typeof s.toon === 'string',
  )
  // The same name on another gateway is another account, with its own season.
  const own =
    ownGuid !== undefined
      ? stats.find(s => s.toon_guid === ownGuid)
      : stats.find(s => sameName(s.toon, name))

  const names = Object.values(accounts).flatMap(byName => Object.keys(byName))
  const otherAccounts: string[] = []
  for (const other of names.length ? names : stats.map(s => s.toon as string)) {
    if (!sameName(other, name) && !otherAccounts.some(a => sameName(a, other))) {
      otherAccounts.push(other)
    }
  }

  let ladder: LiveLadderStanding | undefined
  if (own) {
    const rank = rankFromBucket(typeof own.bucket === 'number' ? own.bucket : undefined)
    const rating = toCount(own.rating)
    ladder = {
      // An account without a rank this season has a rating of 0, not one to show.
      rating: rank && rating ? rating : undefined,
      rank,
      wins: toCount(own.wins),
      losses: toCount(own.losses),
    }
  }
  return {
    battleTag: typeof profile.battle_tag === 'string' ? profile.battle_tag : undefined,
    ladder,
    otherAccounts,
  }
}
