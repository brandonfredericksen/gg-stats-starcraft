import { describe, expect, test } from 'vitest'
import { GameStatsResult } from '../games/game-stats'
import {
  CHECKPOINT_MINUTES,
  GAME_METRICS_VERSION,
  GameShape,
  PlayerMetrics,
} from '../games/player-metrics'
import { AssignedRaceChar } from '../races'
import { computeMyStats, DatedGameMetrics } from './my-stats'

const NOW = Date.UTC(2026, 9, 5)
const DAY = 24 * 60 * 60_000

function player(
  name: string,
  race: AssignedRaceChar,
  team: number,
  result: GameStatsResult,
  overrides: Partial<PlayerMetrics> = {},
): PlayerMetrics {
  const empty = CHECKPOINT_MINUTES.map(() => null)
  return {
    names: [name],
    race,
    team,
    result,
    human: true,
    apm: 200,
    eapm: 150,
    workers: empty,
    mined: empty,
    income: empty,
    armyScore: empty,
    bases: empty,
    production: empty,
    supplyTimesMs: [null, null, null],
    bank: [null, null, null],
    supplyBlockedShare: null,
    townHallTimesMs: [null, null],
    firstStartsMs: {},
    opening: [],
    firstArmyMs: null,
    ...overrides,
  }
}

let nextId = 0

function game(
  shape: GameShape,
  players: PlayerMetrics[],
  overrides: Partial<DatedGameMetrics> = {},
): DatedGameMetrics {
  nextId += 1
  return {
    version: GAME_METRICS_VERSION,
    gameId: `game-${nextId}`,
    durationMs: 12 * 60_000,
    complete: true,
    mapName: 'Polypoid',
    mapFamily: 'standard',
    shape,
    players,
    gameTimeMs: NOW - nextId * 60 * 60_000,
    ...overrides,
  }
}

const me = 'Kestrel'

