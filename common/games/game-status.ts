/**
 * Represents the status of a game in progress. These are considered "ordered" (that is, a higher
 * number means a later state). Their values/existence do not need to be preserved across versions,
 * as these values are transient and not stored across application launches. Only `Error` is shared
 * with the game DLL, which reports it by number.
 */
export enum GameStatus {
  Unknown = 0,
  Launching,
  Configuring,
  AwaitingPlayers,
  Starting,
  Playing,
  Finished,
  // This constant is being duplicated in game-side code game/src/app_messages.rs
  // They should be kept in sync if this ever needs to changed.
  Error = 666,
}

export function statusToString(status: GameStatus) {
  switch (status) {
    case GameStatus.Unknown:
      return 'unknown'
    case GameStatus.Launching:
      return 'launching'
    case GameStatus.Configuring:
      return 'configuring'
    case GameStatus.AwaitingPlayers:
      return 'awaitingPlayers'
    case GameStatus.Starting:
      return 'starting'
    case GameStatus.Playing:
      return 'playing'
    case GameStatus.Finished:
      return 'finished'
    case GameStatus.Error:
      return 'error'
    default:
      status satisfies never
      return 'unknown'
  }
}

export type GameStatusString = ReturnType<typeof statusToString>

export function stringToStatus(str: GameStatusString): GameStatus {
  switch (str) {
    case 'unknown':
      return GameStatus.Unknown
    case 'launching':
      return GameStatus.Launching
    case 'configuring':
      return GameStatus.Configuring
    case 'awaitingPlayers':
      return GameStatus.AwaitingPlayers
    case 'starting':
      return GameStatus.Starting
    case 'playing':
      return GameStatus.Playing
    case 'finished':
      return GameStatus.Finished
    case 'error':
      return GameStatus.Error
    default:
      str satisfies never
      return GameStatus.Unknown
  }
}

export interface ReportedGameStatus {
  id: string
  state: GameStatusString
  extra?: any
  isReplay: boolean
  /** Whether the game is a replay being analyzed in the background, which nobody is watching. */
  isReplayAnalysis?: boolean
}
