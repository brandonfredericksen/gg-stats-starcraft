import { TFunction } from 'i18next'

/**
 * Where other players' games come from, to finish a sentence like "players over 150 EAPM ...":
 * the user's replays, the ladder games the app ships, or both.
 */
export function getPoolSource(fromBaseline: number, games: number, t: TFunction) {
  if (!fromBaseline) {
    return t('myStats.poolSource.yours', 'in your replays')
  }
  return fromBaseline >= games
    ? t('myStats.poolSource.ladder', 'in recent ladder games')
    : t('myStats.poolSource.both', 'in your replays and recent ladder games')
}
