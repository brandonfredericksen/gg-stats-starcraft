import { RaceChar } from '../races'
import { GameType } from './game-type'

/**
 * The kinds of player slot the game DLL's setup knows about. A replay only ever needs `Human`, but
 * the DLL reads the type by name, so the names must stay as they are.
 */
export enum SlotType {
  Human = 'human',
  Observer = 'observer',
  Computer = 'computer',
  ControlledOpen = 'controlledOpen',
  ControlledClosed = 'controlledClosed',
  UmsComputer = 'umsComputer',
  Open = 'open',
  Closed = 'closed',
}

/** The user the game DLL treats as the local player. */
export interface GameUser {
  id: number
  name: string
}

/** Configuration for a particular player slot in a game. */
export interface PlayerInfo {
  /** The ID of the player slot, an opaque string. */
  id: string
  /** The ID of the user in this slot. Only set for 'human' and 'observer' */
  userId?: number
  /** The race set for this slot. */
  race?: RaceChar
  /** The BW player ID for this slot (a number between 0 and 7). */
  playerId?: number
  /** The ID of the team this slot is a part of. */
  teamId: number
  /** The type of this slot. */
  type: SlotType
  /** The BW id of the type of this slot. */
  typeId: number
}

export interface ReplayMapInfo {
  isReplay: true
  path: string
  /**
   * Plays the replay through to its end without showing the game, reporting its score data instead
   * of letting someone watch it.
   */
  analyze?: boolean
  /** Opens a watched replay at this frame instead of its start, like a moment worth seeing. */
  startFrame?: number
  /**
   * The game these stats belong with: the game id the replay records, if the client that saved it
   * records one, or the game whose page asked for the analysis.
   */
  linkedGameId?: string
}

export function isReplayMapInfo(map: ReplayMapInfo): map is ReplayMapInfo {
  return !!map.isReplay
}

/** Returns the replay a config analyzes in the background, if that's what it launches. */
export function getAnalyzedReplay(config: GameLaunchConfig): ReplayMapInfo | undefined {
  const { map } = config.setup
  return isReplayMapInfo(map) && map.analyze ? map : undefined
}

/**
 * The game setup sent to the game DLL. Its fields follow the DLL's own setup message, which has more
 * fields (all optional) for kinds of game the app never launches.
 */
export interface GameSetup {
  /** The id of the game, which the DLL reports back with everything it sends about it. */
  gameId: string
  /**
   * The name of the game. Not really that important generally, as we don't display this directly
   * to users.
   */
  name: string
  map: ReplayMapInfo
  /**
   * The file path of the map file. Note that this gets set during the launch process, it's not
   * provided directly by the code that triggers the launch.
   */
  mapPath?: string
  gameType: GameType
  gameSubType: number
  slots: PlayerInfo[]
  users: GameUser[]
  seed: number
}

/** Configuration info for launching StarCraft to watch or analyze a replay. */
export interface GameLaunchConfig {
  /** The user the game is launched as. */
  localUser: GameUser
  /** Always empty, since a replay has no chat. */
  blockedUsers: number[]
  /**
   * The filename template for this game's auto-saved replay. Unset for replay playback, which saves
   * no replay; the game uses the default template when it's missing.
   */
  replayNameTemplate?: string
  /** Setup configuration for the game, such as the map, game type, etc. */
  setup: GameSetup
}
