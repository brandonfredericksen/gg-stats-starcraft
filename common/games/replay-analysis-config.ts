import { nanoid } from 'nanoid'
import { GameLaunchConfig, GameUser, PlayerInfo, SlotType } from './game-launch-config'
import { GameType } from './game-type'

/**
 * The user the game is launched as. Nobody is logged in, and a replay plays out the recorded
 * players' commands, so this only has to be a valid user.
 */
const LOCAL_USER: GameUser = {
  id: 0,
  name: 'GG Stats',
}

/** BW's slot type id for a human player. */
const HUMAN_TYPE_ID = 6

export interface ReplayLaunchOptions {
  gameId: string
  name: string
  /** Absolute path of the replay file. */
  path: string
  /**
   * Plays the replay through to its end without showing the game, reporting its stats instead of
   * letting someone watch it.
   */
  analyze?: boolean
  /**
   * The game these stats belong with: the game id the replay records, if the client that saved it
   * records one, or the game whose page asked for the analysis.
   */
  linkedGameId?: string
  /** The replay's recorded start time, which seeds the game. 0 if it couldn't be read. */
  seed: number
  /** Opens a watched replay at this frame instead of its start. */
  startFrame?: number
}

/** Builds the config that launches StarCraft to watch or analyze a replay. */
export function makeReplayAnalysisConfig({
  gameId,
  name,
  path,
  analyze,
  linkedGameId,
  seed,
  startFrame,
}: ReplayLaunchOptions): GameLaunchConfig {
  const player: PlayerInfo = {
    type: SlotType.Human,
    typeId: HUMAN_TYPE_ID,
    id: nanoid(),
    teamId: 0,
    userId: LOCAL_USER.id,
  }

  return {
    localUser: LOCAL_USER,
    blockedUsers: [],
    setup: {
      gameId,
      name,
      map: { isReplay: true, path, analyze, linkedGameId, startFrame },
      gameType: GameType.Melee,
      gameSubType: 0,
      slots: [player],
      users: [LOCAL_USER],
      seed,
    },
  }
}
