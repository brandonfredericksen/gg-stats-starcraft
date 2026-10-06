import { describe, expect, test } from 'vitest'
import { withAssumedResults } from './assumed-results'
import { GameStatsResult } from './game-stats'

function player(
  name: string,
  team: number,
  result: GameStatsResult = 'unknown',
  leftAtMs?: number,
) {
  return { name, team, result, leftAtMs }
}

const results = (players: ReadonlyArray<{ name: string; result: GameStatsResult }>) =>
  Object.fromEntries(players.map(p => [p.name, p.result]))

describe('common/games/assumed-results', () => {
  test("gives the user's team a loss and the other a win when the user's replay stopped early", () => {
    const players = [player('Me', 1), player('Ally', 1), player('Foe', 2), player('Foe2', 2)]
    expect(results(withAssumedResults(players, false, ['me']))).toEqual({
      Me: 'loss',
      Ally: 'loss',
      Foe: 'win',
      Foe2: 'win',
    })
  })

  test('counts leaving before the end as a loss even when the replay covers the whole game', () => {
    const players = [player('Me', 0, 'unknown', 60_000), player('Foe', 0)]
    expect(results(withAssumedResults(players, true, ['Me']))).toEqual({ Me: 'loss', Foe: 'win' })
  })

  test('only gives the user a loss in a free for all', () => {
    const players = [player('Me', 0), player('A', 0), player('B', 0)]
    expect(results(withAssumedResults(players, false, ['Me']))).toEqual({
      Me: 'loss',
      A: 'unknown',
      B: 'unknown',
    })
  })

  test('gives the other side the opposite result when only one side has one', () => {
    const lost = [player('A', 1, 'loss'), player('B', 1), player('C', 2), player('D', 2)]
    expect(results(withAssumedResults(lost, true, ['Me']))).toEqual({
      A: 'loss',
      B: 'unknown',
      C: 'win',
      D: 'win',
    })

    const won = [player('Me', 0, 'win'), player('Foe', 0)]
    expect(results(withAssumedResults(won, true, ['Me']))).toEqual({ Me: 'win', Foe: 'loss' })

    const ffa = [player('A', 0, 'loss'), player('B', 0), player('C', 0)]
    expect(withAssumedResults(ffa, true, ['Me'])).toBe(ffa)
  })

  test('leaves games with a result, games without the user, and games the user finished alone', () => {
    const decided = [player('Me', 1, 'win'), player('Foe', 2, 'loss')]
    expect(withAssumedResults(decided, false, ['Me'])).toBe(decided)

    const others = [player('A', 1), player('B', 2)]
    expect(withAssumedResults(others, false, ['Me'])).toBe(others)

    const finished = [player('Me', 1), player('Foe', 2)]
    expect(withAssumedResults(finished, true, ['Me'])).toBe(finished)
  })
})
