import { ReadonlyDeep } from 'type-fest'
import { GgStatsAppSettings, LocalSettings } from './local-settings'

export const DEFAULT_LOCAL_SETTINGS: ReadonlyDeep<Omit<LocalSettings, keyof GgStatsAppSettings>> = {
  runAppAtSystemStart: false,
  runAppAtSystemStartMinimized: true,
  starcraftPath: '',
  gameWinX: undefined,
  gameWinY: undefined,
  gameWinWidth: undefined,
  gameWinHeight: undefined,
  quickOpenReplays: false,
  launch32Bit: false,
  replayLibraryFolders: undefined,
}
