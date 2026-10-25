import { LadderRank } from './games/ladder'
import { TilesetId } from './maps'
import { RaceChar } from './races'

/** How the app saw the game the user joined. */
export type LiveGameSource = 'ladder' | 'shieldBattery'

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
  /** Where they are in the game, top to bottom, when it says: their player number in ShieldBattery. */
  slot?: number
  /** The Battle.net gateway they play on, like 10 for U.S. West, when the game says. */
  gatewayId?: number
  battleTag?: string
  ladder?: LiveLadderStanding
  /** Their other accounts on the same Battle.net account, from their ladder profile. */
  otherAccounts?: string[]
  observer?: boolean
  /** Which side they're on, when the game says. Players with the same team are allies. */
  team?: number
  /** The race they picked, which is `r` for random until the game starts. */
  race?: RaceChar
  /** Their ShieldBattery matchmaking rating, for a matchmaking game. */
  shieldBattery?: { rating: number; division?: string }
}

/** A game the user joined, from the match found or loading screen until it ends. */
export interface LiveGame {
  /** Different for every game, so a new game can be told from an update to the same one. */
  id: string
  source: LiveGameSource
  /** When the app noticed the game, in Unix ms. */
  noticedMs: number
  players: LiveGamePlayer[]
  /** The map, when the game says. */
  mapName?: string
  /** The map's tileset, when the game says, for a picture of its terrain. */
  tileset?: TilesetId
}

/** StarCraft's Battle.net gateways, by id. */
export const GATEWAY_REGIONS: Readonly<Record<number, string>> = {
  10: 'usWest',
  11: 'usEast',
  20: 'europe',
  30: 'korea',
  45: 'asia',
}
