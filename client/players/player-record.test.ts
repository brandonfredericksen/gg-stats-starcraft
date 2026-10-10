import { describe, expect, test } from 'vitest'
import { GameStatsResult, GameStatsSummary } from '../../common/games/game-stats'
import { ReplayLibraryEntry } from '../../common/replays-library'
import { tallyPlayerRecord } from './player-record'

function entry(
  id: number,
  players: Array<[name: string, team: number]>,
  gameTime = id * 1000,
): ReplayLibraryEntry {
  return {
    id,
    path: `C:\\replays\\${id}.rep`,
    fileName: `${id}.rep`,
    fileSize: 1,
    gameTime,
    mapName: 'Polypoid',
    gameType: 2,
    durationFrames: 14_000,
    parseError: false,
    players: players.map(([name, team], slot) => ({
      slot,
      team,
      name,
      race: 'p',
      isComputer: false,
    })),
  }
}

function summary(results: Array<[name: string, team: number, result: GameStatsResult]>) {
  return {
    gameId: 'g',
    complete: true,
    durationMs: 600_000,
    players: results.map(([name, team, result]) => ({
      name,
      names: [name],
      team,
      result,
      totalScore: 0,
      resourcesMined: 0,
    })),
  } satisfies GameStatsSummary
}

describe('client/players/player-record', () => {
  test('tallies games against and with a person across their accounts', () => {
    const entries = [
      entry(1, [
        ['Me', 1],
        ['Mordant', 2],
      ]),
      entry(2, [
        ['Me', 1],
        ['M0rdant', 2],
      ]),
      entry(3, [
        ['Me', 1],
        ['Mordant', 1],
        ['A', 2],
        ['B', 2],
      ]),
      entry(4, [
        ['Me', 1],
        ['Mordant', 2],
      ]),
    ]
    const summaries = {
      [entries[0].path]: summary([
        ['Me', 1, 'win'],
        ['Mordant', 2, 'loss'],
      ]),
      [entries[1].path]: summary([
        ['Me', 1, 'loss'],
        ['M0rdant', 2, 'win'],
      ]),
      [entries[2].path]: summary([
        ['Me', 1, 'win'],
        ['Mordant', 1, 'win'],
        ['A', 2, 'loss'],
        ['B', 2, 'loss'],
      ]),
    }

    const record = tallyPlayerRecord(entries, summaries, ['me'], ['mordant', 'M0RDANT'])
    expect(record.against).toEqual({ wins: 1, losses: 1, unknown: 1 })
    expect(record.with).toEqual({ wins: 1, losses: 0, unknown: 0 })
    expect(record.accounts).toEqual([
      { name: 'Mordant', games: 3 },
      { name: 'M0rdant', games: 1 },
    ])
    expect(record.lastPlayedMs).toBe(4000)
  })

  test('counts a game the user left as a loss', () => {
    const entries = [
      entry(1, [
        ['Me', 1],
        ['Foe', 2],
      ]),
    ]
    const left = {
      ...summary([
        ['Me', 1, 'unknown'],
        ['Foe', 2, 'unknown'],
      ]),
      complete: false,
    }
    const record = tallyPlayerRecord(entries, { [entries[0].path]: left }, ['Me'], ['Foe'])
    expect(record.against).toEqual({ wins: 0, losses: 1, unknown: 0 })
  })

  test("takes the team's result when the user has none, and finds them sharing control", () => {
    const entries = [
      entry(1, [
        ['Me', 1],
        ['Ally', 1],
        ['Foe', 2],
        ['Foe2', 2],
      ]),
      entry(2, [
        ['Me', 1],
        ['Ally', 1],
        ['Foe', 2],
        ['Foe2', 2],
      ]),
    ]
    const shared = summary([])
    shared.players.push(
      {
        name: 'Ally + Me',
        names: ['Ally', 'Me'],
        team: 1,
        result: 'win',
        totalScore: 0,
        resourcesMined: 0,
      },
      {
        name: 'Foe + Foe2',
        names: ['Foe', 'Foe2'],
        team: 2,
        result: 'loss',
        totalScore: 0,
        resourcesMined: 0,
      },
    )
    const summaries = {
      [entries[0].path]: summary([
        ['Me', 1, 'unknown'],
        ['Ally', 1, 'win'],
        ['Foe', 2, 'loss'],
        ['Foe2', 2, 'loss'],
      ]),
      [entries[1].path]: shared,
    }
    const record = tallyPlayerRecord(entries, summaries, ['Me'], ['Foe'])
    expect(record.against).toEqual({ wins: 2, losses: 0, unknown: 0 })
  })

  test("skips games the user or the person wasn't in", () => {
    const entries = [
      entry(1, [
        ['Other', 1],
        ['Foe', 2],
      ]),
      entry(2, [
        ['Me', 1],
        ['Other', 2],
      ]),
    ]
    const record = tallyPlayerRecord(entries, {}, ['Me'], ['Foe'])
    expect(record.against).toEqual({ wins: 0, losses: 0, unknown: 0 })
    expect(record.accounts).toEqual([])
  })
})
