import { LADDER_RANKS, LadderRank } from '../games/ladder'
import { GameMetrics, PlayerMetrics } from '../games/player-metrics'
import { ESKILL_AVERAGE_GAMES, ESkillModel, getESkill, getESkillRank } from './eskill'
import { nameOf } from './player-games'

/** A player in a game, and when the game was played. */
export interface ESkillPlay {
  game: GameMetrics & { gameTimeMs: number }
  player: PlayerMetrics
}

/** An eSkill averaged over the latest {@link ESKILL_AVERAGE_GAMES} scored of one player's `plays`. */
export function averageESkill(
  model: ESkillModel,
  plays: ReadonlyArray<ESkillPlay>,
): number | undefined {
  const values: number[] = []
  for (const play of plays.toSorted((a, b) => b.game.gameTimeMs - a.game.gameTimeMs)) {
    const value = getESkill(model, play.game, play.player)?.value
    if (value !== undefined) {
      values.push(value)
    }
    if (values.length >= ESKILL_AVERAGE_GAMES) {
      break
    }
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined
}

/** Each player's eSkill, see {@link averageESkill}, by `nameOf`. Players never scored are left out. */
export function getESkillByPlayer(
  model: ESkillModel,
  plays: ReadonlyArray<ESkillPlay>,
): Map<string, number> {
  const byPlayer = new Map<string, ESkillPlay[]>()
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
    const value = averageESkill(model, own)
    if (value !== undefined) {
      result.set(name, value)
    }
  }
  return result
}

/** Whether an eSkill is in `floor`'s ladder rank or a higher one. */
export function isAtESkillRank(model: ESkillModel, value: number, floor: LadderRank) {
  const rank = getESkillRank(model, value)
  return !!rank && LADDER_RANKS.indexOf(rank) >= LADDER_RANKS.indexOf(floor)
}
