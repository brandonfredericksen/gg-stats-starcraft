import { GameDefaultsPreset } from '../../common/settings/local-settings'

export enum DialogType {
  CreatePlaylist = 'createPlaylist',
  DeletePlaylist = 'deletePlaylist',
  GameDefaultsApply = 'gameDefaultsApply',
  RenamePlaylist = 'renamePlaylist',
  ReplayInfo = 'replayInfo',
  ReplayLoad = 'replayLoad',
  Simple = 'simple',
  GgStatsHealth = 'ggStatsHealth',
  StarcraftHealth = 'starcraftHealth',
}

type BaseDialogPayload<D, DataType = undefined> = DataType extends undefined
  ? { type: D; initData?: undefined; keepOnTop?: boolean }
  : { type: D; initData: DataType; keepOnTop?: boolean }

type CreatePlaylistDialogPayload = BaseDialogPayload<
  typeof DialogType.CreatePlaylist,
  {
    /** Called with the new playlist's id/name once it's been created (before the dialog closes). */
    onCreated: (id: number, name: string) => void
  }
>
type DeletePlaylistDialogPayload = BaseDialogPayload<
  typeof DialogType.DeletePlaylist,
  {
    playlistId: number
    name: string
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
type RenamePlaylistDialogPayload = BaseDialogPayload<
  typeof DialogType.RenamePlaylist,
  {
    playlistId: number
    currentName: string
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
  | CreatePlaylistDialogPayload
  | DeletePlaylistDialogPayload
  | GameDefaultsApplyDialogPayload
  | RenamePlaylistDialogPayload
  | ReplayInfoDialogPayload
  | ReplayLoadDialogPayload
  | SimpleDialogPayload
  | GgStatsHealthDialogPayload
  | StarcraftHealthDialogPayload
