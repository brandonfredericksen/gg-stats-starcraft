import { describe, expect, test } from 'vitest'
import { getSideResult, withAssumedResults } from './assumed-results'
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
  test('gives the user a loss when their replay stopped early, but not their teammates', () => {
    const players = [player('Me', 1), player('Ally', 1), player('Foe', 2), player('Foe2', 2)]
    expect(results(withAssumedResults(players, false, ['me']))).toEqual({
      Me: 'loss',
      Ally: 'unknown',
      Foe: 'unknown',
      Foe2: 'unknown',
    })

    const allyOut = [
      player('Me', 1),
      player('Ally', 1, 'loss'),
      player('Foe', 2),
      player('Foe2', 2),
    ]
    expect(results(withAssumedResults(allyOut, false, ['me']))).toEqual({
      Me: 'loss',
      Ally: 'loss',
      Foe: 'win',
      Foe2: 'win',
    })

    const one = [player('Me', 1), player('Foe', 2)]
    expect(results(withAssumedResults(one, false, ['me']))).toEqual({ Me: 'loss', Foe: 'win' })
  })

  test("doesn't give a team a loss while any of it plays on", () => {
    const players = [
      player('A', 1, 'loss'),
      player('B', 1, 'unknown', 120_000),
      player('C', 1),
      player('D', 2),
      player('E', 2),
      player('F', 2),
    ]
    expect(withAssumedResults(players, false, ['Me'])).toBe(players)

    const allOut = [
      player('A', 1, 'loss'),
      player('B', 1, 'unknown', 120_000),
      player('C', 1, 'loss'),
      player('D', 2),
    ]
    expect(results(withAssumedResults(allOut, false, ['Me']))).toEqual({
      A: 'loss',
      B: 'unknown',
      C: 'loss',
      D: 'win',
    })
  })

  test('keeps a teammate who lost on a team that won as having lost', () => {
    const players = [player('A', 1, 'loss'), player('B', 1, 'win'), player('C', 2), player('D', 2)]
    expect(results(withAssumedResults(players, true, ['Me']))).toEqual({
      A: 'loss',
      B: 'win',
      C: 'loss',
      D: 'loss',
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
    const lost = [player('A', 1, 'loss'), player('B', 1, 'loss'), player('C', 2), player('D', 2)]
    expect(results(withAssumedResults(lost, true, ['Me']))).toEqual({
      A: 'loss',
      B: 'loss',
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

  test('decides a side once one of it won or all of it is out', () => {
    expect(getSideResult([{ result: 'loss' }, { result: 'win' }])).toBe('win')
    expect(getSideResult([{ result: 'loss' }, { result: 'unknown' }])).toBe('unknown')
    expect(getSideResult([{ result: 'loss' }, { result: 'unknown', leftAtMs: 1 }])).toBe('loss')
    expect(getSideResult([{ result: 'unknown', leftAtMs: 1 }])).toBe('loss')
    expect(getSideResult([{ result: 'unknown' }])).toBe('unknown')
  })
})
