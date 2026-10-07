import { describe, expect, test } from 'vitest'
import { computeCoach } from './coach'
import { DEMO_PLAYER_NAME, generateDemoGames } from './demo-player'
import { computeMyStats } from './my-stats'

const NOW = Date.UTC(2026, 9, 6)
const names = [DEMO_PLAYER_NAME]

describe('common/my-stats/demo-player', () => {
  const games = generateDemoGames(NOW)

  test('makes the same games every time', () => {
    expect(generateDemoGames(NOW)).toEqual(games)
  })

  test('has games of every type, all of them the demo player in it', () => {
    const stats = computeMyStats(games, { names, range: 'all' }, NOW)
    expect(stats.games).toBe(games.length)
    expect(new Set(games.map(g => g.shape))).toEqual(new Set(['1v1', '2v2', '3v3', '4v4', 'ffa']))
  })

  test('groups the many titles of a map into one row each', () => {
    const maps = (shape: '1v1' | '2v2') =>
      computeMyStats(games, { names, range: 'all', shape }, NOW).maps.filter(
        m => m.family === 'standard',
      )
    expect(maps('1v1')).toHaveLength(25)
    expect(maps('2v2').length).toBeLessThanOrEqual(15)
    expect(maps('1v1')[0]).toMatchObject({ mapName: 'Fighting Spirit' })
    expect(maps('1v1').map(m => m.mapName)).not.toContain('투혼')
  })

  test.each([
    ['1v1', { race: 'p', opponentRace: 'z' }],
    ['1v1', { race: 'p', opponentRace: 't' }],
    ['1v1', { race: 'p', opponentRace: 'p' }],
    ['2v2', { race: 'p' }],
    ['3v3', { race: 'p', mapFamily: 'bgh' }],
    ['3v3', { race: 'p', mapFamily: 'fastest' }],
    ['4v4', { race: 'p', mapFamily: 'bgh' }],
    ['4v4', { race: 'p', mapFamily: 'fastest' }],
  ] as const)('gives the coach enough %s games %o', (shape, scope) => {
    const coach = computeCoach(games, { names, shape, ...scope, window: 'all' })
    if (coach.status !== 'ready') {
      throw new Error('Expected a ready coach')
    }
    expect(coach.scope).toMatchObject({ shape, ...scope })
    const [bucket] = coach.buckets
    expect(bucket.userGames).toBeGreaterThanOrEqual(10)
    expect(bucket.poolGames).toBeGreaterThanOrEqual(30)
    expect(bucket.compared.length).toBeGreaterThan(0)
  })
})
