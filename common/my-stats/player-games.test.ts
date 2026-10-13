import { describe, expect, test } from 'vitest'
import { GameMetrics, PlayerMetrics } from '../games/player-metrics'
import { findMe, makeScriptedCheck } from './player-games'

/** A player with only what telling programs apart reads. */
function player(name: string, burstShare?: number) {
  return { names: [name], burstShare } as PlayerMetrics
}

function games(...players: PlayerMetrics[]) {
  return players.map(p => ({ players: [p] }) as unknown as GameMetrics)
}

describe('common/my-stats/player-games', () => {
  test('tells the games a program played from the bursts of commands in them', () => {
    const isScripted = makeScriptedCheck([])
    expect(isScripted(player('Bisu', 0.02))).toBe(false)
    expect(isScripted(player('Bisu', 0.6))).toBe(true)
    expect(isScripted(player('Bisu'))).toBe(false)
  })

  test('counts every game of a player a program played at least half the games of', () => {
    const quiet = player('Macro', 0.05)
    const isScripted = makeScriptedCheck(
      games(player('Macro', 0.7), player('MACRO', 0.5), quiet, player('Macro', 0.01)),
    )
    expect(isScripted(quiet)).toBe(true)
  })

  test('only counts the games it shows in, for a player it played fewer of', () => {
    const odd = player('Stork', 0.3)
    const usual = player('Stork', 0.01)
    const isScripted = makeScriptedCheck(games(odd, usual, player('Stork', 0.02)))
    expect(isScripted(odd)).toBe(true)
    expect(isScripted(usual)).toBe(false)
  })

  test('finds the user in games against people, not in games with a computer', () => {
    const me = { names: ['Flash'], human: true } as PlayerMetrics
    const person = { names: ['Jaedong'], human: true } as PlayerMetrics
    const computer = { names: ['Zerg'], human: false } as PlayerMetrics
    const game = (...players: PlayerMetrics[]) => ({ players }) as unknown as GameMetrics
    expect(findMe(game(me, person), ['flash'])).toBe(me)
    expect(findMe(game(me, computer), ['flash'])).toBe(undefined)
    expect(findMe(game(me, person), ['bisu'])).toBe(undefined)
  })
})
