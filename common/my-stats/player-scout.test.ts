import { describe, expect, test } from 'vitest'
import { GameStatsResult } from '../games/game-stats'
import {
  CHECKPOINT_MINUTES,
  GAME_METRICS_VERSION,
  GameShape,
  PlayerMetrics,
} from '../games/player-metrics'
import { AssignedRaceChar } from '../races'
import { DatedGameMetrics } from './my-stats'
import { computePlayerScout } from './player-scout'

const empty = CHECKPOINT_MINUTES.map(() => null)
/** Gateway, Core, then a Nexus. */
const GATE_EXPAND: Array<[string, number]> = [
  ['u160', 1.2],
  ['u164', 2],
  ['u154', 3],
]
/** Forge, Nexus, Cannon, Gateway. */
const FORGE_EXPAND: Array<[string, number]> = [
  ['u166', 1.2],
  ['u154', 1.9],
  ['u162', 2.2],
  ['u160', 2.6],
]

function player(
  name: string,
  race: AssignedRaceChar,
  team: number,
  result: GameStatsResult,
  overrides: Partial<PlayerMetrics> = {},
  steps: Array<[string, number]> = [],
): PlayerMetrics {
  return {
    names: [name],
    race,
    team,
    result,
    human: true,
    apm: 200,
    eapm: 150,
    workers: CHECKPOINT_MINUTES.map(() => 30),
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
    buildSteps: steps.map(([key, minutes]) => ({ key, timeMs: minutes * 60_000, supply: 10 })),
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
    durationMs: 15 * 60_000,
    complete: true,
    mapName: 'Polypoid',
    mapFamily: 'standard',
    shape,
    players,
    gameTimeMs: nextId * 1000,
    ...overrides,
  }
}

describe('computePlayerScout', () => {
  test('sums up their games from their side, by matchup and build', () => {
    const games = [
      game('1v1', [
        player('Opp', 'p', 0, 'win', { apm: 300, eapm: 200 }, GATE_EXPAND),
        player('Me', 't', 1, 'loss'),
      ]),
      game('1v1', [
        player('opp', 'p', 0, 'loss', { apm: 100, eapm: 100 }, GATE_EXPAND),
        player('Me', 't', 1, 'win'),
      ]),
      game('1v1', [
        player('OPP', 'p', 0, 'win', {}, FORGE_EXPAND),
        player('Someone', 'z', 1, 'loss'),
      ]),
      game('1v1', [player('Opp', 'p', 0, 'win', {}, []), player('Me', 't', 1, 'loss')]),
    ]
    const scout = computePlayerScout(games, ['Opp'])
    expect(scout).toMatchObject({
      games: 4,
      wins: 3,
      losses: 1,
      races: [{ race: 'p', games: 4 }],
      lastPlayedMs: games[3].gameTimeMs,
      fromBaseline: 0,
    })
    expect(scout.apm).toEqual({ value: 200, games: 4 })
    expect(scout.matchups.map(m => [m.opponentRaces.join(''), m.games, m.unnamed.games])).toEqual([
      ['t', 3, 1],
      ['z', 1, 0],
    ])
    const pvt = scout.matchups[0]
    expect(pvt.builds).toHaveLength(1)
    expect(pvt.builds[0]).toMatchObject({ games: 2, wins: 1, losses: 1 })
    expect(pvt.builds[0].family.startsWith('p ')).toBe(true)
    expect(scout.matchups[1].builds[0].family).not.toBe(pvt.builds[0].family)
  })

  test('counts every account the person plays under', () => {
    const games = [
      game('1v1', [player('Main', 'z', 0, 'win'), player('Me', 't', 1, 'loss')]),
      game('1v1', [player('Smurf', 'z', 0, 'loss'), player('Me', 't', 1, 'win')]),
      game('1v1', [player('Stranger', 'z', 0, 'loss'), player('Me', 't', 1, 'win')]),
    ]
    expect(computePlayerScout(games, ['main', 'SMURF'])).toMatchObject({ games: 2, wins: 1 })
  })

  test("splits team games by the opposing team's races, and counts team results", () => {
    const games = [
      game('2v2', [
        player('Opp', 'z', 0, 'unknown'),
        player('Ally', 'p', 0, 'win'),
        player('A', 't', 1, 'loss'),
        player('B', 'p', 1, 'loss'),
      ]),
    ]
    const scout = computePlayerScout(games, ['Opp'])
    expect(scout).toMatchObject({ games: 1, wins: 1 })
    expect(scout.matchups[0]).toMatchObject({
      shape: '2v2',
      race: 'z',
      teammateRaces: ['p'],
      opponentRaces: ['p', 't'],
      mapFamily: undefined,
    })
  })

  test('splits 3v3 by the kind of map, as the Builds page does', () => {
    const team = (name: string, result: GameStatsResult) => [
      player(name, 'z', 0, result),
      player(`${name}2`, 'p', 0, result),
      player(`${name}3`, 't', 0, result),
    ]
    const foes = [
      player('A', 'z', 1, 'loss'),
      player('B', 'z', 1, 'loss'),
      player('C', 'z', 1, 'loss'),
    ]
    const games = [
      game('3v3', [...team('Opp', 'win'), ...foes], { mapFamily: 'bgh' }),
      game('3v3', [...team('Opp', 'win'), ...foes], { mapFamily: 'fastest' }),
    ]
    expect(
      computePlayerScout(games, ['Opp'])
        .matchups.map(m => m.mapFamily)
        .sort(),
    ).toEqual(['bgh', 'fastest'])
  })

  test('tallies the results of games whose build has no name', () => {
    const games = [
      game('1v1', [player('Opp', 'z', 0, 'win'), player('Me', 't', 1, 'loss')]),
      game('1v1', [player('Opp', 'z', 0, 'loss'), player('Me', 't', 1, 'win')]),
    ]
    expect(computePlayerScout(games, ['Opp']).matchups[0].unnamed).toEqual({
      games: 2,
      wins: 1,
      losses: 1,
    })
  })

  test('leaves out games with computers, and counts ladder baseline games', () => {
    const games = [
      game('1v1', [player('Opp', 'z', 0, 'win'), player('Bot', 't', 1, 'loss', { human: false })]),
      game('1v1', [player('Opp', 'z', 0, 'win'), player('Pro', 't', 1, 'loss')], {
        ladderBaseline: true,
      }),
    ]
    expect(computePlayerScout(games, ['Opp'])).toMatchObject({ games: 1, fromBaseline: 1 })
  })

  test('is empty for someone with no games', () => {
    expect(computePlayerScout([], ['Nobody'])).toEqual({
      games: 0,
      wins: 0,
      losses: 0,
      apm: undefined,
      eapm: undefined,
      races: [],
      matchups: [],
      fromBaseline: 0,
    })
  })
})
