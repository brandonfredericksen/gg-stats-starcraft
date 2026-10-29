import { describe, expect, test } from 'vitest'
import { LadderGame, matchLadderPlayers, parseLadderManifest, rankFromBucket } from './ladder'

const game: LadderGame = {
  matchId: 'MM-1',
  createdMs: 1_700_000_000_000,
  season: 20,
  players: [
    { name: 'Kestrel', race: 'p', mmr: 1850, rank: 'c' },
    { name: 'Wren', race: 'z', mmr: 1790, rank: 'c' },
  ],
}

describe('common/games/ladder', () => {
  test('reads a bucket as a rank, from F at 1 to S at 7', () => {
    expect(rankFromBucket(1)).toBe('f')
    expect(rankFromBucket(4)).toBe('c')
    expect(rankFromBucket(7)).toBe('s')
    expect(rankFromBucket(0)).toBeUndefined()
    expect(rankFromBucket(8)).toBeUndefined()
    expect(rankFromBucket(undefined)).toBeUndefined()
  })

  test('reads a manifest, leaving out games that are missing something', () => {
    const manifest = parseLadderManifest({
      version: 1,
      games: {
        'a.rep': game,
        'b.rep': { ...game, players: [{ name: 'Wren', race: 'z' }] },
        'c.rep': { ...game, matchId: undefined },
        'd.rep': { ...game, players: [{ ...game.players[0], rank: 'x', race: 'r' }] },
      },
    })
    expect(Object.keys(manifest?.games ?? {})).toEqual(['a.rep', 'd.rep'])
    expect(manifest?.games['d.rep'].players[0]).toEqual({
      name: 'Kestrel',
      race: undefined,
      mmr: 1850,
      rank: undefined,
    })
  })

  test("doesn't read a manifest of another version", () => {
    expect(parseLadderManifest({ version: 2, games: {} })).toBeUndefined()
    expect(parseLadderManifest(null)).toBeUndefined()
  })

  test('finds a player by name, whatever its case', () => {
    const [wren] = matchLadderPlayers(game, [{ names: ['wren'], race: 'z' }])
    expect(wren?.mmr).toBe(1790)
  })

  test('finds a player by race when the names differ and the races tell them apart', () => {
    const [kestrel] = matchLadderPlayers(game, [
      { names: ['???'], race: 'p' },
      { names: ['Unrated'], race: 'z' },
      { names: ['Unrated too'], race: 'z' },
    ])
    expect(kestrel?.name).toBe('Kestrel')
    const mirror = { ...game, players: game.players.map(p => ({ ...p, race: 'z' as const })) }
    expect(
      matchLadderPlayers(mirror, [
        { names: ['???'], race: 'z' },
        { names: ['!!!'], race: 'z' },
      ]),
    ).toEqual([undefined, undefined])
  })

  test('finds a renamed player as the last one left, in a game of matching races', () => {
    const team: LadderGame = {
      ...game,
      players: [
        { name: 'Kestrel', race: 'z', mmr: 1850 },
        { name: 'Wren', race: 'z', mmr: 1790 },
        { name: 'Finch', mmr: 1700 },
        { name: 'Heron', mmr: 1650 },
      ],
    }
    const players = [
      { names: ['Kestrel'], race: 'z' as const },
      { names: ['OldWren'], race: 'z' as const },
      { names: ['Finch'], race: 't' as const },
      { names: ['OldHeron'], race: 'p' as const },
    ]
    // Wren is the only Zerg left, and Heron the last one left after that.
    expect(matchLadderPlayers(team, players).map(p => p?.name)).toEqual([
      'Kestrel',
      'Wren',
      'Finch',
      'Heron',
    ])
    // A Zerg not on the ladder could be Wren as well as OldWren, so neither is matched.
    expect(
      matchLadderPlayers(team, [...players, { names: ['Unrated'], race: 'z' }]).map(p => p?.name),
    ).toEqual(['Kestrel', undefined, 'Finch', undefined, undefined])
  })
})
