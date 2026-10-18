import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { DEV_ERROR } from '../../common/flags'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { FilledButton, TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium } from '../styles/typography'
import { checkGgStatsFiles } from './check-gg-stats-files-ipc'
import { ggStatsFilesState, ggStatsHealthy } from './health-state'

const StyledDialog = styled(Dialog)`
  max-width: 520px;
`

const Text = styled.p`
  ${bodyLarge};
  margin: 0;

  & + & {
    margin-top: var(--space-4);
  }
`

const FileList = styled.ul`
  ${bodyMedium};
  margin: var(--space-3) 0 var(--space-4);
`

const DevContent = styled.p`
  ${bodyMedium};
  margin: 0 0 var(--space-4);
  color: var(--theme-error);
`

/** Says which of GG Stats' own files are missing, and lets the user check again once restored. */
export function GgStatsHealthDialog({ onCancel, close }: CommonDialogProps) {
  const { t } = useTranslation()
  const files = useAtomValue(ggStatsFilesState)
  const healthy = useAtomValue(ggStatsHealthy)
  const snackbarController = useSnackbarController()

  useEffect(() => {
    if (healthy) {
      close()
    }
  }, [healthy, close])

  const missing = [
    files?.init ? undefined : 'sb_init.dll',
    files?.main ? undefined : 'ggstats.dll',
    files?.init64 ? undefined : 'sb_init_64.dll',
    files?.main64 ? undefined : 'ggstats_64.dll',
  ].filter(Boolean)

  return (
    <StyledDialog
      title={t('starcraft.ggStatsHealth.title', 'GG Stats files are missing')}
      onCancel={onCancel}
      showCloseButton={true}
      buttons={[
        <TextButton key='close' label={t('common.actions.close', 'Close')} onClick={onCancel} />,
        <FilledButton
          key='check'
          label={t('starcraft.ggStatsHealth.checkAgain', 'Check again')}
          onClick={() => {
            checkGgStatsFiles()
              .then(allThere => {
                if (!allThere) {
                  snackbarController.showSnackbar(
                    t('starcraft.ggStatsHealth.stillMissing', 'Still missing.'),
                    { tone: 'error' },
                  )
                }
              })
              .catch(swallowNonBuiltins)
          }}
        />,
      ]}>
      {DEV_ERROR ? (
        <DevContent>
          Couldn't find the game DLLs, you probably need to run game/build.bat
        </DevContent>
      ) : null}
      <Text>
        {t(
          'starcraft.ggStatsHealth.missing',
          'GG Stats needs these files to analyze and watch replays:',
        )}
      </Text>
      <FileList>
        {missing.map(file => (
          <li key={file}>{file}</li>
        ))}
      </FileList>
      <Text>
        {t(
          'starcraft.ggStatsHealth.antivirus',
          'Antivirus software sometimes quarantines them by mistake. Restore them from its quarantine, or reinstall GG Stats.',
        )}
      </Text>
    </StyledDialog>
  )
}
