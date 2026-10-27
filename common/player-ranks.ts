import { LiveLadderStanding } from './live-game'

/** A player's season on one Battle.net gateway's 1v1 ladder, as their profile last showed it. */
export interface SeenLadderStanding extends LiveLadderStanding {
  /** The gateway the account is on, like 10 for U.S. West. */
  gatewayId: number
  /** When the app saw the profile, in Unix ms. */
  seenMs: number
}

/** A player's season in one of ShieldBattery's matchmaking modes, as their profile last showed it. */
export interface SeenShieldBatteryMode {
  /** Like `1v1` or `3v3bgh`. */
  mode: string
  rating: number
  /**
   * Their division, like `gold2`, or `unrated` before their first game. Missing when the profile
   * didn't say which season it's from.
   */
  division?: string
  wins: number
  losses: number
  /** When they last played in it, in Unix ms, or 0 if the profile doesn't say. */
  lastPlayedMs: number
}

/**
 * What the app has seen of a player's ranks: their Battle.net ladder seasons, from the profiles
 * StarCraft's match screen looks up, and their ShieldBattery seasons, from the profiles opened in
 * ShieldBattery.
 */
export interface SeenPlayerRanks {
  /** Their name as last seen. */
  name: string
  /** One for each gateway they've been seen on, the latest seen first. */
  battleNet: SeenLadderStanding[]
  shieldBattery?: {
    userId: number
    seenMs: number
    /** Every mode they've played this season, the one with the most games first. */
    modes: SeenShieldBatteryMode[]
  }
}
