import { useTranslation } from 'react-i18next'
import styled, { keyframes } from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { bodyMedium, labelMedium, labelSmall } from '../styles/typography'
import { IconButton } from './button'
import { buttonReset } from './button-reset'

/** What kind of news a snackbar carries, which picks its icon and accent color. */
export type SnackbarTone = 'info' | 'success' | 'error'

const toneIcons: Readonly<Record<SnackbarTone, string>> = {
  info: 'info',
  success: 'check_circle',
  error: 'error',
}

const toneColors: Readonly<Record<SnackbarTone, string>> = {
  info: 'var(--theme-info)',
  success: 'var(--theme-positive)',
  error: 'var(--theme-error)',
}

const Root = styled.div<{ $tone: SnackbarTone }>`
  --_tone: ${props => toneColors[props.$tone]};

  position: relative;
  width: 360px;
  max-width: 100%;
  padding: var(--space-3) var(--space-2) var(--space-3) var(--space-3);

  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  column-gap: var(--space-3);
  overflow: hidden;

  background: linear-gradient(180deg, var(--theme-snackbar-sheen), var(--theme-snackbar) 48px);
  border: 1px solid var(--theme-snackbar-border);
  border-radius: var(--radius-lg);
  box-shadow:
    inset 0 1px 0 var(--theme-panel-highlight),
    var(--theme-snackbar-shadow);
  color: var(--theme-on-surface);
`

const ToneIcon = styled.div`
  position: relative;
  width: 32px;
  height: 32px;

  display: flex;
  align-items: center;
  justify-content: center;

  background-color: rgb(from var(--_tone) r g b / 0.14);
  border-radius: var(--radius-md);
  color: var(--_tone);
`

const Body = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
`

const Message = styled.div`
  ${bodyMedium};
  /* Centers a single line against the 32px icon beside it. */
  padding-block: 6px;

  font-weight: 500;
  overflow-wrap: anywhere;
`

const Count = styled.div`
  ${labelSmall};
  position: absolute;
  top: -6px;
  right: -8px;
  min-width: 16px;
  padding: 0 var(--space-1);

  background-color: var(--_tone);
  border-radius: var(--radius-full);
  /* Cuts the badge out of the icon tile beneath it. */
  box-shadow: 0 0 0 2px var(--theme-snackbar-sheen);
  color: var(--theme-snackbar);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  text-align: center;
`

const Action = styled.button`
  ${buttonReset};
  ${labelMedium};
  /* The padding gives the action a comfortable target while its text lines up with the message. */
  margin: 2px 0 0 -8px;
  padding: 6px 8px;

  display: inline-flex;
  align-items: center;
  gap: var(--space-1);

  border-radius: var(--radius-sm);
  color: var(--_tone);
  font-weight: 700;

  &:hover {
    background-color: rgb(from var(--_tone) r g b / 0.12);
  }
`

const CloseButton = styled(IconButton)`
  width: 32px;
  min-height: 32px;
`

const drain = keyframes`
  from {
    transform: scaleX(1);
  }

  to {
    transform: scaleX(0);
  }
`

const Countdown = styled.div<{ $durationMillis: number; $paused: boolean }>`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;

  background-color: var(--_tone);
  transform-origin: left;

  animation: ${drain} ${props => props.$durationMillis}ms linear forwards;
  animation-play-state: ${props => (props.$paused ? 'paused' : 'running')};
`

export interface SnackbarProps {
  message: string
  onDismiss: () => void
  tone?: SnackbarTone
  /** How many times in a row the message was shown. Anything past 1 shows as a badge. */
  count?: number
  actionLabel?: string
  onAction?: () => void
  /**
   * How long the snackbar stays up, shown as a bar along its bottom edge that drains while not
   * `paused` and starts over when `count` changes. Without it the bar isn't shown.
   */
  durationMillis?: number
  paused?: boolean
  className?: string
}

export function Snackbar({
  message,
  onDismiss,
  tone = 'info',
  count = 1,
  actionLabel,
  onAction,
  durationMillis,
  paused = false,
  className,
}: SnackbarProps) {
  const { t } = useTranslation()

  return (
    <Root className={className} $tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      <ToneIcon>
        <MaterialIcon icon={toneIcons[tone]} size={20} />
        {count > 1 ? <Count>×{count}</Count> : undefined}
      </ToneIcon>
      <Body>
        <Message>{message}</Message>
        {actionLabel ? (
          <Action type='button' onClick={onAction}>
            {actionLabel}
            <MaterialIcon icon='arrow_forward' size={16} />
          </Action>
        ) : undefined}
      </Body>
      <CloseButton
        icon={<MaterialIcon icon='close' size={18} />}
        ariaLabel={t('common.actions.close', 'Close')}
        onClick={onDismiss}
      />
      {durationMillis !== undefined ? (
        <Countdown key={count} $durationMillis={durationMillis} $paused={paused} />
      ) : undefined}
    </Root>
  )
}
