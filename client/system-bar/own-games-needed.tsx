import { debounce } from 'lodash-es'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import { ReplayLibraryEntry } from '../../common/replays-library'
import { useMyPlayerNames } from '../games/my-player-names'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { FilledButton, TextButton } from '../material/button'
import { panelSurface } from '../material/panel'
import { useAppDispatch } from '../redux-hooks'
import { openSettings } from '../settings/action-creators'
import { AppSettingsPage } from '../settings/settings-page'
import { bodyMedium, titleLarge } from '../styles/typography'

const ipcRenderer = new TypedIpcRenderer()

/**
 * Whether the library has a game the user played in: `found` when it does, `noNames` when they
 * haven't said which names are theirs, `noGames` when no replay has a player by one of them, and
 * `failed` when the library couldn't be asked.
 */
export type OwnGamesState = 'noNames' | 'noGames' | 'found' | 'failed'

/** How long to wait after the library changes before looking again. */
const REFRESH_DELAY_MS = 500

/** Finds the user's newest game in the library, or why there isn't one. */
export async function findNewestOwnGame(myNames: ReadonlyArray<string> | undefined) {
  if (!myNames?.length) {
    return { state: 'noNames' as const }
  }
  const result = await ipcRenderer.invoke('replayLibraryQuery', {
    limit: 1,
    whose: { names: [...myNames], match: 'mine' },
  })
  const entry = result?.entries.find(e => !e.parseError)
  return entry ? { state: 'found' as const, entry } : { state: 'noGames' as const }
}

/**
 * Tracks the user's newest game in the library, or why there isn't one, undefined while checking.
 * It looks again whenever the library changes, so games found by a first scan show up.
 */
export function useNewestOwnGame(): NewestOwnGame | undefined {
  const myNames = useMyPlayerNames()
  const [newest, setNewest] = useState<NewestOwnGame>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    const look = () => {
      findNewestOwnGame(myNames)
        .then(result => {
          if (active) {
            setNewest(result)
          }
        })
        .catch(err => {
          logger.error(`Error looking for the user's games: ${getErrorStack(err)}`)
          if (active) {
            setNewest({ state: 'failed' })
          }
        })
    }
    look()

    const refresh = debounce(look, REFRESH_DELAY_MS)
    ipcRenderer.on('replayLibraryChanged', refresh)
    return () => {
      active = false
      refresh.cancel()
      ipcRenderer.removeListener('replayLibraryChanged', refresh)
    }
  }, [myNames, attempt])

  return newest && { ...newest, retry: () => setAttempt(a => a + 1) }
}

export type NewestOwnGame =
  | { state: 'found'; entry: ReplayLibraryEntry; retry?: () => void }
  | { state: Exclude<OwnGamesState, 'found'>; retry?: () => void }

const Root = styled.div`
  width: 100%;
  height: 100%;
  padding: 32px;

  display: flex;
  align-items: center;
  justify-content: center;
`

const Card = styled.section`
  ${panelSurface};
  width: 100%;
  max-width: 520px;
  padding: 28px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
`

const IconTile = styled.div`
  width: 44px;
  height: 44px;

  display: flex;
  align-items: center;
  justify-content: center;

  background-color: var(--theme-container-highest);
  border-radius: var(--radius-md);
  color: var(--theme-on-surface-variant);
`

const Title = styled.h2`
  ${titleLarge};
  margin: 4px 0 0;
`

const Body = styled.p`
  ${bodyMedium};
  margin: 0;
  color: var(--theme-on-surface-variant);
`

const Actions = styled.div`
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
`

/**
 * Explains that a page about the user's own games needs their names, or replays with those names
 * in them, and links to the settings for each. If the library couldn't be asked, it says so.
 */
export function OwnGamesNeeded({
  state,
  onRetry,
}: {
  state: 'noNames' | 'noGames' | 'failed'
  onRetry?: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  if (state === 'failed') {
    return (
      <Root>
        <Card role='alert'>
          <IconTile>
            <MaterialIcon icon='error' size={24} />
          </IconTile>
          <Title>{t('ownGames.failedTitle', "Your games couldn't be looked up")}</Title>
          <Actions>
            <FilledButton label={t('ownGames.tryAgain', 'Try again')} onClick={onRetry} />
          </Actions>
        </Card>
      </Root>
    )
  }

  return (
    <Root>
      <Card>
        <IconTile>
          <MaterialIcon icon={state === 'noNames' ? 'badge' : 'folder_open'} size={24} />
        </IconTile>
        <Title>
          {state === 'noNames'
            ? t('ownGames.noNamesTitle', 'Which player are you?')
            : t('ownGames.noGamesTitle', 'None of your games yet')}
        </Title>
        <Body>
          {state === 'noNames'
            ? t(
                'ownGames.noNamesBody',
                "Replays don't say which player was you. Add the names you play under, and " +
                  'GG Stats finds your games and your stats.',
              )
            : t(
                'ownGames.noGamesBody',
                'No replay in your library has a player with one of your names. Check the names, or add the folder StarCraft saves your replays to.',
              )}
        </Body>
        <Actions>
          <FilledButton
            label={
              state === 'noNames'
                ? t('ownGames.addNames', 'Add your names')
                : t('ownGames.editNames', 'Check your names')
            }
            onClick={() => dispatch(openSettings(AppSettingsPage.PlayerNames))}
          />
          <TextButton
            label={t('ownGames.addReplays', 'Add replays')}
            onClick={() => dispatch(openSettings(AppSettingsPage.Replays))}
          />
        </Actions>
      </Card>
    </Root>
  )
}
