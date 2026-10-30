import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getFairPlayFlags } from '../../common/games/fair-play'
import { GamePlayerStats } from '../../common/games/game-stats'
import { MaterialIcon } from '../icons/material/material-icon'
import { GameActions } from './game-stats-actions'
import { GameFairPlay } from './game-stats-fair-play'
import { Side } from './game-stats-model'
import { GameOtherStats, ReplayCommandsRead } from './game-stats-other'
import { Picker, PickerButton, Section, SectionTitle, VisuallyHidden } from './game-stats-shared'

const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);

  & > ${SectionTitle} {
    flex: 1 1 auto;
  }
`

const TabPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
`

const FlaggedIcon = styled(MaterialIcon)`
  color: var(--theme-negative);
`

type OtherDataTab = 'stats' | 'fairPlay' | 'actions'

/** What's left after the main stats: trades and hotkeys, fair play and every action, in tabs. */
export function GameOtherData({
  gameId,
  replayPath,
  players,
  teamsByPlayer,
  playerColors,
  durationMs,
  outOfSyncMs,
  commands,
  onAnalyzeAgain,
}: {
  gameId: string
  replayPath?: string
  players: ReadonlyArray<GamePlayerStats>
  teamsByPlayer: ReadonlyMap<number, Side>
  playerColors: ReadonlyMap<number, string>
  durationMs: number
  outOfSyncMs?: number
  commands: ReplayCommandsRead
  /** Analyzes the game's replay again, if there's one to analyze. */
  onAnalyzeAgain?: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<OtherDataTab>('actions')

  // Computers play without commands, so there's no fair play to check or actions to list for them.
  const humans = players.filter(p => p.apm !== undefined)
  const tabs: OtherDataTab[] = []
  if (humans.length) {
    if (replayPath) {
      tabs.push('actions')
    }
    tabs.push('fairPlay')
  }
  tabs.push('stats')
  const shownTab = tabs.includes(tab) ? tab : tabs[0]
  // A flag shows on its tab, so a program isn't missed by someone who never opens it.
  const flagged = humans.some(player => {
    const flags = getFairPlayFlags(player, commands.byPlayer?.get(player.id))
    return flags.mapHack || flags.macroProgram || flags.bot
  })
  const labels: Record<OtherDataTab, string> = {
    stats: t('gameStats.otherData.stats', 'Trades and hotkeys'),
    fairPlay: t('gameStats.fairPlay.title', 'Fair play'),
    actions: t('gameStats.actions.title', 'Actions'),
  }

  let content: React.ReactNode
  if (shownTab === 'fairPlay') {
    content = (
      <GameFairPlay
        players={players}
        teamsByPlayer={teamsByPlayer}
        durationMs={durationMs}
        outOfSyncMs={outOfSyncMs}
        commands={commands}
        onAnalyzeAgain={onAnalyzeAgain}
      />
    )
  } else if (shownTab === 'actions') {
    content = (
      <GameActions
        gameId={gameId}
        replayPath={replayPath}
        players={players}
        teamsByPlayer={teamsByPlayer}
        playerColors={playerColors}
        commands={commands}
      />
    )
  } else {
    content = (
      <GameOtherStats
        replayPath={replayPath}
        commands={commands}
        players={players}
        teamsByPlayer={teamsByPlayer}
        durationMs={durationMs}
      />
    )
  }

  return (
    <Section>
      <Header>
        <SectionTitle>{t('gameStats.otherData.title', 'Other data')}</SectionTitle>
        {tabs.length > 1 ? (
          <Picker role='tablist' aria-label={t('gameStats.otherData.title', 'Other data')}>
            {tabs.map(id => (
              <PickerButton
                key={id}
                type='button'
                role='tab'
                aria-selected={shownTab === id}
                $on={shownTab === id}
                onClick={() => setTab(id)}>
                {labels[id]}
                {id === 'fairPlay' && flagged ? (
                  <>
                    <FlaggedIcon icon='warning' size={18} />
                    <VisuallyHidden>
                      {t('gameStats.otherData.flagged', 'A player likely used a program')}
                    </VisuallyHidden>
                  </>
                ) : null}
              </PickerButton>
            ))}
          </Picker>
        ) : null}
      </Header>
      <TabPanel role='tabpanel' aria-label={labels[shownTab]}>
        {content}
      </TabPanel>
    </Section>
  )
}
