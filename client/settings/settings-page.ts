export enum AppSettingsPage {
  PlayerNames = 'AppPlayerNames',
  Appearance = 'AppAppearance',
  Replays = 'AppReplays',
  System = 'AppSystem',
}

export enum GameSettingsPage {
  StarCraft = 'GameStarCraft',
  Input = 'GameInput',
  Sound = 'GameSound',
  Video = 'GameVideo',
  Gameplay = 'GameGameplay',
  Defaults = 'GameDefaults',
}

export type SettingsPage = AppSettingsPage | GameSettingsPage

export const ALL_SETTINGS_PAGES: ReadonlyArray<SettingsPage> = [
  ...Object.values(AppSettingsPage),
  ...Object.values(GameSettingsPage),
]
