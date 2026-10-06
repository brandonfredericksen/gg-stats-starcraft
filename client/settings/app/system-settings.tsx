import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import { CheckBox } from '../../material/check-box'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { mergeLocalSettings } from '../action-creators'
import { FormContainer, SectionContainer, SettingsSectionHeader } from '../settings-content'

const IndentedCheckBox = styled(CheckBox)`
  margin-left: 28px;
`

interface AppSystemSettingsModel {
  runAppAtSystemStart: boolean
  runAppAtSystemStartMinimized: boolean
  checkForUpdates: boolean
}

export function AppSystemSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const localSettings = useAppSelector(s => s.settings.local)

  const { bindCheckable, getInputValue, submit, form } = useForm<AppSystemSettingsModel>(
    {
      runAppAtSystemStart: localSettings.runAppAtSystemStart,
      runAppAtSystemStartMinimized: localSettings.runAppAtSystemStartMinimized,
      checkForUpdates: localSettings.checkForUpdates !== false,
    },
    {},
  )

  useFormCallbacks(form, {
    onValidatedChange: model => {
      dispatch(
        mergeLocalSettings(
          {
            runAppAtSystemStart: model.runAppAtSystemStart,
            runAppAtSystemStartMinimized: model.runAppAtSystemStartMinimized,
            checkForUpdates: model.checkForUpdates,
          },
          {
            onSuccess: () => {},
            onError: () => {},
          },
        ),
      )
    },
  })

  return (
    <form noValidate={true} onSubmit={submit}>
      <FormContainer>
        <SectionContainer>
          <SettingsSectionHeader>
            {t('settings.app.system.startupOverline', 'Startup')}
          </SettingsSectionHeader>
          <CheckBox
            {...bindCheckable('runAppAtSystemStart')}
            label={t('settings.app.system.runOnStartup', 'Run GG Stats on system startup')}
            inputProps={{ tabIndex: 0 }}
          />
          <IndentedCheckBox
            {...bindCheckable('runAppAtSystemStartMinimized')}
            label={t('settings.app.system.startMinimized', 'Start minimized')}
            inputProps={{ tabIndex: 0 }}
            disabled={!getInputValue('runAppAtSystemStart')}
          />
        </SectionContainer>
        <SectionContainer>
          <SettingsSectionHeader>
            {t('settings.app.system.updatesOverline', 'Updates')}
          </SettingsSectionHeader>
          <CheckBox
            {...bindCheckable('checkForUpdates')}
            label={t(
              'settings.app.system.checkForUpdates',
              'Check GitHub for new versions and install them',
            )}
            inputProps={{ tabIndex: 0 }}
          />
        </SectionContainer>
      </FormContainer>
    </form>
  )
}
