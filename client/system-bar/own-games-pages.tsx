import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { FilledButton } from '../material/button'
import { useDemoPlayer } from '../my-stats/demo-player'
import { MyStatsView } from '../my-stats/my-stats-page'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { bodyMedium } from '../styles/typography'
import { openLastGame } from './last-game'
import { OwnGamesNeeded, useOwnGamesState } from './own-games-needed'

const Centered = styled.div`
  ${bodyMedium};
  width: 100%;
  height: 100%;

  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--theme-on-surface-variant);
`

/**
 * Where Last game lands when there's no game of the user's to show. If one turns up while it's
 * open, like after adding names, it offers to open it.
 */
export function LastGamePage() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const state = useOwnGamesState()

  if (!state) {
    return <LoadingDotsArea />
  }
  if (state !== 'found') {
    return <OwnGamesNeeded state={state} />
  }
  return (
    <Centered>
      <FilledButton
        label={t('lastGame.open', 'Open your last game')}
        onClick={() => dispatch(openLastGame())}
      />
    </Centered>
  )
}

/** The user's own stats across their games, which need their names to tell which games are theirs. */
export function MyStatsPage() {
  const state = useOwnGamesState()
  const demo = useDemoPlayer()

  if (!demo && !state) {
    return <LoadingDotsArea />
  }
  if (!demo && state && state !== 'found') {
    return <OwnGamesNeeded state={state} />
  }
  return <MyStatsView />
}
