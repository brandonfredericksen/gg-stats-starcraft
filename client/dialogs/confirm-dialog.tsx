import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { FilledButton, TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { BodyLarge } from '../styles/typography'
import { CommonDialogProps } from './common-dialog-props'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const ConfirmButton = styled(FilledButton)`
  background-color: var(--theme-negative);
  color: var(--theme-negative-invert);
`

export interface ConfirmDialogProps extends CommonDialogProps {
  confirmTitle: string
  confirmBody: string
  confirmLabel: string
  onConfirm: () => void
}

/** Asks before something that's hard to take back, like moving many replays to the Recycle Bin. */
export function ConfirmDialog({
  confirmTitle,
  confirmBody,
  confirmLabel,
  onConfirm,
  onCancel,
  close,
}: ConfirmDialogProps) {
  const { t } = useTranslation()

  return (
    <StyledDialog
      title={confirmTitle}
      onCancel={onCancel}
      showCloseButton={true}
      buttons={[
        <TextButton key='cancel' label={t('common.actions.cancel', 'Cancel')} onClick={onCancel} />,
        <ConfirmButton
          key='confirm'
          label={confirmLabel}
          onClick={() => {
            close()
            onConfirm()
          }}
        />,
      ]}>
      <BodyLarge>{confirmBody}</BodyLarge>
    </StyledDialog>
  )
}
