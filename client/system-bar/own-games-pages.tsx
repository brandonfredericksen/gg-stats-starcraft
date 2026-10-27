import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Redirect } from 'wouter'
import { getGameDurationString } from '../../common/games/game-duration'
import { FASTEST_MS_PER_FRAME } from '../../common/games/game-stats'
import { filterColorCodes } from '../../common/maps'
import { useFormatLocale } from '../i18n/locale-formats'
import { FilledButton } from '../material/button'
import { panelSurface } from '../material/panel'
import { useDemoPlayer } from '../my-stats/demo-player'
import { MyStatsView } from '../my-stats/my-stats-page'
import { rememberRecentPlayer, usePlayerAccounts } from '../players/open-player'
import { PageLoadingIndicator } from '../progress/page-loading'
import { useCurrentMinuteMs } from '../react/date-hooks'
import { useAppDispatch } from '../redux-hooks'
import { getPlayedDayLabel } from '../replays/replay-days'
import { getLayoutMatchup, getReplayDisplayTeams } from '../replays/replay-library-helpers'
import { bodyMedium, labelMedium, singleLine, titleLarge } from '../styles/typography'
import { openLastGame } from './last-game'
import { OwnGamesNeeded, useNewestOwnGame } from './own-games-needed'

const Root = styled.div`
  width: 100%;
  height: 100%;
  padding: var(--space-8);

  display: flex;
  align-items: center;
  justify-content: center;
`

const Card = styled.section`
  ${panelSurface};
  width: 100%;
  max-width: 520px;
  padding: 24px 28px;

  display: flex;
  align-items: center;
  gap: var(--space-5);
`

const GameText = styled.div`
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
`

const Overline = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const MapName = styled.div`
  ${titleLarge};
  ${singleLine};
`

const Meta = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

/**
 * Where Last game lands when there's no game of the user's to show. If one turns up while it's
 * open, like after adding names, it shows the game with a button to open it.
 */
export function LastGamePage() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const locale = useFormatLocale()
  const nowMs = useCurrentMinuteMs()
  const newest = useNewestOwnGame()

  if (!newest) {
    return <PageLoadingIndicator />
  }
  if (newest.state !== 'found') {
    return <OwnGamesNeeded state={newest.state} onRetry={newest.retry} />
  }
  const { entry } = newest
  const matchup = getLayoutMatchup(getReplayDisplayTeams(entry.players))
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(
    entry.gameTime,
  )
  const meta = [
    matchup,
    getGameDurationString(entry.durationFrames * FASTEST_MS_PER_FRAME),
    t('gameStats.playedAt', '{{day}}, {{time}}', {
      day: getPlayedDayLabel(entry.gameTime, nowMs, locale, t),
      time,
    }),
  ].filter(Boolean)
  return (
    <Root>
      <Card>
        <GameText>
          <Overline>{t('lastGame.overline', 'Your last game')}</Overline>
          <MapName>{filterColorCodes(entry.mapName)}</MapName>
          <Meta>{meta.join(' · ')}</Meta>
        </GameText>
        <FilledButton
          label={t('lastGame.openGame', 'Open')}
          onClick={() => dispatch(openLastGame())}
        />
      </Card>
    </Root>
  )
}

/** The user's own stats across their games, which need their names to tell which games are theirs. */
export function MyStatsPage() {
  const newest = useNewestOwnGame()
  const demo = useDemoPlayer()

  if (!demo && !newest) {
    return <PageLoadingIndicator />
  }
  if (!demo && newest && newest.state !== 'found') {
    return <OwnGamesNeeded state={newest.state} onRetry={newest.retry} />
  }
  return <MyStatsView />
}

/** Another player's stats, the same as the user's own, from every analyzed game they were in. */
export function PlayerStatsPage({ params }: { params: { name: string } }) {
  const { name } = params
  const { accounts, isMe } = usePlayerAccounts(name)
  const dispatch = useAppDispatch()

  useEffect(() => {
    if (!isMe) {
      dispatch(rememberRecentPlayer(name))
    }
  }, [name, isMe, dispatch])

  if (isMe) {
    return <Redirect to='/my-stats' replace={true} />
  }
  return <MyStatsView key={name} player={{ name, accounts }} />
}
