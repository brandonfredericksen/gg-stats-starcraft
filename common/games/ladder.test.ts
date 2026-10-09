import { describe, expect, test } from 'vitest'
import { findLadderPlayer, LadderGame, parseLadderManifest, rankFromBucket } from './ladder'

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
    expect(findLadderPlayer(game, ['wren'], 'z')?.mmr).toBe(1790)
  })

  test('finds a player by race when the names differ and the races tell them apart', () => {
    expect(findLadderPlayer(game, ['???'], 'p')?.name).toBe('Kestrel')
    const mirror = { ...game, players: game.players.map(p => ({ ...p, race: 'z' as const })) }
    expect(findLadderPlayer(mirror, ['???'], 'z')).toBeUndefined()
  })
})
