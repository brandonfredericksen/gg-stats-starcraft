import { useTranslation } from 'react-i18next'
import { ALL_THEME_MODES, ThemeMode } from '../../../common/settings/local-settings'
import { RadioButton, RadioGroup } from '../../material/radio'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { mergeLocalSettings } from '../action-creators'
import { FormContainer, SectionContainer, SettingsSectionHeader } from '../settings-content'

export function AppAppearanceSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const themeMode = useAppSelector(s => s.settings.local.themeMode) ?? 'system'

  const labels: Record<ThemeMode, string> = {
    system: t('settings.app.appearance.themeSystem', 'Match Windows'),
    light: t('settings.app.appearance.themeLight', 'Light'),
    dark: t('settings.app.appearance.themeDark', 'Dark'),
  }

  return (
    <FormContainer>
      <SectionContainer>
        <SettingsSectionHeader>
          {t('settings.app.appearance.themeOverline', 'Theme')}
        </SettingsSectionHeader>
        <RadioGroup
          value={themeMode}
          name='themeMode'
          onChange={event =>
            dispatch(
              mergeLocalSettings(
                { themeMode: event.target.value as ThemeMode },
                { onSuccess: () => {}, onError: () => {} },
              ),
            )
          }>
          {ALL_THEME_MODES.map(mode => (
            <RadioButton key={mode} label={labels[mode]} value={mode} />
          ))}
        </RadioGroup>
      </SectionContainer>
    </FormContainer>
  )
}
