import { describe, expect, test } from 'vitest'
import { GameStatsSummary } from '../../common/games/game-stats'
import { ReplayLibraryPlayer } from '../../common/replays-library'
import { getGameModeLabel, getGameRowLines } from './game-row-lines'
import { getReplayDisplayTeams } from './replay-library-helpers'

function player(name: string, team: number, slot: number): ReplayLibraryPlayer {
  return { name, team, slot, race: 'p', isComputer: false }
}

function summary(
  results: Array<[name: string, result: 'win' | 'loss', leftAtMs?: number]>,
): GameStatsSummary {
  return {
    gameId: 'g',
    complete: true,
    durationMs: 600_000,
    players: results.map(([name, result, leftAtMs]) => ({
      name,
      names: [name],
      team: 0,
      result,
      leftAtMs,
      totalScore: 0,
      resourcesMined: 0,
    })),
  }
}

const TEAMS = getReplayDisplayTeams([
  player('A', 1, 0),
  player('B', 1, 1),
  player('C', 2, 2),
  player('D', 2, 3),
])
const FFA = getReplayDisplayTeams([
  player('A', 0, 0),
  player('B', 0, 1),
  player('C', 0, 2),
  player('D', 0, 3),
])

function names(lines: ReturnType<typeof getGameRowLines>) {
  return lines.map(l => `${l.result}:${l.players.map(p => p.name).join('')}`)
}

describe('client/replays/game-row-lines', () => {
  test('names the game type', () => {
    expect(getGameModeLabel(TEAMS)).toBe('2v2')
    expect(getGameModeLabel(FFA)).toBe('FFA')
    expect(getGameModeLabel(getReplayDisplayTeams([player('A', 0, 0), player('B', 0, 1)]))).toBe(
      '1v1',
    )
  })

  test('puts the winning team first', () => {
    const result = summary([
      ['A', 'loss'],
      ['B', 'loss'],
      ['C', 'win'],
      ['D', 'win'],
    ])
    expect(names(getGameRowLines(TEAMS, result, false))).toEqual(['won:CD', 'lost:AB'])
  })

  test('finds the result of players sharing control under each of their names', () => {
    const shared: GameStatsSummary = {
      ...summary([]),
      players: [
        {
          name: 'A + B',
          names: ['A', 'B'],
          team: 1,
          result: 'loss',
          totalScore: 0,
          resourcesMined: 0,
        },
        {
          name: 'C + D',
          names: ['C', 'D'],
          team: 2,
          result: 'win',
          totalScore: 0,
          resourcesMined: 0,
        },
      ],
    }
    expect(names(getGameRowLines(TEAMS, shared, false))).toEqual(['won:CD', 'lost:AB'])
  })

  test('keeps replay order without a result, or with results hidden', () => {
    const result = summary([
      ['C', 'win'],
      ['A', 'loss'],
    ])
    expect(names(getGameRowLines(TEAMS, undefined, false))).toEqual(['hidden:AB', 'hidden:CD'])
    expect(names(getGameRowLines(TEAMS, result, true))).toEqual(['hidden:AB', 'hidden:CD'])
  })

  test('lists FFA as the winner, then everyone else in finishing order', () => {
    const result = summary([
      ['A', 'loss', 1000],
      ['B', 'win'],
      ['C', 'loss', 5000],
      ['D', 'loss', 3000],
    ])
    expect(names(getGameRowLines(FFA, result, false))).toEqual(['won:B', 'lost:CDA'])
    expect(names(getGameRowLines(FFA, result, true))).toEqual(['hidden:ABCD'])
  })
})
