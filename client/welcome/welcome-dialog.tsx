import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import logo from '../logos/logo.png'
import { FilledButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { mergeLocalSettings } from '../settings/action-creators'
import { bodyLarge, bodyMedium, titleMedium } from '../styles/typography'

const StyledDialog = styled(Dialog)`
  max-width: 520px;
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
`

const Intro = styled.div`
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
`

const Logo = styled.img`
  width: 56px;
  height: 56px;
  flex-shrink: 0;
`

const Paragraphs = styled.div`
  ${bodyLarge};
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
`

const Options = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
`

const OptionsTitle = styled.div`
  ${titleMedium};
  margin-bottom: var(--space-1);
`

const Hint = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const OptionHint = styled(Hint)`
  margin: -4px 0 var(--space-2) 28px;
`

/**
 * Says what GG Stats does on a new install, and asks the two things that decide whether games get
 * analyzed on their own: starting with Windows and analyzing each game when it ends.
 */
export function WelcomeDialog({ onCancel, close }: CommonDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const autoCaptureSetting = useAppSelector(s => s.settings.local.autoCapture !== false)
  const [startWithWindows, setStartWithWindows] = useState(true)
  const [autoCapture, setAutoCapture] = useState(autoCaptureSetting)

  const onStart = () => {
    dispatch(
      mergeLocalSettings(
        {
          welcomeShown: true,
          startWithWindowsOffered: true,
          runAppAtSystemStart: startWithWindows,
          ...(startWithWindows ? { runAppAtSystemStartMinimized: true } : {}),
          autoCapture,
        },
        { onSuccess: () => {}, onError: () => {} },
      ),
    )
    close()
  }

  return (
    <StyledDialog
      title={t('welcome.title', 'Welcome to GG Stats')}
      onCancel={onCancel}
      buttons={[
        <FilledButton key='start' label={t('welcome.start', 'Get started')} onClick={onStart} />,
      ]}>
      <Content>
        <Intro>
          <Logo src={logo} alt='' aria-hidden={true} />
          <Paragraphs>
            <div>
              {t('welcome.analyzes', 'GG Stats analyzes your replays and shows the stats in them.')}
            </div>
            <div>
              {t(
                'welcome.baseline',
                'It comes with recent ladder games to compare you against, and the builds ' +
                  "played in them. It also estimates each player's ladder rank from how they play.",
              )}
            </div>
          </Paragraphs>
        </Intro>
        <Options>
          <OptionsTitle>{t('welcome.optionsTitle', 'Your games')}</OptionsTitle>
          <CheckBox
            checked={startWithWindows}
            onChange={event => setStartWithWindows(event.target.checked)}
            label={t('welcome.startWithWindows', 'Start with Windows, in the tray')}
            inputProps={{ tabIndex: 0 }}
          />
          <OptionHint>
            {t('welcome.startWithWindowsHint', 'Games are only analyzed while GG Stats runs.')}
          </OptionHint>
          <CheckBox
            checked={autoCapture}
            onChange={event => setAutoCapture(event.target.checked)}
            label={t('welcome.autoCapture', 'Analyze each game when it ends')}
            inputProps={{ tabIndex: 0 }}
          />
          <OptionHint>
            {t('welcome.autoCaptureHint', 'It happens in the background, out of your way.')}
          </OptionHint>
        </Options>
        <Hint>{t('welcome.settingsHint', 'You can change these in Settings.')}</Hint>
      </Content>
    </StyledDialog>
  )
}
