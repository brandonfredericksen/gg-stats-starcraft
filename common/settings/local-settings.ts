/**
 * Settings the app keeps for itself (that will not be exposed to users in the settings dialog).
 */
export interface GgStatsAppSettings {
  version: number
  winX: number
  winY: number
  winWidth: number
  winHeight: number
  winMaximized: boolean
}

/** Which theme the app shows: the system's choice, or always light or dark. */
export type ThemeMode = 'system' | 'light' | 'dark'

export const ALL_THEME_MODES: ReadonlyArray<ThemeMode> = ['system', 'light', 'dark']

/** How times of day are written: as Windows writes them, or on a 12 or 24 hour clock. */
export type ClockFormat = 'system' | '12' | '24'

export const ALL_CLOCK_FORMATS: ReadonlyArray<ClockFormat> = ['system', '12', '24']

/** A person who plays under several accounts. */
export interface KnownPlayer {
  id: string
  /** What the user calls them. */
  name: string
  /** Their in-game names, matched ignoring case. */
  accounts: ReadonlyArray<string>
  /** Whatever the user wants to remember about them. */
  note?: string
}

export interface LocalSettings extends GgStatsAppSettings {
  runAppAtSystemStart: boolean
  runAppAtSystemStartMinimized: boolean
  /** Missing in settings saved before it could be picked, which means `system`. */
  themeMode?: ThemeMode
  /** Missing means `system`. */
  clockFormat?: ClockFormat
  /** Whether the user was asked once about starting with Windows, whatever they said. */
  startWithWindowsOffered?: boolean
  /**
   * Whether each game's replay is picked up and analyzed as soon as the game ends. Missing in
   * settings saved before it could be turned off, which means on.
   */
  autoCapture?: boolean
  /**
   * Whether to show a Windows notification when a captured game is analyzed while the app is in
   * the tray. Missing means on.
   */
  autoCaptureNotifications?: boolean
  /**
   * Whether to show who's in a game the user joins, from what StarCraft and ShieldBattery leave on
   * disk. Missing means on.
   */
  liveGame?: boolean
  /** Whether to check GitHub for new versions and install them. Missing means on. */
  checkForUpdates?: boolean
  /**
   * The user's own in-game names, so a game can be shown from their side. Unset until the user
   * confirms them; an empty list means they chose not to set any.
   */
  myPlayerNames?: ReadonlyArray<string>
  /** Other people the user knows, with every account they play under. */
  knownPlayers?: ReadonlyArray<KnownPlayer>
  /** The other players whose pages the user opened, the latest first. */
  recentPlayers?: ReadonlyArray<string>
  starcraftPath: string
  gameWinX?: number
  gameWinY?: number
  gameWinWidth?: number
  gameWinHeight?: number
  monitorId?: number
  quickOpenReplays: boolean
  /**
   * Whether to launch the 32-bit game client instead of the (default) 64-bit one. Discouraged;
   * exists as an escape hatch for systems where the 64-bit client doesn't work.
   */
  launch32Bit: boolean

  /**
   * Absolute paths of the folders indexed by the replay library. `undefined` means the user has
   * never configured folders: the default folder, `Documents/Starcraft/maps/replays`, is used and
   * presented as a regular (removable) entry. An empty array means the user removed every
   * configured folder: nothing is indexed, and the setting persists across launches until a folder
   * is added again.
   */
  replayLibraryFolders?: ReadonlyArray<string>

  // Dev-only settings. These are stripped from non-dev clients when read, so they can only ever
  // be turned on by running a dev client.
  disableHd?: boolean
}
