import { useAtom } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { DEV_INDICATOR } from '../../../common/flags'
import { TypedIpcRenderer } from '../../../common/ipc'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import { MaterialIcon } from '../../icons/material/material-icon'
import logger from '../../logging/logger'
import { TextButton } from '../../material/button'
import { CheckBox } from '../../material/check-box'
import { Tooltip } from '../../material/tooltip'
import { useStableCallback } from '../../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { starcraftHealthy } from '../../starcraft/health-state'
import { styledWithAttrs } from '../../styles/styled-with-attrs'
import { selectableTextContainer } from '../../styles/text-selection'
import { bodyLarge, bodyMedium, singleLine } from '../../styles/typography'
import { mergeLocalSettings } from '../action-creators'
import { FormContainer, SectionContainer, SectionOverline } from '../settings-content'

const ipcRenderer = new TypedIpcRenderer()

function normalizePath(path: string) {
  return path?.replace(/\\(x86|x86_64)\\?$/, '')
}

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const PathRow = styled.div`
  min-height: 56px;
  padding: 8px 8px 8px 14px;

  display: flex;
  align-items: center;
  gap: 12px;

  background-color: var(--theme-container);
  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-md);
`

const PathIcon = styledWithAttrs(MaterialIcon, { icon: 'folder' })`
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

const PathValue = styled.div`
  ${bodyLarge};
  ${singleLine};
  ${selectableTextContainer};
  flex: 1;
  min-width: 0;
`

const PathMissing = styled.div`
  ${bodyLarge};
  flex: 1;
  color: var(--theme-on-surface-variant);
`

const ValidIcon = styledWithAttrs(MaterialIcon, { icon: 'check_circle' })`
  flex-shrink: 0;
  color: var(--theme-success);
`

const InvalidIcon = styledWithAttrs(MaterialIcon, { icon: 'error' })`
  flex-shrink: 0;
  color: var(--theme-error);
`

const PathProblem = styled.div`
  ${bodyMedium};
  margin-top: -8px;
  color: var(--theme-error);
`

interface StarcraftSettingsModel {
  starcraftPath: string
  launch32Bit?: boolean
  disableHd?: boolean
}

export function StarcraftSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const localSettings = useAppSelector(s => s.settings.local)
  const [isValidInstall] = useAtom(starcraftHealthy)
  const browseButtonRef = useRef<HTMLButtonElement>(null)
  const [detectionFailed, setDetectionFailed] = useState(false)

  const { bindCheckable, getInputValue, setInputValue, submit, form } =
    useForm<StarcraftSettingsModel>(
      {
        starcraftPath: localSettings.starcraftPath,
        launch32Bit: localSettings.launch32Bit,
        disableHd: localSettings.disableHd,
      },
      {},
    )

  useFormCallbacks(form, {
    onValidatedChange: model => {
      dispatch(
        mergeLocalSettings(
          {
            starcraftPath: model.starcraftPath,
            launch32Bit: model.launch32Bit || false,
            disableHd: model.disableHd || false,
          },
          {
            onSuccess: () => {},
            onError: () => {},
          },
        ),
      )
    },
  })

  const onDetectPathClick = useStableCallback(() => {
    setDetectionFailed(false)
    Promise.resolve()
      .then(async () => {
        const pathFound = await ipcRenderer.invoke('settingsAutoPickStarcraftPath')
        if (!pathFound) {
          logger.warning('Failed to detect StarCraft folder')
          setDetectionFailed(true)
        }
      })
      .catch(err => {
        logger.error(`Failed to detect StarCraft folder: ${err?.stack ?? err}`)
        setDetectionFailed(true)
      })
  })

  const onBrowseClick = useStableCallback(() => {
    setDetectionFailed(false)
    Promise.resolve()
      .then(async () => {
        const currentPath = getInputValue('starcraftPath') || ''

        const selection = await ipcRenderer.invoke('settingsBrowseForStarcraft', currentPath)!
        const selectedPath = selection.filePaths[0]
        browseButtonRef.current?.blur()

        if (selection.canceled || currentPath.toLowerCase() === selectedPath.toLowerCase()) return

        setInputValue('starcraftPath', normalizePath(selectedPath))
      })
      .catch(err => {
        logger.error(`Failed to browse for StarCraft folder: ${err?.stack ?? err}`)
      })
  })

  let pathStatus: React.ReactNode = null
  if (localSettings.starcraftPath && isValidInstall) {
    pathStatus = (
      <Tooltip
        text={t(
          'settings.game.starcraft.pathValid',
          'This is a working StarCraft: Remastered install.',
        )}>
        <ValidIcon />
      </Tooltip>
    )
  } else if (localSettings.starcraftPath) {
    pathStatus = <InvalidIcon />
  }

  let pathProblem: string | undefined
  if (detectionFailed) {
    pathProblem = t(
      'settings.game.starcraft.detectionFailedShort',
      "Couldn't find StarCraft: Remastered. Browse to its folder instead.",
    )
  } else if (localSettings.starcraftPath && !isValidInstall) {
    pathProblem = t(
      'settings.game.starcraft.pathInvalidShort',
      "This folder isn't an up to date StarCraft: Remastered install.",
    )
  }

  return (
    <form noValidate={true} onSubmit={submit}>
      <FormContainer>
        <Layout>
          <PathRow>
            <PathIcon />
            {localSettings.starcraftPath ? (
              <PathValue title={localSettings.starcraftPath}>
                {localSettings.starcraftPath}
              </PathValue>
            ) : (
              <PathMissing>
                {t('settings.game.starcraft.pathNotSet', 'No StarCraft folder set')}
              </PathMissing>
            )}
            {pathStatus}
            <TextButton
              onClick={onDetectPathClick}
              label={t('settings.game.starcraft.detect', 'Detect')}
            />
            <TextButton
              ref={browseButtonRef}
              label={t('settings.game.starcraft.browse', 'Browse…')}
              onClick={onBrowseClick}
            />
          </PathRow>

          {pathProblem ? <PathProblem>{pathProblem}</PathProblem> : null}

          <CheckBox
            {...bindCheckable('launch32Bit')}
            label={t(
              'settings.game.starcraft.launch32Bit',
              'Launch the 32-bit game client (not recommended)',
            )}
            inputProps={{ tabIndex: 0 }}
          />

          {DEV_INDICATOR ? (
            <SectionContainer>
              <SectionOverline>
                {t('settings.game.starcraft.devOnlySettings', 'Dev-only settings')}
              </SectionOverline>
              <CheckBox
                {...bindCheckable('disableHd')}
                label={t(
                  'settings.game.starcraft.disableHd',
                  "Don't load HD graphics (Crashes if switching to HD in game)",
                )}
                inputProps={{ tabIndex: 0 }}
              />
            </SectionContainer>
          ) : null}
        </Layout>
      </FormContainer>
    </form>
  )
}
