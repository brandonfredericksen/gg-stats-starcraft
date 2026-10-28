import { LocalSettings } from '../../common/settings/local-settings'

export type SettingsActions = UpdateLocalSettings

/**
 * Update the local settings with the new settings.
 */
export interface UpdateLocalSettings {
  type: '@settings/updateLocalSettings'
  payload: Partial<LocalSettings>
}
