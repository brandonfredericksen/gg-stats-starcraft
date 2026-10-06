import {
  EncodedMatchupString,
  GameDurationFilter,
  GameFormat,
  GameSortOption,
} from './games/game-filters'
import { RaceChar } from './races'

/**
 * A single player as recorded in a replay's header. `slot` matches the player's id in the replay,
 * `team` groups players for team games (and matchup computation).
 */
export interface ReplayLibraryPlayer {
  slot: number
  team: number
  name: string
  race: RaceChar
  isComputer: boolean
}

/**
 * A single indexed replay, as exposed to the renderer. Everything here is derived from the local
 * replay index (no per-request parsing), and is JSON-safe (timestamps are unix ms, no `Date`/`Map`).
 */
/** The human player names that appear in the most replays. */
/** A name that looks like one of the user's own, with how many of their games it's in. */
export interface SuggestedOwnName {
  name: string
  games: number
}

export interface ReplayLibraryEntry {
  /** Stable local id for this replay in the index. */
  id: number
  path: string
  /** Basename of `path`, provided for convenience. */
  fileName: string
  fileSize: number
  /** Game start time as unix ms (derived from the replay's random seed). */
  gameTime: number
  mapName: string
  /** Raw numeric game type, suitable for passing to `replayGameTypeToLabel`. */
  gameType: number
  durationFrames: number
  /**
   * The id of the game the replay records, if the client that saved it records one. Absent for
   * Battle.net replays.
   */
  linkedGameId?: string
  /** True if the replay could not be parsed; only `path`/`fileName`/`fileSize` are meaningful then. */
  parseError: boolean
  players: ReplayLibraryPlayer[]
  /** Unix ms when this replay was bookmarked, or `undefined` if it isn't. */
  bookmarkedAt?: number
}

/**
 * What happened to one path passed to `replayLibraryTrashReplays`: `trashed` moved it to the Recycle
 * Bin, `missing` means the file was already gone (nothing to do), and `failed` means it's still on
 * disk (it was outside the watched folders, or the move itself errored).
 */
export type ReplayTrashOutcome = 'trashed' | 'missing' | 'failed'

export interface ReplayTrashResult {
  path: string
  outcome: ReplayTrashOutcome
}

/** A local playlist grouping replays in manual order, as exposed to the renderer. */
export interface ReplayPlaylist {
  id: number
  name: string
  /** Number of replays currently in the playlist. */
  count: number
}

/**
 * Filters applied to a replay library query. All are optional; omitting a field means "don't filter
 * on it". Format/matchup semantics mirror the server's match-history filtering.
 */
export type ReplayTeamsFilter = '1v1' | '2v2' | 'bigTeams' | 'ffa'

export interface ReplayLibraryFilters {
  /** Case-insensitive substring to match against the map name. */
  mapName?: string
  /** Case-insensitive substring to match against any player's name. */
  playerName?: string
  /** Case-insensitive substring to match against the map name or any player's name. */
  search?: string
  /**
   * More player names that `search` also matches exactly, ignoring case, like every account of a
   * known player whose name matches the search.
   */
  searchAccounts?: string[]
  /**
   * Only replays with a human player by one of these names (`mine`), or only replays without one
   * (`others`). Names match ignoring case.
   */
  whose?: { names: string[]; match: 'mine' | 'others' }
  /**
   * Only replays with a human player by one of these names, like every account of one person.
   * Names match ignoring case. Works alongside `whose`, so both can be asked for at once.
   */
  withAccounts?: string[]
  /**
   * The shape of the game: two even teams of this size, `bigTeams` for two even teams of 3 or
   * more, or `ffa` for games without two even teams. Ignored while `format` is set.
   */
  teams?: ReplayTeamsFilter
  /**
   * Only replays that have saved stats (`analyzed`) or only ones that don't (`notAnalyzed`). The
   * renderer passes the intent; the main process fills in `analyzedPaths`.
   */
  analysis?: 'analyzed' | 'notAnalyzed'
  /** Lowercased paths of the replays that have saved stats, for `analysis`. Set by the main process. */
  analyzedPaths?: string[]
  /** Leaves out the replays at these paths, matched ignoring case. */
  excludePaths?: string[]
  /**
   * A raw numeric game type to match exactly, or `'others'` to match any game type outside
   * `FEATURED_REPLAY_GAME_TYPES`.
   */
  gameType?: number | 'others'
  duration?: GameDurationFilter
  /** When true, includes replays shorter than `MIN_GAME_LENGTH_MS` (hidden by default). */
  includeShort?: boolean
  /** Team-size shape (e.g. `1v1`). Required for `matchup` to take effect. */
  format?: GameFormat
  /** Encoded matchup filter with wildcards; only applied together with `format`. */
  matchup?: EncodedMatchupString
  /** Only match bookmarked replays. */
  bookmarked?: boolean
  /** Only match replays in this playlist, ordered by the playlist's manual order unless `sort` is set. */
  playlistId?: number
  /** Result ordering. Defaults to newest-first when omitted. */
  sort?: GameSortOption
  /** Number of matching entries to skip from the start of the results (for pagination). */
  offset?: number
  /** Maximum number of entries to return. When omitted, all matches are returned. */
  limit?: number
  /** Inclusive lower bound (unix ms) on `gameTime`. */
  gameTimeFrom?: number
  /** Inclusive upper bound (unix ms) on `gameTime`. */
  gameTimeTo?: number
}

/**
 * Progress of the replay index's backfill, in the two phases the UI distinguishes: `scanning` while
 * the replay folder is being walked and the amount of work isn't known yet, then `indexing` while
 * the discovered files are parsed (`done`/`total` count files parsed so far). Absent when no
 * backfill is running.
 */
export type ReplayBackfillProgress =
  | { phase: 'scanning' }
  | { phase: 'indexing'; done: number; total: number }

/** High-level status of the replay index, for surfacing indexing progress in the UI. */
export interface ReplayLibraryStatus {
  /** Number of replays currently in the index. */
  totalIndexed: number
  /** Number of replays currently bookmarked. */
  bookmarkedCount: number
  /** Present while an initial/ongoing backfill is running. */
  backfill?: ReplayBackfillProgress
  /** The absolute paths of the folders being indexed. */
  watchedFolders: string[]
}
