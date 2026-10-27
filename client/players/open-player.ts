import { atom, useAtomValue } from 'jotai'
import { isMyPlayerName } from '../../common/games/player-names'
import { useMyPlayerNames } from '../games/my-player-names'
import { findPlayerByAccount, useKnownPlayers } from './known-players'

/**
 * The other player whose page has its own tab in the bar, after My stats: the last one opened,
 * until the tab is closed. One at a time, so opening another player takes the tab over.
 */
export const openPlayerAtom = atom<string | undefined>(undefined)

export function useOpenPlayer() {
  return useAtomValue(openPlayerAtom)
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
