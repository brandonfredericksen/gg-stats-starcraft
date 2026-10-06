import { getSideResult, withAssumedResults } from '../games/assumed-results'
import { GameStatsResult } from '../games/game-stats'
import { GameMetrics, GameShape, PlayerMetrics } from '../games/player-metrics'
import { isMyPlayerName } from '../games/player-names'

export function isTeamGame(shape: GameShape) {
  return shape === '2v2' || shape === '3v3' || shape === '4v4'
}

/**
 * Whether games of this type split by map. 3v3 and 4v4 on money maps play nothing like on other
 * maps: Fastest and Big Game Hunters each have their own meta. 1v1 and 2v2 don't divide that way.
 */
export function splitsByMap(shape: GameShape | undefined) {
  return shape === '3v3' || shape === '4v4'
}

/** The user's player in a game, if they were in it. */
export function findMe(game: GameMetrics, names: ReadonlyArray<string>) {
  return game.players.find(p => p.human && p.names.some(n => isMyPlayerName(n, names)))
}

/**
 * What happened to the user: their own result if the game has one, a loss if they left, even when
 * their teammates went on to win, and otherwise their team's result.
 */
export function getMyResult(
  game: GameMetrics,
  me: PlayerMetrics,
  names: ReadonlyArray<string>,
): GameStatsResult {
  const players = game.players.map(p => ({
    player: p,
    name: p === me ? names[0] : p.names.join(' + '),
    team: game.shape === '1v1' || game.shape === 'ffa' ? game.players.indexOf(p) : p.team,
    result: p.result,
    leftAtMs: p.leftAtMs,
  }))
  const withResults = withAssumedResults(players, game.complete, names.slice(0, 1))
  const mine = withResults.find(p => p.player === me)!
  if (mine.result !== 'unknown') {
    return mine.result
  }
  if (me.leftAtMs !== undefined) {
    return 'loss'
  }
  return getSideResult(withResults.filter(p => p.team === mine.team))
}

/** The other human players in a game, split into a player's teammates and opponents. */
export function getSidesOf(game: GameMetrics, player: PlayerMetrics) {
  const others = game.players.filter(p => p !== player && p.human)
  const hasTeams = isTeamGame(game.shape)
  return {
    teammates: hasTeams ? others.filter(p => p.team === player.team) : [],
    opponents: hasTeams ? others.filter(p => p.team !== player.team) : others,
  }
}
