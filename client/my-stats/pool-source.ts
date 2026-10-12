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

/** Says how many of other players' games were left out because a program played them. */
export function getScriptedNote(count: number, t: TFunction) {
  return t('myStats.poolSource.scripted', {
    defaultValue: '{{count}} games played by bots or macro programs are left out.',
    defaultValue_one: '{{count}} game played by a bot or macro program is left out.',
    count,
  })
}
