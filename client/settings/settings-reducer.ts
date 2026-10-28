import { ReadonlyDeep } from 'type-fest'
import { DEFAULT_LOCAL_SETTINGS } from '../../common/settings/default-settings'
import { GgStatsAppSettings, LocalSettings } from '../../common/settings/local-settings'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface SettingsState {
  local: Omit<LocalSettings, keyof GgStatsAppSettings>
}

const DEFAULT_SETTINGS_STATE: ReadonlyDeep<SettingsState> = {
  local: DEFAULT_LOCAL_SETTINGS,
}

export default immerKeyedReducer(DEFAULT_SETTINGS_STATE, {
  ['@settings/updateLocalSettings'](state, action) {
    let key: keyof typeof action.payload
    for (key in action.payload) {
      // NOTE(2Pac): Need these casts here because TS compiler can't verify that the
      // `state.local[key]` has the same type as `action.payload[key]`.
      const k = key as keyof Omit<LocalSettings, keyof GgStatsAppSettings>
      ;(state.local[k] as any) = action.payload[key]
    }
  },
})
