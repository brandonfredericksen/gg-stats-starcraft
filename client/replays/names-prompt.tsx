import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getSuggestedPlayerNames, setMyPlayerNames } from '../games/my-player-names'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from '../material/button-reset'
import { panelSurface } from '../material/panel'
import { useAppDispatch } from '../redux-hooks'
import { openSettings } from '../settings/action-creators'
import { AppSettingsPage } from '../settings/settings-page'
import { bodySmall, labelLarge, titleSmall } from '../styles/typography'

const Root = styled.section`
  ${panelSurface};
  padding: 16px 20px;

  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
`

const Text = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const Title = styled.div`
  ${titleSmall};
  font-size: 15px;
  font-weight: 700;
`

const Body = styled.div`
  ${bodySmall};
  font-size: 13px;
  color: var(--theme-on-surface-variant);
`

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const Chip = styled.button<{ $on: boolean }>`
  ${buttonReset};
  ${labelLarge};
  height: 34px;
  padding: 0 12px 0 10px;

  display: inline-flex;
  align-items: center;
  gap: 6px;

  border: 1px solid
    ${props => (props.$on ? 'var(--theme-outline)' : 'var(--theme-outline-variant)')};
  border-radius: var(--radius-full);
  background-color: ${props => (props.$on ? 'var(--theme-container-highest)' : 'transparent')};
  color: var(--theme-on-surface);
  font-weight: 600;
  cursor: pointer;

  & > :first-child {
    color: ${props => (props.$on ? 'var(--theme-on-surface)' : 'transparent')};
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const Divider = styled.span`
  width: 1px;
  height: 24px;
  margin: 0 4px;
  background-color: var(--theme-outline-variant);
`

const TextAction = styled.button<{ $primary?: boolean; $muted?: boolean }>`
  ${buttonReset};
  ${labelLarge};
  height: 36px;
  padding: ${props => (props.$primary ? '0 16px' : '0 12px')};

  border-radius: var(--radius-md);
  background-color: ${props => (props.$primary ? 'var(--theme-on-surface)' : 'transparent')};
  color: ${props => {
    if (props.$primary) {
      return 'var(--theme-surface)'
    }
    return props.$muted ? 'var(--theme-on-surface-variant)' : 'var(--theme-on-surface)'
  }};
  font-weight: ${props => (props.$primary ? 700 : 600)};
  white-space: nowrap;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

/**
 * Asks which player names are the user's, offering the ones seen most in their replays, so their
 * own games can be told apart from downloaded ones. Shown until they answer.
 */
export function NamesPrompt() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [suggested, setSuggested] = useState<string[]>()
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    getSuggestedPlayerNames([])
      .then(names => {
        setSuggested(names)
        setPicked(new Set(names))
      })
      .catch(swallowNonBuiltins)
  }, [])

  const toggle = (name: string) => {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  return (
    <Root aria-label={t('replays.names.label', 'Your player names')}>
      <Text>
        <Title>{t('replays.names.title', 'Which of these names are you?')}</Title>
        <Body>
          {t(
            'replays.names.body',
            'Your names group your own games into sessions and keep downloaded replays apart. You can change them in Settings.',
          )}
        </Body>
      </Text>
      <Actions>
        {suggested?.map(name => (
          <Chip
            key={name}
            type='button'
            $on={picked.has(name)}
            aria-pressed={picked.has(name)}
            onClick={() => toggle(name)}>
            <MaterialIcon icon='check' size={16} />
            {name}
          </Chip>
        ))}
        {suggested?.length ? <Divider /> : null}
        {suggested?.length ? (
          <TextAction
            type='button'
            $primary={true}
            disabled={picked.size === 0}
            onClick={() => dispatch(setMyPlayerNames([...picked]))}>
            {t('replays.names.confirm', "That's me")}
          </TextAction>
        ) : null}
        <TextAction
          type='button'
          onClick={() => dispatch(openSettings(AppSettingsPage.PlayerNames))}>
          {t('replays.names.other', 'Other names…')}
        </TextAction>
        <TextAction type='button' $muted={true} onClick={() => dispatch(setMyPlayerNames([]))}>
          {t('replays.names.skip', 'Skip')}
        </TextAction>
      </Actions>
    </Root>
  )
}
