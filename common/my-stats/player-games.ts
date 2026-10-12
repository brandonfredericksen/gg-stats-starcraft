import { getSideResult, withAssumedResults } from '../games/assumed-results'
import { SCRIPTED_BURST_SHARE } from '../games/command-stats'
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

/** A player, the same from game to game: their names, in lower case. */
export function nameOf(p: PlayerMetrics) {
  return p.names.join(' + ').toLowerCase()
}

/** Whether a program played the game for the player, from the bursts of commands they sent. */
export function isScriptedGame(player: PlayerMetrics) {
  return (player.burstShare ?? 0) >= SCRIPTED_BURST_SHARE
}

/**
 * Tells which players a program played for, to leave out of comparisons with other players: in the
 * games it shows in, and in every game of a player it played at least half the games of, since a
 * program's quieter games can look like a person's.
 */
export function makeScriptedCheck(
  games: ReadonlyArray<GameMetrics>,
): (player: PlayerMetrics) => boolean {
  const counts = new Map<string, { measured: number; scripted: number }>()
  for (const game of games) {
    for (const p of game.players) {
      if (p.burstShare === undefined) {
        continue
      }
      const count = counts.get(nameOf(p)) ?? { measured: 0, scripted: 0 }
      count.measured += 1
      count.scripted += isScriptedGame(p) ? 1 : 0
      counts.set(nameOf(p), count)
    }
  }
  const scripted = new Set(
    Array.from(counts).flatMap(([name, { measured, scripted }]) =>
      scripted * 2 >= measured ? [name] : [],
    ),
  )
  return player => isScriptedGame(player) || scripted.has(nameOf(player))
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
  // Without teams, everyone plays for themselves. Uneven games like 2v1 have teams too.
  const hasTeams = new Set(game.players.map(p => p.team)).size > 1
  return {
    teammates: hasTeams ? others.filter(p => p.team === player.team) : [],
    opponents: hasTeams ? others.filter(p => p.team !== player.team) : others,
  }
}
