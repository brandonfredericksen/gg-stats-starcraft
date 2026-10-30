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
import { GameChat, MissingAllyChatNote, useReplayChat } from './game-stats-chat'
import { GameHotkeys } from './game-stats-hotkeys'
import { GameMinimap } from './game-stats-minimap'
import { getTeamsByPlayer, groupSides } from './game-stats-model'
import { useReplayCommands } from './game-stats-other'
import { GameOtherData } from './game-stats-other-data'
import { GameProduction } from './game-stats-production'
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

/**
 * The minimap with the chat beside it. Each is a header, a panel and maybe a note, laid out on rows
 * they share, so the two panels start and end on the same lines.
 */
const MapAndChat = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: var(--space-5);
  row-gap: var(--space-3);

  & > * {
    display: grid;
    grid-row: span 3;
    grid-template-rows: subgrid;
  }

  & > * > :first-child {
    min-height: 40px;
    display: flex;
    align-items: center;
  }

  @media (max-width: 960px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

/**
 * The production box above the chat, which together take the header and panel rows beside the
 * minimap, so the chat ends where the minimap does. The chat's note goes on the note row.
 */
const ChatColumn = styled.div`
  && > :first-child {
    grid-row: span 2;
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    align-items: stretch;
    row-gap: var(--space-5);
  }
`

const TopSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`

export const StatsNotice = styled(Card)`
  ${bodyLarge};
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--theme-on-surface-variant);
`

const SectionTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
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
 * orders, and the chat when there's a replay to read it from. The header goes above who played who.
 */
export function GameStatsView({
  gameId,
  stats,
  source,
  replayPath,
  header,
  footer,
  onAnalyzeAgain,
}: {
  gameId: string
  stats: GameStats
  source: GameStatsSource
  replayPath?: string
  header?: React.ReactNode
  /** Goes below everything else. */
  footer?: React.ReactNode
  /** Analyzes the game's replay again, if there's one to analyze. */
  onAnalyzeAgain?: () => void
}) {
  const { t } = useTranslation()
  const myNames = useMyPlayerNames()
  const chat = useReplayChat(replayPath)
  const commands = useReplayCommands(replayPath, stats.players)
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
          <Versus sides={sides} durationMs={stats.durationMs} />
        </SectionErrorBoundary>
      </TopSection>

      <Section>
        <SectionTitleRow>
          <SectionTitle>{t('gameStats.scoreboard', 'Scoreboard')}</SectionTitle>
          {stats.complete ? null : <IncompleteIcon stats={stats} source={source} />}
        </SectionTitleRow>
        <SectionErrorBoundary>
          <Scoreboard
            players={ranked}
            teamsByPlayer={teamsByPlayer}
            durationMs={stats.durationMs}
          />
        </SectionErrorBoundary>
        <SectionNote>
          {t(
            'gameStats.scoreboardHighlightNote',
            'Ranked by total score. The best in each column is highlighted. Hover a column for ' +
              'what it counts.',
          )}
        </SectionNote>
      </Section>

      <SectionErrorBoundary>
        <GameStatsTimelines
          timesMs={stats.snapshotTimesMs}
          // In the order of the teams above, so the legend reads the same way.
          players={sides.flatMap(side => side.players)}
          playerColors={playerColors}
        />
      </SectionErrorBoundary>

      <MapAndChat>
        <GameMinimap
          gameId={gameId}
          minimap={stats.minimap}
          durationMs={stats.durationMs}
          players={sides.flatMap(side => side.players)}
          playerColors={playerColors}
          onAnalyzeAgain={onAnalyzeAgain}
        />
        <ChatColumn>
          <div>
            <SectionErrorBoundary>
              <GameProduction
                players={sides.flatMap(side => side.players)}
                playerColors={playerColors}
                snapshotTimesMs={stats.snapshotTimesMs}
              />
            </SectionErrorBoundary>
            {chat ? (
              <GameChat chat={chat} players={players} playerColors={playerColors} fill />
            ) : null}
          </div>
          {chat ? (
            <MissingAllyChatNote chat={chat} players={players} teamsByPlayer={teamsByPlayer} />
          ) : null}
        </ChatColumn>
      </MapAndChat>

      <UnitsAndBuildOrders sides={sides} playerColors={playerColors} />

      <SectionErrorBoundary>
        <GameHotkeys
          players={sides.flatMap(side => side.players)}
          playerColors={playerColors}
          durationMs={stats.durationMs}
          replayPath={replayPath}
        />
      </SectionErrorBoundary>

      <GameOtherData
        gameId={gameId}
        replayPath={replayPath}
        // In the order of the teams, since there's no score to rank them by here.
        players={sides.flatMap(side => side.players)}
        teamsByPlayer={teamsByPlayer}
        playerColors={playerColors}
        durationMs={stats.durationMs}
        outOfSyncMs={stats.outOfSyncMs}
        commands={commands}
        onAnalyzeAgain={onAnalyzeAgain}
      />

      {footer}
    </Root>
  )
}
