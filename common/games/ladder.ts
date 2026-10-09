import { AssignedRaceChar } from '../races'

/**
 * Kept next to ladder replays, it says who played each one and at what MMR and rank, which the
 * replays themselves don't. `pnpm run fetch-ladder-replays` writes it for the replays it downloads.
 */
export const LADDER_MANIFEST_FILE = 'ladder-manifest.json'
export const LADDER_MANIFEST_VERSION = 1

/** StarCraft: Remastered's 1v1 ladder ranks, lowest first. */
export const LADDER_RANKS = ['f', 'e', 'd', 'c', 'b', 'a', 's'] as const
export type LadderRank = (typeof LADDER_RANKS)[number]

/** The ladder reports a rank as a bucket, 1 for F up to 7 for S. Unranked players have none. */
export function rankFromBucket(bucket: number | undefined): LadderRank | undefined {
  return bucket !== undefined && Number.isInteger(bucket) ? LADDER_RANKS[bucket - 1] : undefined
}

export function isLadderRank(value: unknown): value is LadderRank {
  return LADDER_RANKS.includes(value as LadderRank)
}

/** One player of a ladder game, as they were going into it. */
export interface LadderPlayer {
  name: string
  race?: AssignedRaceChar
  mmr: number
  rank?: LadderRank
}

export interface LadderGame {
  matchId: string
  /**
   * When the ladder matched the players, in milliseconds since the epoch, or when the replay was
   * uploaded if it didn't say. 0 if neither is known.
   */
  createdMs: number
  season: number
  /** The map's name as the ladder gives it, without the color codes in its title. */
  mapName?: string
  players: LadderPlayer[]
}

export interface LadderManifest {
  version: typeof LADDER_MANIFEST_VERSION
  /** Keyed by the replay's file name, in the folder the manifest is in. */
  games: Record<string, LadderGame>
}

function isRaceChar(value: unknown): value is AssignedRaceChar {
  return value === 'p' || value === 't' || value === 'z'
}

function parsePlayer(value: unknown): LadderPlayer | undefined {
  const p = value as Partial<LadderPlayer> | null
  if (typeof p?.name !== 'string' || typeof p.mmr !== 'number' || !Number.isFinite(p.mmr)) {
    return undefined
  }
  return {
    name: p.name,
    race: isRaceChar(p.race) ? p.race : undefined,
    mmr: p.mmr,
    rank: isLadderRank(p.rank) ? p.rank : undefined,
  }
}

/** Reads a manifest, leaving out any game that isn't what it should be. */
export function parseLadderManifest(value: unknown): LadderManifest | undefined {
  const manifest = value as Partial<LadderManifest> | null
  if (
    manifest?.version !== LADDER_MANIFEST_VERSION ||
    typeof manifest.games !== 'object' ||
    !manifest.games
  ) {
    return undefined
  }
  const games: Record<string, LadderGame> = {}
  for (const [fileName, game] of Object.entries(manifest.games)) {
    const players = Array.isArray(game?.players) ? game.players.map(parsePlayer) : []
    if (
      typeof game?.matchId !== 'string' ||
      typeof game.createdMs !== 'number' ||
      typeof game.season !== 'number' ||
      !players.length ||
      players.some(p => !p)
    ) {
      continue
    }
    games[fileName] = {
      ...game,
      mapName: typeof game.mapName === 'string' ? game.mapName : undefined,
      players: players as LadderPlayer[],
    }
  }
  return { version: LADDER_MANIFEST_VERSION, games }
}

/**
 * Finds a game's ladder player for a player of its replay: by name, or in a game where the races
 * tell everyone apart, by race.
 */
export function findLadderPlayer(
  game: LadderGame,
  names: ReadonlyArray<string>,
  race: AssignedRaceChar | undefined,
): LadderPlayer | undefined {
  const lowered = names.map(n => n.toLowerCase())
  const byName = game.players.find(p => lowered.includes(p.name.toLowerCase()))
  if (byName || !race) {
    return byName
  }
  const byRace = game.players.filter(p => p.race === race)
  return byRace.length === 1 ? byRace[0] : undefined
}
