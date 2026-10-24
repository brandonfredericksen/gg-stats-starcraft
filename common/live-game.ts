import { LadderRank } from './games/ladder'
import { RaceChar } from './races'

/** How the app saw the game the user joined. */
export type LiveGameSource = 'ladder' | 'lobby' | 'shieldBattery'

/** A player's season on StarCraft's 1v1 ladder, as the match screen looked it up. */
export interface LiveLadderStanding {
  /** Missing until they've played enough games this season to have one. */
  rating?: number
  rank?: LadderRank
  wins: number
  losses: number
}

export interface LiveGamePlayer {
  name: string
  /** The race they picked in a lobby, `r` for random. Missing until they pick one. */
  race?: RaceChar
  /** The Battle.net gateway they play on, like 10 for U.S. West, when the game says. */
  gatewayId?: number
  battleTag?: string
  ladder?: LiveLadderStanding
  /** Their other accounts on the same Battle.net account, from their ladder profile. */
  otherAccounts?: string[]
  observer?: boolean
}

/** A game the user joined, from a lobby or the match found screen to after it starts. */
export interface LiveGame {
  /** Different for every game, so a new game can be told from an update to the same one. */
  id: string
  source: LiveGameSource
  /** When the app noticed the game, in Unix ms. */
  noticedMs: number
  /** Whether the game was seen starting, like a lobby counting down. */
  started: boolean
  players: LiveGamePlayer[]
}

/** StarCraft's Battle.net gateways, by id. */
export const GATEWAY_REGIONS: Readonly<Record<number, string>> = {
  10: 'usWest',
  11: 'usEast',
  20: 'europe',
  30: 'korea',
  45: 'asia',
}
