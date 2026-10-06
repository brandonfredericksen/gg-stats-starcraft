import { describe, expect, test } from 'vitest'
import { RaceChar } from '../../common/races'
import { ReplayLibraryPlayer } from '../../common/replays-library'
import {
  encodeViewPathname,
  getReplayDisplayTeams,
  isManualPlaylistOrder,
  parseViewPathname,
} from './replay-library-helpers'

function makePlayer(
  overrides: Partial<ReplayLibraryPlayer> & { slot: number; team: number; race: RaceChar },
): ReplayLibraryPlayer {
  return {
    name: `player-${overrides.slot}`,
    isComputer: false,
    ...overrides,
  }
}

describe('getReplayDisplayTeams', () => {
  test('splits a single team of two into a 1v1', () => {
    const players = [
      makePlayer({ slot: 0, team: 1, race: 't' }),
      makePlayer({ slot: 1, team: 1, race: 'z' }),
    ]
    const layout = getReplayDisplayTeams(players)
    expect(layout.kind).toBe('oneVsOne')
    expect(layout.teams).toHaveLength(2)
    expect(layout.teams[0]).toHaveLength(1)
    expect(layout.teams[1]).toHaveLength(1)
  })

  test('keeps two explicit teams as-is', () => {
    const players = [
      makePlayer({ slot: 0, team: 1, race: 't' }),
      makePlayer({ slot: 1, team: 1, race: 't' }),
      makePlayer({ slot: 2, team: 2, race: 'z' }),
      makePlayer({ slot: 3, team: 2, race: 'z' }),
    ]
    const layout = getReplayDisplayTeams(players)
    expect(layout.kind).toBe('teams')
    expect(layout.teams.map(t => t.length)).toEqual([2, 2])
  })

  test('orders teams by team number', () => {
    const players = [
      makePlayer({ slot: 0, team: 3, race: 'z' }),
      makePlayer({ slot: 1, team: 1, race: 't' }),
    ]
    const layout = getReplayDisplayTeams(players)
    // Two singleton teams => kept as teams, ordered by team number.
    expect(layout.kind).toBe('teams')
    expect(layout.teams[0][0].team).toBe(1)
    expect(layout.teams[1][0].team).toBe(3)
  })

  test('treats many singleton teams as an unlabeled FFA', () => {
    const players = [
      makePlayer({ slot: 0, team: 1, race: 't' }),
      makePlayer({ slot: 1, team: 2, race: 'z' }),
      makePlayer({ slot: 2, team: 3, race: 'p' }),
      makePlayer({ slot: 3, team: 4, race: 't' }),
    ]
    const layout = getReplayDisplayTeams(players)
    expect(layout.kind).toBe('teams')
    expect(layout.teams).toHaveLength(4)
  })

  test('balances an unsplittable single team across two columns', () => {
    const players = [
      makePlayer({ slot: 0, team: 1, race: 't' }),
      makePlayer({ slot: 1, team: 1, race: 'z' }),
      makePlayer({ slot: 2, team: 1, race: 'p' }),
    ]
    const layout = getReplayDisplayTeams(players)
    expect(layout.kind).toBe('flat')
    expect(layout.teams.map(t => t.length)).toEqual([2, 1])
  })

  test('renders a lone player as a single column', () => {
    const players = [makePlayer({ slot: 0, team: 1, race: 'p' })]
    const layout = getReplayDisplayTeams(players)
    expect(layout.kind).toBe('flat')
    expect(layout.teams).toHaveLength(1)
    expect(layout.teams[0]).toHaveLength(1)
  })
})

describe('parseViewPathname / encodeViewPathname', () => {
  test('parses "/replays" and "/replays/" as the "all" view', () => {
    expect(parseViewPathname('/replays')).toEqual({ kind: 'all' })
    expect(parseViewPathname('/replays/')).toEqual({ kind: 'all' })
  })

  test('parses "/replays/bookmarked" and its trailing-slash form as the bookmarked view', () => {
    expect(parseViewPathname('/replays/bookmarked')).toEqual({ kind: 'bookmarked' })
    expect(parseViewPathname('/replays/bookmarked/')).toEqual({ kind: 'bookmarked' })
  })

  test('parses "/replays/playlists/<id>" as a playlist view', () => {
    expect(parseViewPathname('/replays/playlists/42')).toEqual({ kind: 'playlist', id: 42 })
  })

  test('falls back to "all" for a playlists subpath missing an id', () => {
    expect(parseViewPathname('/replays/playlists')).toEqual({ kind: 'all' })
  })

  test('falls back to "all" for a malformed playlist id', () => {
    expect(parseViewPathname('/replays/playlists/notanumber')).toEqual({ kind: 'all' })
  })

  test('falls back to "all" for an unrecognized subpath', () => {
    expect(parseViewPathname('/replays/something-else')).toEqual({ kind: 'all' })
  })

  test('encodes each view kind to its canonical pathname', () => {
    expect(encodeViewPathname({ kind: 'all' })).toBe('/replays')
    expect(encodeViewPathname({ kind: 'bookmarked' })).toBe('/replays/bookmarked')
    expect(encodeViewPathname({ kind: 'playlist', id: 42 })).toBe('/replays/playlists/42')
  })

  test('round-trips a playlist view through encode then parse', () => {
    expect(parseViewPathname(encodeViewPathname({ kind: 'playlist', id: 7 }))).toEqual({
      kind: 'playlist',
      id: 7,
    })
  })
})

describe('isManualPlaylistOrder', () => {
  test('is true only for a playlist view with no explicit sort', () => {
    expect(isManualPlaylistOrder({ kind: 'playlist', id: 1 }, '')).toBe(true)
  })

  test('is false when a sort is explicitly chosen', () => {
    expect(isManualPlaylistOrder({ kind: 'playlist', id: 1 }, 'latest')).toBe(false)
  })

  test('is false for non-playlist views', () => {
    expect(isManualPlaylistOrder({ kind: 'all' }, '')).toBe(false)
    expect(isManualPlaylistOrder({ kind: 'bookmarked' }, '')).toBe(false)
  })
})
