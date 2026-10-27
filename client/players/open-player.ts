import { isMyPlayerName } from '../../common/games/player-names'
import { ThunkAction } from '../dispatch-registry'
import { useMyPlayerNames } from '../games/my-player-names'
import { useAppSelector } from '../redux-hooks'
import { mergeLocalSettings } from '../settings/action-creators'
import { findPlayerByAccount, useKnownPlayers } from './known-players'

/** How many players the Players page lists as opened lately. */
export const MAX_RECENT_PLAYERS = 12

const NO_PLAYERS: ReadonlyArray<string> = []

/** The other players whose pages the user opened, the latest first. */
export function useRecentPlayers(): ReadonlyArray<string> {
  return useAppSelector(s => s.settings.local.recentPlayers) ?? NO_PLAYERS
}

/** Puts `name` first among the players opened lately. */
export function rememberRecentPlayer(name: string): ThunkAction {
  return (dispatch, getState) => {
    const before = getState().settings.local.recentPlayers ?? []
    if (before[0] === name) {
      return
    }
    const recentPlayers = [
      name,
      ...before.filter(other => other.toLowerCase() !== name.toLowerCase()),
    ].slice(0, MAX_RECENT_PLAYERS)
    dispatch(mergeLocalSettings({ recentPlayers }, { onSuccess: () => {}, onError: () => {} }))
  }
}

/** Every account `name` goes by: the user's names if it's one of theirs, or a known player's. */
export function usePlayerAccounts(name: string): { accounts: string[]; isMe: boolean } {
  const knownPlayers = useKnownPlayers()
  const myNames = useMyPlayerNames() ?? []
  const isMe = isMyPlayerName(name, myNames)
  const accounts = Array.from(
    new Set([
      name,
      ...(isMe ? myNames : (findPlayerByAccount(knownPlayers, name)?.accounts ?? [])),
    ]),
  )
  return { accounts, isMe }
}