describe('common/my-stats', () => {
  test("tallies the user's record and splits 1v1 by matchup", () => {
    const games = [
      game('1v1', [player(me, 'p', 0, 'win'), player('Mordant', 'z', 0, 'loss')]),
      game('1v1', [player(me, 'p', 0, 'loss'), player('Quarry', 't', 0, 'win')]),
      game('1v1', [
        player('kestrel', 'p', 0, 'win', { apm: 300 }),
        player('Mordant', 'z', 0, 'loss'),
      ]),
      // Not the user's game.
      game('1v1', [player('Flash', 't', 0, 'win'), player('Jaedong', 'z', 0, 'loss')]),
    ]
    const stats = computeMyStats(games, { names: [me], range: 'all' }, NOW)
    expect(stats.games).toBe(3)
    expect(stats.record).toEqual({ games: 3, wins: 2, losses: 1 })
    expect(stats.apm?.value).toBeCloseTo(700 / 3)
    expect(stats.byMatchup.map(r => [r.race, r.opponentRace, r.wins, r.losses])).toEqual([
      ['p', 't', 0, 1],
      ['p', 'z', 2, 0],
    ])
    expect(stats.opponents[0]).toMatchObject({ name: 'Mordant', games: 2 })
    expect(stats.teammates).toEqual([])
  })

  test('lists games of no usual shape in their own row, last', () => {
    const games = [
      game('other', [
        player(me, 'p', 0, 'win'),
        player('Ally', 't', 0, 'win'),
        player('Foe', 'z', 1, 'loss'),
      ]),
      game('2v2', [
        player(me, 'p', 0, 'loss'),
        player('Ally', 't', 0, 'loss'),
        player('Foe', 'z', 1, 'win'),
        player('Foe2', 'z', 1, 'win'),
      ]),
    ]
    const stats = computeMyStats(games, { names: [me], range: 'all' }, NOW)
    expect(stats.byMatchup.map(r => [r.shape, r.wins, r.losses])).toEqual([
      ['2v2', 0, 1],
      ['other', 1, 0],
    ])
  })

  test("takes the team's result when the user has none of their own", () => {
    const games = [
      game('2v2', [
        player(me, 'p', 0, 'unknown'),
        player('Ally', 't', 0, 'loss'),
        player('Foe', 'z', 1, 'unknown'),
        player('Foe2', 'z', 1, 'unknown'),
      ]),
    ]
    const stats = computeMyStats(games, { names: [me], range: 'all' }, NOW)
    expect(stats.record).toEqual({ games: 1, wins: 0, losses: 1 })
  })

  test('counts a team game the user left as a loss, even when their team won', () => {
    const games = [
      game('2v2', [
        player(me, 'p', 0, 'unknown', { leftAtMs: 9 * 60_000 }),
        player('Ally', 't', 0, 'win'),
        player('Foe', 'z', 1, 'loss'),
        player('Foe2', 'z', 1, 'loss'),
      ]),
    ]
    const stats = computeMyStats(games, { names: [me], range: 'all' }, NOW)
    expect(stats.record).toEqual({ games: 1, wins: 0, losses: 1 })
  })

  test('counts a game the user left as a loss', () => {
    const left = game(
      '1v1',
      [player(me, 't', 0, 'unknown', { leftAtMs: 60_000 }), player('Foe', 'z', 0, 'unknown')],
      { complete: false },
    )
    expect(computeMyStats([left], { names: [me], range: 'all' }, NOW).record.losses).toBe(1)
  })

  test('filters by time, game type, race and opponent race', () => {
    const games = [
      game('1v1', [player(me, 'p', 0, 'win'), player('A', 'z', 0, 'loss')]),
      game('1v1', [player(me, 'p', 0, 'win'), player('B', 't', 0, 'loss')]),
      game('1v1', [player(me, 'z', 0, 'win'), player('C', 't', 0, 'loss')]),
      game('1v1', [player(me, 'p', 0, 'win'), player('D', 'z', 0, 'loss')], {
        gameTimeMs: NOW - 40 * DAY,
      }),
      game('2v2', [
        player(me, 'p', 1, 'win'),
        player('Wren', 't', 1, 'win'),
        player('E', 'z', 2, 'loss'),
        player('F', 'z', 2, 'loss'),
      ]),
    ]
    const count = (query: object) =>
      computeMyStats(games, { names: [me], range: 'all', ...query }, NOW).games
    expect(count({})).toBe(5)
    expect(count({ range: '30d' })).toBe(4)
    expect(count({ shape: '1v1' })).toBe(4)
    expect(count({ race: 'p' })).toBe(4)
    expect(count({ shape: '1v1', race: 'p', opponentRace: 'z' })).toBe(2)
  })

  test('sums up team games', () => {
    const games = [
      game('2v2', [
        player(me, 'p', 1, 'loss', { leftAtMs: 1000, outOrder: 1, teamShare: share(0.4) }),
        player('Wren', 't', 1, 'loss', { teamShare: share(0.6) }),
        player('E', 'z', 2, 'win'),
        player('F', 'z', 2, 'win'),
      ]),
      game('2v2', [
        player(me, 'p', 1, 'win', { teamShare: share(0.6) }),
        player('Wren', 't', 1, 'win'),
        player('E', 'z', 2, 'loss'),
        player('G', 'p', 2, 'loss'),
      ]),
    ]
    const stats = computeMyStats(games, { names: [me], range: 'all' }, NOW)
    expect(stats.team?.any).toMatchObject({ losses: 1, firstOutLosses: 1 })
    expect(stats.team?.any?.incomeShare?.value).toBeCloseTo(0.5)
    expect(stats.team?.any?.byTeamRaces).toEqual([{ races: ['t'], games: 2, wins: 1, losses: 1 }])
    expect(stats.team?.p?.byTeamRaces).toHaveLength(1)
    expect(stats.team?.z).toBeUndefined()
    expect(stats.teammates).toEqual([
      expect.objectContaining({ name: 'Wren', races: [{ race: 't', games: 2 }], wins: 1 }),
    ])
    expect(stats.opponents.map(p => p.name)).toEqual(['E', 'F', 'G'])
  })

  test('groups money maps under one name and keeps the latest games', () => {
    const games = Array.from({ length: 25 }, (_, i) =>
      game('1v1', [player(me, 'p', 0, 'win'), player('X', 'z', 0, 'loss')], {
        mapName: i % 2 ? 'Fastest Possible 1.1' : 'Fastest Possible 1.2',
        mapFamily: 'fastest',
      }),
    )
    const stats = computeMyStats(games, { names: [me], range: 'all' }, NOW)
    expect(stats.maps).toHaveLength(1)
    expect(stats.maps[0]).toMatchObject({ family: 'fastest', games: 25 })
    expect(stats.recent).toHaveLength(20)
    // Oldest first, so the latest game is last.
    expect(stats.recent.at(-1)?.gameTimeMs).toBe(Math.max(...games.map(g => g.gameTimeMs)))
  })

  test('groups versions of a map under the one played most', () => {
    const names = ['Polypoid 1.65', 'Polypoid 1.75', 'Polypoid 1.75', '| iCCup | Eclipse 1.2']
    const games = names.map(mapName =>
      game('1v1', [player(me, 'p', 0, 'win'), player('X', 'z', 0, 'loss')], { mapName }),
    )
    const stats = computeMyStats(games, { names: [me], range: 'all' }, NOW)
    expect(stats.maps).toEqual([
      expect.objectContaining({ mapName: 'Polypoid', family: 'standard', games: 3 }),
      expect.objectContaining({ mapName: 'Eclipse', family: 'standard', games: 1 }),
    ])
  })
})

function share(income: number) {
  return { income, armyProduced: income, armyKilled: income }
}
