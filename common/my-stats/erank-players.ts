import { LADDER_RANKS, LadderRank } from '../games/ladder'
import { GameMetrics, PlayerMetrics } from '../games/player-metrics'
import { ERANK_AVERAGE_GAMES, ERankModel, getERank, getERankRank } from './erank'
import { nameOf } from './player-games'

/** A player in a game, and when the game was played. */
export interface ERankPlay {
  game: GameMetrics & { gameTimeMs: number }
  player: PlayerMetrics
}

/** An eRank averaged over the latest {@link ERANK_AVERAGE_GAMES} scored of one player's `plays`. */
export function averageERank(
  model: ERankModel,
  plays: ReadonlyArray<ERankPlay>,
): number | undefined {
  const values: number[] = []
  for (const play of plays.toSorted((a, b) => b.game.gameTimeMs - a.game.gameTimeMs)) {
    const value = getERank(model, play.game, play.player)?.value
    if (value !== undefined) {
      values.push(value)
    }
    if (values.length >= ERANK_AVERAGE_GAMES) {
      break
    }
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined
}

/** Each player's eRank, see {@link averageERank}, by `nameOf`. Players never scored are left out. */
export function getERankByPlayer(
  model: ERankModel,
  plays: ReadonlyArray<ERankPlay>,
): Map<string, number> {
  const byPlayer = new Map<string, ERankPlay[]>()
  for (const play of plays) {
    const name = nameOf(play.player)
    const own = byPlayer.get(name)
    if (own) {
      own.push(play)
    } else {
      byPlayer.set(name, [play])
    }
  }
  const result = new Map<string, number>()
  for (const [name, own] of byPlayer) {
    const value = averageERank(model, own)
    if (value !== undefined) {
      result.set(name, value)
    }
  }
  return result
}

/** Whether an eRank is in `floor`'s ladder rank or a higher one. */
export function isAtERankRank(model: ERankModel, value: number, floor: LadderRank) {
  const rank = getERankRank(model, value)
  return !!rank && LADDER_RANKS.indexOf(rank) >= LADDER_RANKS.indexOf(floor)
}
