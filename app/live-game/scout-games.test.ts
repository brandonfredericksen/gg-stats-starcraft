import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  CHECKPOINT_MINUTES,
  GAME_METRICS_VERSION,
  PlayerMetrics,
} from '../../common/games/player-metrics'
import { DatedGameMetrics } from '../../common/my-stats/my-stats'
import { indexByName, KEEP_GAMES_MS, ScoutGames } from './scout-games'

vi.mock('../logger', () => ({ default: { verbose: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

const empty = CHECKPOINT_MINUTES.map(() => null)

function player(names: string[], team: number, result: 'win' | 'loss'): PlayerMetrics {
  return {
    names,
    race: 'z',
    team,
    result,
    human: true,
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
  }
}

let nextId = 0

function game(
  winner: string,
  loser: string,
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
    shape: '1v1',
    players: [player([winner], 0, 'win'), player([loser], 1, 'loss')],
    gameTimeMs: nextId * 1000,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('indexByName', () => {
  test('lists each game once for each name in it, whatever its case', () => {
    const shared = game('Opp', 'Me')
    shared.players[0].names = ['Opp', 'opp']
    const index = indexByName([shared, game('Me', 'OPP')])
    expect(index.get('opp')).toHaveLength(2)
    expect(index.get('me')).toHaveLength(2)
    expect(index.get('Opp')).toBeUndefined()
  })
})

describe('ScoutGames', () => {
  function setup(own: DatedGameMetrics[], baseline?: DatedGameMetrics[]) {
    const loadOwnGames = vi.fn(async () => ({ games: own, replayPathKeys: [] }))
    let loadedBaseline = baseline
    const scoutGames = new ScoutGames({ loadOwnGames, loadedBaseline: () => loadedBaseline })
    return {
      scoutGames,
      loadOwnGames,
      loadBaseline: (games: DatedGameMetrics[]) => {
        loadedBaseline = games
      },
    }
  }

  test("sums up each person's games, across every account they play under", async () => {
    const { scoutGames } = setup([game('Main', 'Me'), game('Me', 'Smurf'), game('Other', 'Me')])
    const [person, stranger] = await scoutGames.scout([['main', 'smurf'], ['Nobody']])
    expect(person).toMatchObject({ games: 2, wins: 1, losses: 1 })
    expect(stranger.games).toBe(0)
  })

  test("adds the baseline's games once it's been read, but not the user's own copies", async () => {
    const copy = game('Pro', 'Me')
    const { scoutGames, loadBaseline } = setup([copy])
    expect((await scoutGames.scout([['Pro']]))[0].games).toBe(1)
    loadBaseline([{ ...copy, gameId: 'baseline-copy' }, game('Pro', 'Someone')])
    expect((await scoutGames.scout([['Pro']]))[0]).toMatchObject({ games: 2, fromBaseline: 0 })
  })

  test('reads the games once for a while, then again', async () => {
    const { scoutGames, loadOwnGames } = setup([game('Opp', 'Me')])
    await scoutGames.scout([['Opp']])
    await scoutGames.scout([['Me']])
    expect(loadOwnGames).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(KEEP_GAMES_MS)
    await scoutGames.scout([['Opp']])
    expect(loadOwnGames).toHaveBeenCalledTimes(2)
  })

  test('reads the games again when told they changed, or after reading them failed', async () => {
    const { scoutGames, loadOwnGames } = setup([game('Opp', 'Me')])
    await scoutGames.scout([['Opp']])
    scoutGames.forget()
    await scoutGames.scout([['Opp']])
    expect(loadOwnGames).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)

    loadOwnGames.mockRejectedValueOnce(new Error('busy'))
    scoutGames.forget()
    await expect(scoutGames.scout([['Opp']])).rejects.toThrow('busy')
    await scoutGames.scout([['Opp']])
    expect(loadOwnGames).toHaveBeenCalledTimes(4)
  })
})
