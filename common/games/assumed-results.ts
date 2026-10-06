import { GameStatsResult } from './game-stats'
import { isMyPlayerName } from './player-names'

/**
 * A side's result from its players': a win if any of them won, otherwise a loss if any lost. In a
 * team game one teammate's result decides the team's, since the others may have left or been cut
 * off before the replay recorded theirs.
 */
export function getSideResult(
  players: ReadonlyArray<{ result: GameStatsResult }>,
): GameStatsResult {
  if (players.some(p => p.result === 'win')) {
    return 'win'
  }
  return players.some(p => p.result === 'loss') ? 'loss' : 'unknown'
}

interface ResultPlayer {
  name: string
  team: number
  result: GameStatsResult
  leftAtMs?: number
}

/**
 * Fills in results a replay doesn't have. In a game of two sides where only one side has a result,
 * the other gets the opposite: a replay often ends as soon as one side loses, before the other is
 * recorded as winning. A game the user left otherwise has no result at all, since the user's replay
 * stops when they leave, but leaving lost it: the user's side is given a loss, and in a game of two
 * sides the other side a win. Games without the user and games the user played to the end are
 * otherwise left as they are.
 */
export function withAssumedResults<P extends ResultPlayer>(
  players: ReadonlyArray<P>,
  complete: boolean,
  myNames: ReadonlyArray<string> | undefined,
): ReadonlyArray<P> {
  // Without teams, every player is their own side.
  const hasTeams = new Set(players.map(p => p.team)).size > 1
  const sideOf = (p: P) => (hasTeams ? `team ${p.team}` : `player ${p.name}`)
  const sideCount = new Set(players.map(sideOf)).size

  if (players.some(p => p.result !== 'unknown')) {
    if (sideCount !== 2) {
      return players
    }
    const decided = players.find(p => p.result !== 'unknown')!
    const decidedSide = sideOf(decided)
    const decidedResult = getSideResult(players.filter(p => sideOf(p) === decidedSide))
    const otherSide = players.filter(p => sideOf(p) !== decidedSide)
    if (otherSide.some(p => p.result !== 'unknown')) {
      return players
    }
    const otherResult = decidedResult === 'win' ? 'loss' : 'win'
    return players.map(p => (sideOf(p) === decidedSide ? p : { ...p, result: otherResult }))
  }

  const me = players.find(p => isMyPlayerName(p.name, myNames))
  if (!me || (complete && me.leftAtMs === undefined)) {
    return players
  }
  const mySide = sideOf(me)
  return players.map(p => {
    if (sideOf(p) === mySide) {
      return { ...p, result: 'loss' }
    }
    return sideCount === 2 ? { ...p, result: 'win' } : p
  })
}
