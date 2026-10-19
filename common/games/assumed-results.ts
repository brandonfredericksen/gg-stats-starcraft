import { GameStatsResult } from './game-stats'
import { isMyPlayer } from './player-names'

/**
 * A side's result from its players': a win if any of them won, and a loss once all of them are out,
 * having lost or left. In a team game, one teammate losing doesn't lose it for the rest: the others
 * can play on and win, and a replay that stops before then doesn't say how it went.
 */
export function getSideResult(
  players: ReadonlyArray<{ result: GameStatsResult; leftAtMs?: number }>,
): GameStatsResult {
  if (players.some(p => p.result === 'win')) {
    return 'win'
  }
  const isOut = (p: { result: GameStatsResult; leftAtMs?: number }) =>
    p.result === 'loss' || p.leftAtMs !== undefined
  return players.length && players.every(isOut) ? 'loss' : 'unknown'
}

interface ResultPlayer {
  name: string
  /** Everyone playing as this player, when that's more than one, see `GamePlayerStats.names`. */
  names?: ReadonlyArray<string>
  team: number
  result: GameStatsResult
  leftAtMs?: number
}

/**
 * Fills in results a replay doesn't have. A game the user left has no result for them, since the
 * user's replay stops when they leave, but leaving lost it for them: the user's side is given a
 * loss, unless a teammate is recorded as winning. Then in a game of two sides where only one side's
 * result is known, the other side gets the opposite: a replay often ends as soon as one side loses,
 * before the other is recorded as winning. Games without the user and games the user played to the
 * end are otherwise left as they are.
 */
export function withAssumedResults<P extends ResultPlayer>(
  players: ReadonlyArray<P>,
  complete: boolean,
  myNames: ReadonlyArray<string> | undefined,
): ReadonlyArray<P> {
  // Without teams, every player is their own side.
  const hasTeams = new Set(players.map(p => p.team)).size > 1
  const sideOf = (p: P) => (hasTeams ? `team ${p.team}` : `player ${p.name}`)

  const me = players.find(p => isMyPlayer(p, myNames))
  const meLeft =
    me !== undefined && me.result === 'unknown' && (!complete || me.leftAtMs !== undefined)
  const mySide = me && sideOf(me)
  const myTeamWon = players.some(p => sideOf(p) === mySide && p.result === 'win')
  const lostWithMe = (p: P) =>
    p === me || (!myTeamWon && sideOf(p) === mySide && p.result === 'unknown')
  const withMine = meLeft
    ? players.map(p => (lostWithMe(p) ? { ...p, result: 'loss' } : p))
    : players

  const sides = Array.from(new Set(withMine.map(sideOf)), side =>
    withMine.filter(p => sideOf(p) === side),
  )
  if (sides.length !== 2) {
    return withMine
  }
  const [first, second] = sides.map(getSideResult)
  if ((first === 'unknown') === (second === 'unknown')) {
    return withMine
  }
  const decided = first === 'unknown' ? second : first
  const undecidedSide = sideOf((first === 'unknown' ? sides[0] : sides[1])[0])
  const opposite = decided === 'win' ? 'loss' : 'win'
  return withMine.map(p =>
    sideOf(p) === undecidedSide && p.result === 'unknown' ? { ...p, result: opposite } : p,
  )
}
