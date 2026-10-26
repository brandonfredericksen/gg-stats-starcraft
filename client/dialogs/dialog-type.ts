import { RaceChar } from '../../common/races'

export enum DialogType {
  Confirm = 'confirm',
  ReplayInfo = 'replayInfo',
  ReplayLoad = 'replayLoad',
  Simple = 'simple',
  GgStatsHealth = 'ggStatsHealth',
  StarcraftHealth = 'starcraftHealth',
  Player = 'player',
}

type BaseDialogPayload<D, DataType = undefined> = DataType extends undefined
  ? { type: D; initData?: undefined; keepOnTop?: boolean }
  : { type: D; initData: DataType; keepOnTop?: boolean }

type ConfirmDialogPayload = BaseDialogPayload<
  typeof DialogType.Confirm,
  {
    confirmTitle: string
    confirmBody: string
    confirmLabel: string
    onConfirm: () => void
  }
>
type ReplayInfoDialogPayload = BaseDialogPayload<
  typeof DialogType.ReplayInfo,
  {
    filePath: string
  }
>
type ReplayLoadDialogPayload = BaseDialogPayload<
  typeof DialogType.ReplayLoad,
  {
    gameId: string
  }
>
type SimpleDialogPayload = BaseDialogPayload<
  typeof DialogType.Simple,
  {
    simpleTitle: string
    simpleContent: React.ReactNode
    hasButton: boolean
  }
>
type GgStatsHealthDialogPayload = BaseDialogPayload<typeof DialogType.GgStatsHealth>
type StarcraftHealthDialogPayload = BaseDialogPayload<typeof DialogType.StarcraftHealth>
type PlayerDialogPayload = BaseDialogPayload<
  typeof DialogType.Player,
  {
    name: string
    /** The race they played where they were clicked on. */
    race?: RaceChar
    /** Where they are in the live game, when they were clicked on there. */
    live?: {
      gameId: string
      /** The player's key in the live game, see `getPersonKey`. */
      personKey: string
    }
  }
>

export type DialogPayload =
  | ConfirmDialogPayload
  | ReplayInfoDialogPayload
  | ReplayLoadDialogPayload
  | SimpleDialogPayload
  | GgStatsHealthDialogPayload
  | StarcraftHealthDialogPayload
  | PlayerDialogPayload
