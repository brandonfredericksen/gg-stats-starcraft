import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { STARCRAFT_DOWNLOAD_URL } from '../../common/url-constants'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { FilledButton, TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch } from '../redux-hooks'
import { openSettings } from '../settings/action-creators'
import { GameSettingsPage } from '../settings/settings-page'
import { BodyLarge } from '../styles/typography'
import { starcraftHealthy } from './health-state'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

/** Says StarCraft can't be found, with the way to point GG Stats at it. */
export function StarcraftHealthCheckupDialog({ onCancel, close }: CommonDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const healthy = useAtomValue(starcraftHealthy)

  useEffect(() => {
    if (healthy) {
      close()
    }
  }, [close, healthy])

  return (
    <StyledDialog
      title={t('starcraft.starcraftHealth.title', "StarCraft wasn't found")}
      onCancel={onCancel}
      showCloseButton={true}
      buttons={[
        <TextButton key='close' label={t('common.actions.close', 'Close')} onClick={onCancel} />,
        <FilledButton
          key='settings'
          label={t('starcraft.starcraftHealth.pickFolder', 'Pick its folder')}
          onClick={() => {
            onCancel()
            dispatch(openSettings(GameSettingsPage.StarCraft))
          }}
        />,
      ]}>
      <BodyLarge>
        <Trans t={t} i18nKey='starcraft.starcraftHealth.body'>
          Analyzing and watching replays needs StarCraft: Remastered. Pick the folder it's installed
          in, or install it from{' '}
          <a href={STARCRAFT_DOWNLOAD_URL} target='_blank' rel='noreferrer noopener'>
            Battle.net
          </a>
          .
        </Trans>
      </BodyLarge>
    </StyledDialog>
  )
}
