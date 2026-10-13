import { GameDefaultsPreset } from '../../common/settings/local-settings'

export enum DialogType {
  Confirm = 'confirm',
  GameDefaultsApply = 'gameDefaultsApply',
  ReplayInfo = 'replayInfo',
  ReplayLoad = 'replayLoad',
  Simple = 'simple',
  GgStatsHealth = 'ggStatsHealth',
  StarcraftHealth = 'starcraftHealth',
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
type GameDefaultsApplyDialogPayload = BaseDialogPayload<
  typeof DialogType.GameDefaultsApply,
  {
    preset: GameDefaultsPreset
    /**
     * Whether the user just switched to `preset` (versus asking to re-apply the one already
     * selected), which changes how the dialog is titled.
     */
    justSwitched: boolean
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

export type DialogPayload =
  | ConfirmDialogPayload
  | GameDefaultsApplyDialogPayload
  | ReplayInfoDialogPayload
  | ReplayLoadDialogPayload
  | SimpleDialogPayload
  | GgStatsHealthDialogPayload
  | StarcraftHealthDialogPayload
