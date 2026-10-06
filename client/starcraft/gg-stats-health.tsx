import { useAtom } from 'jotai'
import { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { DEV_ERROR } from '../../common/flags'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { FilledButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium } from '../styles/typography'
import { checkGgStatsFiles } from './check-gg-stats-files-ipc'
import { ggStatsFilesState, ggStatsHealthy } from './health-state'

const Text = styled.div`
  ${bodyLarge};

  & + & {
    margin-top: 24px;
  }
`

const FileList = styled.ul`
  ${bodyMedium};
  margin-bottom: 40px;
`

const RescanButton = styled(FilledButton)`
  margin-top: 40px;
`

const DevContent = styled.div`
  margin-bottom: 24px;
  color: var(--theme-error);
`

export function GgStatsHealthDialog({ onCancel, close }: CommonDialogProps) {
  const { t } = useTranslation()
  const [files] = useAtom(ggStatsFilesState)
  const [healthy] = useAtom(ggStatsHealthy)
  const snackbarController = useSnackbarController()

  useEffect(() => {
    if (healthy) {
      snackbarController.showSnackbar(
        t('starcraft.ggStatsHealth.noProblems', 'Your local installation is now free of problems.'),
      )
      close()
    }
  }, [healthy, close, snackbarController, t])

  const initDescription = files.init ? null : <li>sb_init.dll</li>
  const mainDescription = files.main ? null : <li>ggstats.dll</li>
  const init64Description = files.init64 ? null : <li>sb_init_64.dll</li>
  const main64Description = files.main64 ? null : <li>ggstats_64.dll</li>

  return (
    <Dialog
      title={t('starcraft.ggStatsHealth.title', 'Installation problems detected')}
      onCancel={onCancel}
      showCloseButton={true}>
      {DEV_ERROR ? (
        <DevContent>
          <Text>Couldn't find the game DLLs, you probably need to run game/build.bat</Text>
        </DevContent>
      ) : null}

      <div>
        <Text>
          <Trans t={t} i18nKey='starcraft.ggStatsHealth.topContents'>
            We've detected that the following GG Stats files are missing or have been modified:
          </Trans>
        </Text>
        <FileList>
          {initDescription}
          {mainDescription}
          {init64Description}
          {main64Description}
        </FileList>

        <Text>
          <Trans t={t} i18nKey='starcraft.ggStatsHealth.middleContents'>
            This is often the result of installed anti-virus software taking action on false
            positives. You may need to add exceptions for these files, or tell the software to
            remove them from quarantine. You can also try reinstalling GG Stats.
          </Trans>
        </Text>

        <Text>
          <Trans t={t} i18nKey='starcraft.ggStatsHealth.bottomContents'>
            If you are able to, reporting these as false positives to your anti-virus vendor will
            help this stop happening for other users as well!
          </Trans>
        </Text>
      </div>

      <RescanButton
        label={t('starcraft.ggStatsHealth.rescanFiles', 'Rescan files')}
        onClick={() => checkGgStatsFiles()}
      />
    </Dialog>
  )
}
