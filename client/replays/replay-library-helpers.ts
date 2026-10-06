import { assertUnreachable } from '../../common/assert-unreachable'
import { ReplayLibraryPlayer } from '../../common/replays-library'
import { urlPath } from '../../common/urls'

/** Which subset of the library the rail is currently pointed at, addressed by the `/replays…` pathname. */
export type LibraryView =
  | { kind: 'all' }
  | { kind: 'bookmarked' }
  | { kind: 'playlist'; id: number }

/**
 * Parses a pathname under `/replays` into the `LibraryView` it addresses:
 * - `/replays` (and `/replays/`) -> the whole library (`all`)
 * - `/replays/bookmarked` -> `bookmarked`
 * - `/replays/playlists/<id>` -> `playlist` with that id
 *
 * Trailing slashes are tolerated. Anything else — an unparseable playlist id, an unrecognized
 * subpath, extra segments — falls back to `all`; callers that need the URL itself to reflect that
 * fallback canonicalize it separately (see `encodeViewPathname`).
 */
export function parseViewPathname(pathname: string): LibraryView {
  const segments = pathname.split('/').filter(segment => segment.length > 0)

  if (segments.length === 2 && segments[1] === 'bookmarked') {
    return { kind: 'bookmarked' }
  }
  if (segments.length === 3 && segments[1] === 'playlists') {
    const id = Number.parseInt(segments[2], 10)
    if (Number.isFinite(id)) {
      return { kind: 'playlist', id }
    }
  }
  return { kind: 'all' }
}

/**
 * Encodes a `LibraryView` into its canonical `/replays…` pathname (the form `parseViewPathname`
 * parses back to the same view).
 */
export function encodeViewPathname(view: LibraryView): string {
  switch (view.kind) {
    case 'all':
      return '/replays'
    case 'bookmarked':
      return '/replays/bookmarked'
    case 'playlist':
      return urlPath`/replays/playlists/${view.id}`
    default:
      return assertUnreachable(view)
  }
}

/**
 * True when `view` is a playlist and the user hasn't chosen an explicit sort (`rawSort` is the sort
 * in the raw, possibly-empty form a `sort` URL param carries). In that case results come back in
 * the playlist's manual order, which shouldn't be day-grouped like the date sorts are.
 */
export function isManualPlaylistOrder(view: LibraryView, rawSort: string): boolean {
  return view.kind === 'playlist' && !rawSort
}

/**
 * The way a replay's players are laid out for display:
 * - `teams`: two or more explicit teams (rendered one column per team).
 * - `oneVsOne`: a melee-style 1v1 (a single team of exactly two players), split into two columns.
 * - `flat`: everything else (e.g. a >2-player melee where teams can't be determined), rendered as a
 *   single flat list balanced across two columns.
 */
export type ReplayTeamKind = 'teams' | 'oneVsOne' | 'flat'

export interface ReplayTeamLayout {
  kind: ReplayTeamKind
  teams: ReplayLibraryPlayer[][]
}

/**
 * Splits a chunk of players into two balanced columns (the first column gets the extra player when
 * the count is odd), dropping any resulting empty column.
 */
function balanceIntoTwoColumns(players: ReplayLibraryPlayer[]): ReplayLibraryPlayer[][] {
  if (players.length === 0) {
    return []
  }
  const half = Math.ceil(players.length / 2)
  const columns = [players.slice(0, half), players.slice(half)]
  return columns.filter(c => c.length > 0)
}

/**
 * Groups a replay's players into the team layout used for display. Mirrors the split semantics the
 * replay index uses for filtering (see `app/replay-library/replay-queries.ts`), but keeps the full
 * player objects (and always produces something renderable, even for the ambiguous case):
 *
 * - 2+ non-empty teams: returned as-is (ordered by team number).
 * - exactly one team of exactly two players (a melee 1v1): split into two one-player teams.
 * - anything else: all players in a single flat list, balanced across two columns.
 */
export function getReplayDisplayTeams(
  players: ReadonlyArray<ReplayLibraryPlayer>,
): ReplayTeamLayout {
  const byTeam = new Map<number, ReplayLibraryPlayer[]>()
  for (const p of players) {
    const team = byTeam.get(p.team)
    if (team) {
      team.push(p)
    } else {
      byTeam.set(p.team, [p])
    }
  }

  const teams = Array.from(byTeam.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, teamPlayers]) => teamPlayers)
    .filter(t => t.length > 0)

  if (teams.length >= 2) {
    return { kind: 'teams', teams }
  }
  if (teams.length === 1 && teams[0].length === 2) {
    return { kind: 'oneVsOne', teams: [[teams[0][0]], [teams[0][1]]] }
  }

  return { kind: 'flat', teams: balanceIntoTwoColumns(players.slice()) }
}

/** A short matchup for a layout, like `PvZ` or `PTvZZ`, or undefined when there are no teams. */
export function getLayoutMatchup(layout: ReplayTeamLayout): string | undefined {
  if (layout.kind === 'flat') {
    return layout.teams.flat().length ? 'FFA' : undefined
  }
  return layout.teams
    .map(team =>
      team
        .map(p => p.race.toUpperCase())
        .sort()
        .join(''),
    )
    .join('v')
}
