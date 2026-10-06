import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../../common/errors'
import { isMyPlayerName } from '../../../common/games/player-names'
import {
  getSuggestedPlayerNames,
  setMyPlayerNames,
  useMyPlayerNames,
} from '../../games/my-player-names'
import { MaterialIcon } from '../../icons/material/material-icon'
import logger from '../../logging/logger'
import { FilledButton, OutlinedButton, TextButton } from '../../material/button'
import { buttonReset } from '../../material/button-reset'
import { TextField } from '../../material/text-field'
import { useAppDispatch } from '../../redux-hooks'
import { bodyMedium, bodySmall, labelLarge, titleSmall } from '../../styles/typography'
import {
  FormContainer,
  SectionContainer,
  SettingsSectionDescription,
  SettingsSectionHeader,
} from '../settings-content'

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`

const NameChip = styled.span`
  ${labelLarge};
  height: 34px;
  padding: 0 4px 0 14px;

  display: inline-flex;
  align-items: center;
  gap: 4px;

  background-color: var(--theme-container-highest);
  border-radius: var(--radius-full);
  font-weight: 600;
`

const RemoveButton = styled.button`
  ${buttonReset};
  width: 26px;
  height: 26px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: var(--radius-full);
  color: var(--theme-on-surface-variant);
  cursor: pointer;

  &:hover {
    background-color: var(--theme-container-high);
    color: var(--theme-on-surface);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 1px;
  }
`

const NoNames = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const AddRow = styled.div`
  max-width: 440px;
  display: flex;
  align-items: center;
  gap: 8px;

  & > :first-child {
    flex: 1;
    min-width: 0;
  }
`

const Notice = styled.section`
  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 12px;

  background-color: var(--theme-container);
  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-md);
`

const NoticeTitle = styled.div`
  ${titleSmall};
`

const NoticeBody = styled.div`
  ${bodySmall};
  margin-top: 2px;
  color: var(--theme-on-surface-variant);
`

const PickChip = styled.button<{ $on: boolean }>`
  ${buttonReset};
  ${labelLarge};
  height: 32px;
  padding: 0 12px 0 8px;

  display: inline-flex;
  align-items: center;
  gap: 6px;

  border: 1px ${props => (props.$on ? 'solid var(--theme-outline)' : 'dashed var(--theme-outline)')};
  border-radius: var(--radius-full);
  background-color: ${props => (props.$on ? 'var(--theme-container-highest)' : 'transparent')};
  color: ${props => (props.$on ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)')};
  font-weight: 600;
  cursor: pointer;

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

/** The names the user plays under, which personal stats are counted for. */
export function AppPlayerNamesSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const myNames = useMyPlayerNames()
  const [suggested, setSuggested] = useState<string[]>([])
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [draft, setDraft] = useState('')

  const unconfirmed = myNames === undefined
  const [unconfirmedAtStart] = useState(unconfirmed)
  const [namesAtStart] = useState(() => myNames ?? [])

  useEffect(() => {
    let active = true
    getSuggestedPlayerNames(namesAtStart)
      .then(names => {
        if (active) {
          setSuggested(names)
          // Before the user has answered, every suggestion starts picked, since most are likely
          // theirs. Afterwards, nothing is added without a click.
          if (unconfirmedAtStart) {
            setPicked(new Set(names))
          }
        }
      })
      .catch(err => {
        logger.error(`Error getting suggested player names: ${getErrorStack(err)}`)
      })
    return () => {
      active = false
    }
  }, [unconfirmedAtStart, namesAtStart])

  const confirmed = myNames ?? []
  const offered = unconfirmed ? suggested : suggested.filter(n => !isMyPlayerName(n, confirmed))
  const pickedOffered = offered.filter(n => picked.has(n))

  const save = (names: ReadonlyArray<string>) => dispatch(setMyPlayerNames(names))
  const addDraft = () => {
    if (draft.trim()) {
      save([...confirmed, draft.trim()])
      setDraft('')
    }
  }
  const togglePicked = (name: string) => {
    const next = new Set(picked)
    if (next.has(name)) {
      next.delete(name)
    } else {
      next.add(name)
    }
    setPicked(next)
  }

  return (
    <FormContainer>
      <SectionContainer>
        <SettingsSectionHeader>
          {t('settings.app.playerNames.title', 'Your names')}
        </SettingsSectionHeader>
        <SettingsSectionDescription>
          {t(
            'settings.app.playerNames.description',
            "Replays don't say which player was you. Add the names you play under, on any " +
              'account, to see your record and My stats. With none, games show both sides evenly.',
          )}
        </SettingsSectionDescription>

        <Body>
          {unconfirmed ? null : (
            <Chips>
              {confirmed.length ? (
                confirmed.map(name => (
                  <NameChip key={name}>
                    {name}
                    <RemoveButton
                      type='button'
                      aria-label={t('settings.app.playerNames.remove', 'Remove {{name}}', {
                        name,
                      })}
                      onClick={() => save(confirmed.filter(n => n !== name))}>
                      <MaterialIcon icon='close' size={18} />
                    </RemoveButton>
                  </NameChip>
                ))
              ) : (
                <NoNames>
                  {t('settings.app.playerNames.empty', 'No names yet. Stats are not tracked.')}
                </NoNames>
              )}
            </Chips>
          )}

          <AddRow>
            <TextField
              value={draft}
              dense={true}
              allowErrors={false}
              label={t('settings.app.playerNames.addLabel', 'Add a name')}
              onChange={event => setDraft(event.target.value)}
              onEnterKeyDown={addDraft}
            />
            <OutlinedButton
              label={t('settings.app.playerNames.addButton', 'Add')}
              disabled={!draft.trim()}
              onClick={addDraft}
            />
          </AddRow>

          {offered.length ? (
            <Notice aria-label={t('settings.app.playerNames.suggestedLabel', 'Suggested names')}>
              <div>
                <NoticeTitle>
                  {unconfirmed
                    ? t('settings.app.playerNames.askTitle', 'Which of these names are you?')
                    : t('settings.app.playerNames.foundTitle', 'Found in your replays')}
                </NoticeTitle>
                <NoticeBody>
                  {t(
                    'settings.app.playerNames.foundBody',
                    'These names show up in a lot of your replays. Pick the ones that are you.',
                  )}
                </NoticeBody>
              </div>
              <Chips>
                {offered.map(name => (
                  <PickChip
                    key={name}
                    type='button'
                    $on={picked.has(name)}
                    aria-pressed={picked.has(name)}
                    onClick={() => togglePicked(name)}>
                    <MaterialIcon icon={picked.has(name) ? 'check' : 'add'} size={18} />
                    {name}
                  </PickChip>
                ))}
              </Chips>
              <Actions>
                <FilledButton
                  label={
                    unconfirmed
                      ? t('settings.app.playerNames.confirm', 'These are me')
                      : t('settings.app.playerNames.addPicked', 'Add to my names')
                  }
                  disabled={pickedOffered.length === 0}
                  onClick={() => save([...confirmed, ...pickedOffered])}
                />
                {unconfirmed ? (
                  <TextButton
                    label={t('settings.app.playerNames.none', "Don't track my stats")}
                    onClick={() => save([])}
                  />
                ) : (
                  <TextButton
                    label={t('settings.app.playerNames.notMe', 'None of these')}
                    onClick={() => setSuggested([])}
                  />
                )}
              </Actions>
            </Notice>
          ) : null}
        </Body>
      </SectionContainer>
    </FormContainer>
  )
}
