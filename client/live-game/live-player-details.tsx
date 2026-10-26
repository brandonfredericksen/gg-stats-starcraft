import { TFunction } from 'i18next'
import { isMyPlayerName } from '../../common/games/player-names'
import { GATEWAY_REGIONS, LiveGame, LiveGamePlayer } from '../../common/live-game'
import { Playstyle } from '../../common/my-stats/playstyle'
import { KnownPlayer } from '../../common/settings/local-settings'
import { useMyPlayerNames } from '../games/my-player-names'
import { findPlayerByAccount, useKnownPlayers } from '../players/known-players'

export function getRegionLabel(gatewayId: number, t: TFunction) {
  switch (GATEWAY_REGIONS[gatewayId]) {
    case 'usWest':
      return t('liveGame.region.usWest', 'U.S. West')
    case 'usEast':
      return t('liveGame.region.usEast', 'U.S. East')
    case 'europe':
      return t('liveGame.region.europe', 'Europe')
    case 'korea':
      return t('liveGame.region.korea', 'Korea')
    case 'asia':
      return t('liveGame.region.asia', 'Asia')
    default:
      return undefined
  }
}

/** Every account someone plays under: the one they're on, ones the user noted, and alternates. */
function getAccounts(player: LiveGamePlayer, known: KnownPlayer | undefined) {
  return Array.from(
    new Set([player.name, ...(known?.accounts ?? []), ...(player.otherAccounts ?? [])]),
  )
}

export function getPlaystyleLabel(style: Playstyle, t: TFunction) {
  switch (style) {
    case 'standard':
      return t('liveGame.playstyle.standard', 'Standard')
    case 'cheese':
      return t('liveGame.playstyle.cheese', 'Cheese')
    case 'staticDefense':
      return t('liveGame.playstyle.staticDefense', 'Static defense')
    case 'tech':
      return t('liveGame.playstyle.tech', 'Fast tech')
    case 'greedy':
      return t('liveGame.playstyle.greedy', 'Greedy')
    case 'offMeta':
      return t('liveGame.playstyle.offMeta', 'Off meta')
    default:
      return style satisfies never
  }
}

export interface Person {
  player: LiveGamePlayer
  known: KnownPlayer | undefined
  accounts: string[]
  isMe: boolean
}

/**
 * A card's key: the player's name, which stays the same as more is learned about them, with their
 * gateway only when another player has the same name.
 */
export function getPersonKey(person: Person, index: number, people: ReadonlyArray<Person>) {
  const name = person.player.name.toLowerCase()
  const shared = people.some(p => p !== person && p.player.name.toLowerCase() === name)
  // Without a gateway to tell them apart, where they are in the game does.
  return shared ? `${name}@${person.player.gatewayId ?? `#${index}`}` : name
}

/**
 * The order the cards go in: the game's, top to bottom, so each player is where the user sees them
 * in it. Without slots, like on the ladder, the people the user is playing come before
 * them. Anyone watching comes last.
 */
function comparePeople(a: Person, b: Person) {
  const watching = Number(!!a.player.observer) - Number(!!b.player.observer)
  if (watching) {
    return watching
  }
  if (a.player.slot !== undefined && b.player.slot !== undefined) {
    return a.player.slot - b.player.slot
  }
  return Number(a.isMe) - Number(b.isMe)
}

/** Everyone in the game, with what the user knows about them, in the game's order. */
export function usePeople(game: LiveGame | undefined): Person[] {
  const knownPlayers = useKnownPlayers()
  const myNames = useMyPlayerNames() ?? []
  return (game?.players ?? [])
    .map(player => {
      const known = findPlayerByAccount(knownPlayers, player.name)
      const isMe = isMyPlayerName(player.name, myNames)
      // The user's own details count every name they play under, without listing them.
      const accounts = isMe
        ? Array.from(new Set([player.name, ...myNames]))
        : getAccounts(player, known)
      return {
        player,
        known,
        accounts,
        isMe,
      }
    })
    .sort(comparePeople)
}
