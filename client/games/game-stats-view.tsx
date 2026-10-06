import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { withAssumedResults } from '../../common/games/assumed-results'
import { getGameDurationString } from '../../common/games/game-duration'
import { GameStats, GameStatsSource } from '../../common/games/game-stats'
import { MaterialIcon } from '../icons/material/material-icon'
import { Card } from '../material/card'
import { Tooltip } from '../material/tooltip'
import { bodyLarge } from '../styles/typography'
import { UnitsAndBuildOrders } from './game-stats-breakdown'
import { GameStatsTimelines } from './game-stats-charts'
import { getTeamsByPlayer, groupSides } from './game-stats-model'
import { Scoreboard } from './game-stats-scoreboard'
import {
  getPlayerColors,
  Section,
  SectionErrorBoundary,
  SectionNote,
  SectionTitle,
  VisuallyHidden,
} from './game-stats-shared'
import { Versus } from './game-stats-versus'
import { useMyPlayerNames } from './my-player-names'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 28px;
`

const TopSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

export const StatsNotice = styled(Card)`
  ${bodyLarge};
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--theme-on-surface-variant);
`

const SectionTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const IncompleteIconRoot = styled(MaterialIcon)`
  color: var(--theme-amber);
`

/** Marks stats that may not cover the whole game, saying why on hover. */
function IncompleteIcon({ stats, source }: { stats: GameStats; source: GameStatsSource }) {
  const { t } = useTranslation()
  const time = getGameDurationString(stats.durationMs)
  const explanation =
    source.kind === 'replay'
      ? t(
          'gameStats.incompleteReplay',
          'The replay may end before the game did, so these stats may only cover its first ' +
            '{{time}}.',
          { time },
        )
      : t(
          'gameStats.incompleteGame',
          'The game went on after it ended for you, so these stats only cover its first {{time}}.',
          { time },
        )
  return (
    <Tooltip text={explanation} position='right'>
      <IncompleteIconRoot icon='history_toggle_off' size={20} />
      <VisuallyHidden>{explanation}</VisuallyHidden>
    </Tooltip>
  )
}

const statsKeys = new WeakMap<GameStats, number>()
let lastStatsKey = 0

/**
 * A key that changes whenever the stats are replaced, like by analyzing a replay again, so any part
 * of the page that failed to show the old ones gets another try.
 */
function getStatsKey(stats: GameStats) {
  let key = statsKeys.get(stats)
  if (key === undefined) {
    lastStatsKey += 1
    key = lastStatsKey
    statsKeys.set(stats, key)
  }
  return key
}

/**
 * Everything about how a game went: who played who, the scoreboard, charts, units and build
 * orders. The header goes above who played who.
 */
export function GameStatsView({
  stats,
  source,
  header,
}: {
  stats: GameStats
  source: GameStatsSource
  header?: React.ReactNode
}) {
  const { t } = useTranslation()
  const myNames = useMyPlayerNames()
  if (!stats.players.length) {
    return (
      <Root>
        {header}
        <StatsNotice>
          <MaterialIcon icon='error' size={20} />
          {t('gameStats.noPlayers', "Couldn't get any player stats from this game.")}
        </StatsNotice>
      </Root>
    )
  }

  const players = withAssumedResults(stats.players, stats.complete, myNames)
  const sides = groupSides(players)
  const teamsByPlayer = getTeamsByPlayer(sides)
  const playerColors = getPlayerColors(sides)
  const ranked = players.toSorted((a, b) => b.totalScore - a.totalScore)

  return (
    <Root key={getStatsKey(stats)}>
      <TopSection>
        {header}
        <SectionErrorBoundary>
          <Versus sides={sides} />
        </SectionErrorBoundary>
      </TopSection>

      <Section>
        <SectionTitleRow>
          <SectionTitle>{t('gameStats.scoreboard', 'Scoreboard')}</SectionTitle>
          {stats.complete ? null : <IncompleteIcon stats={stats} source={source} />}
        </SectionTitleRow>
        <SectionErrorBoundary>
          <Scoreboard players={ranked} teamsByPlayer={teamsByPlayer} />
        </SectionErrorBoundary>
        <SectionNote>
          {t(
            'gameStats.scoreboardHighlightNote',
            'Ranked by total score. The best value in each column is highlighted. Army values ' +
              'show the minerals / gas they took.',
          )}
        </SectionNote>
      </Section>

      <SectionErrorBoundary>
        <GameStatsTimelines
          timesMs={stats.snapshotTimesMs}
          players={players}
          playerColors={playerColors}
        />
      </SectionErrorBoundary>

      <UnitsAndBuildOrders sides={sides} playerColors={playerColors} />
    </Root>
  )
}
