import { describe, expect, test } from 'vitest'
import { LiveGamePlayer } from '../../common/live-game'
import { PlayerScout, ScoutMatchup } from '../../common/my-stats/player-scout'
import { emptyPlaystyleCounts } from '../../common/my-stats/playstyle'
import {
  getCheeseRate,
  getGameKind,
  getKindRecord,
  getPlaystyle,
  getTeams,
  getUsualBuilds,
} from './live-game-summary'

function person(name: string, player: Partial<LiveGamePlayer> = {}, isMe = false) {
  return { player: { name, ...player }, isMe }
}

function matchup(overrides: Partial<ScoutMatchup>): ScoutMatchup {
  return {
    shape: '1v1',
    race: 'p',
    teammateRaces: [],
    opponentRaces: [],
    games: 0,
    wins: 0,
    losses: 0,
    builds: [],
    unnamed: { games: 0, wins: 0, losses: 0 },
    ...overrides,
  }
}

function scout(matchups: ScoutMatchup[], playstyles: PlayerScout['playstyles'] = []): PlayerScout {
  return {
    totals: { games: 20, record: { games: 20, wins: 12, losses: 8 }, recent: [] },
    races: [],
    matchups,
    playstyles,
    fromBaseline: 0,
  }
}

const build = (family: string, games: number) => ({ family, games, wins: 0, losses: 0 })

describe('client/live-game/live-game-summary', () => {
  test('puts the user on the first side, by the teams the game gave', () => {
    const people = [
      person('a', { team: 0 }),
      person('b', { team: 1 }, true),
      person('c', { team: 0 }),
      person('d', { observer: true }),
    ]
    expect(
      getTeams(people, { source: 'shieldBattery' }).map(side => side.map(p => p.player.name)),
    ).toEqual([['b'], ['a', 'c']])
  })

  test('without teams, splits off the user only on the ladder or in a game of two', () => {
    const people = [person('a', {}, true), person('b'), person('c'), person('d')]
    const names = (sides: ReturnType<typeof getTeams>) => sides.map(s => s.map(p => p.player.name))
    expect(names(getTeams(people, { source: 'ladder' }))).toEqual([['a'], ['b', 'c', 'd']])
    expect(names(getTeams(people, { source: 'shieldBattery' }))).toEqual([['a', 'b', 'c', 'd']])
    expect(names(getTeams(people.slice(0, 2), { source: 'shieldBattery' }))).toEqual([['a'], ['b']])
  })

  test('keeps the players opened in a match on one side until it loads', () => {
    const matchFound = { playerCount: 6, accepted: 6, phase: 'drafting' as const }
    const people = [person('a'), person('b')]
    expect(getTeams(people, { source: 'shieldBattery', matchFound })).toEqual([people])
    expect(getGameKind([people], { matchFound }).shape).toBe('3v3')
    expect(getGameKind([people], { matchFound: { ...matchFound, playerCount: 2 } }).shape).toBe(
      '1v1',
    )
  })

  test("names the kind of game, and the map's for 3v3", () => {
    expect(getGameKind([[1], [2]], undefined)).toEqual({ shape: '1v1', mapFamily: undefined })
    expect(
      getGameKind(
        [
          [1, 2, 3],
          [4, 5, 6],
        ],
        { mapName: 'Big Game Hunters 26.5' },
      ),
    ).toEqual({
      shape: '3v3',
      mapFamily: 'bgh',
    })
    expect(getGameKind([[1], [2], [3]], undefined).shape).toBe('ffa')
  })

  test('takes builds against the races being played, then the kind of game, then any', () => {
    const player = scout([
      matchup({ opponentRaces: ['z'], builds: [build('p forgeExpand', 5)] }),
      matchup({
        opponentRaces: ['t'],
        builds: [build('p gates1 expand', 3), build('p gates2', 3)],
      }),
      matchup({ shape: '3v3', mapFamily: 'bgh', builds: [build('p gates2 gate3', 4)] }),
    ])
    const oneVOne = { shape: '1v1' as const }
    expect(getUsualBuilds(player, 'p', oneVOne, ['z'])).toEqual({
      builds: [{ family: 'p forgeExpand', games: 5 }],
      of: 5,
      scope: 'matchup',
    })
    // Neither build is most of their games, so both show.
    expect(getUsualBuilds(player, 'p', oneVOne, ['t'])?.builds.map(b => b.family)).toEqual([
      'p gates1 expand',
      'p gates2',
    ])
    expect(getUsualBuilds(player, 'p', oneVOne, ['p'])?.scope).toBe('kind')
    expect(getUsualBuilds(player, 'p', { shape: '2v2' }, [])?.scope).toBe('race')
    expect(getUsualBuilds(player, 'z', oneVOne, ['t'])).toBeUndefined()
  })

  test('counts the record in this kind of game, or all games without any', () => {
    const player = scout([
      matchup({ games: 4, wins: 3, losses: 1 }),
      matchup({ shape: '3v3', mapFamily: 'bgh', games: 2, wins: 0, losses: 2 }),
    ])
    expect(getKindRecord(player, { shape: '1v1' })).toEqual({
      games: 4,
      wins: 3,
      losses: 1,
      allGames: false,
    })
    expect(getKindRecord(player, { shape: '2v2' }).allGames).toBe(true)
  })

  test('sums up how they play in this kind of game and map', () => {
    const counts = (cheese: number, standard: number) => ({
      ...emptyPlaystyleCounts(),
      cheese,
      standard,
    })
    const player = scout(
      [],
      [
        { shape: '3v3', mapFamily: 'bgh', race: 'z', counts: counts(0, 5) },
        { shape: '3v3', mapFamily: 'fastest', race: 'z', counts: counts(4, 1) },
      ],
    )
    expect(getPlaystyle(player, 'z', { shape: '3v3', mapFamily: 'bgh' })?.style).toBe('standard')
    expect(getPlaystyle(player, 'z', { shape: '3v3', mapFamily: 'fastest' })?.style).toBe('cheese')
  })

  test('counts cheese in this kind of game, or as the race anywhere with too few of them', () => {
    const counts = (cheese: number, standard: number) => ({
      ...emptyPlaystyleCounts(),
      cheese,
      standard,
    })
    const player = scout(
      [],
      [
        { shape: '1v1', race: 'z', counts: counts(1, 9) },
        { shape: '2v2', race: 'z', counts: counts(2, 0) },
        { shape: '1v1', race: 't', counts: counts(5, 0) },
      ],
    )
    expect(getCheeseRate(player, 'z', { shape: '1v1' })).toEqual({
      cheese: 1,
      games: 10,
      cheeser: false,
    })
    expect(getCheeseRate(player, 'z', { shape: '2v2' })).toEqual({
      cheese: 3,
      games: 12,
      cheeser: true,
    })
    expect(getCheeseRate(player, 't', { shape: '1v1' })?.cheeser).toBe(true)
    expect(getCheeseRate(player, 'p', { shape: '1v1' })).toBeUndefined()
  })
})
