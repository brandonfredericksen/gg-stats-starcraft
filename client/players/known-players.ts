import { nanoid } from 'nanoid'
import { KnownPlayer } from '../../common/settings/local-settings'
import { ThunkAction } from '../dispatch-registry'
import { useAppSelector } from '../redux-hooks'
import { mergeLocalSettings } from '../settings/action-creators'

const NO_PLAYERS: ReadonlyArray<KnownPlayer> = []

/** The people the user has noted, with every account each plays under. */
export function useKnownPlayers(): ReadonlyArray<KnownPlayer> {
  return useAppSelector(s => s.settings.local.knownPlayers) ?? NO_PLAYERS
}

function sameName(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase()
}

/** The known player who plays as `account`, matching names ignoring case. */
export function findPlayerByAccount(
  players: ReadonlyArray<KnownPlayer>,
  account: string,
): KnownPlayer | undefined {
  return players.find(player => player.accounts.some(a => sameName(a, account)))
}

/**
 * The person behind `account`: the known player who plays as it, or a new one with just that
 * account, which isn't saved until something about them is.
 */
export function getPlayerForAccount(
  players: ReadonlyArray<KnownPlayer>,
  account: string,
): KnownPlayer {
  return (
    findPlayerByAccount(players, account) ?? { id: nanoid(), name: account, accounts: [account] }
  )
}

/**
 * Whether a player has anything worth keeping: a note, or more than the one account they were
 * looked up by.
 */
function isWorthKeeping(player: KnownPlayer) {
  return player.accounts.length > 0 && (!!player.note?.trim() || player.accounts.length > 1)
}

/**
 * Saves a player's note and accounts. An account can only belong to one person, so it's taken off
 * anyone else who had it, and anyone left with nothing worth keeping is dropped.
 */
export function savePlayer(player: KnownPlayer): ThunkAction {
  return (dispatch, getState) => {
    const accounts = player.accounts
      .map(a => a.trim())
      .filter((a, i, all) => a && all.findIndex(other => sameName(other, a)) === i)
    const saved: KnownPlayer = {
      ...player,
      accounts,
      note: player.note?.trim() || undefined,
    }
    const others = (getState().settings.local.knownPlayers ?? [])
      .filter(p => p.id !== player.id)
      .map(p => ({ ...p, accounts: p.accounts.filter(a => !accounts.some(b => sameName(a, b))) }))
    const knownPlayers = [...others, saved].filter(isWorthKeeping)
    dispatch(mergeLocalSettings({ knownPlayers }, { onSuccess: () => {}, onError: () => {} }))
  }
}
