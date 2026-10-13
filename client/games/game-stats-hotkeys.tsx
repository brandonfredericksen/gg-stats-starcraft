import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getErrorStack } from '../../common/errors'
import {
  getHotkeyRates,
  PlayerCommandStats,
  ReplayCommandStats,
} from '../../common/games/command-stats'
import { GamePlayerStats } from '../../common/games/game-stats'
import { findPlayerCommands } from '../../common/games/player-metrics'
import { TypedIpcRenderer } from '../../common/ipc'
import { numberFormat, useFormat } from '../i18n/locale-formats'
import logger from '../logging/logger'
import { Side } from './game-stats-model'
import { PlayerStatsGrid, ScoreColumn } from './game-stats-scoreboard'
import { Section, SectionErrorBoundary, SectionNote, SectionTitle } from './game-stats-shared'

const ipcRenderer = new TypedIpcRenderer()

const rateFormat = numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** How each player used hotkeys, from the commands in the game's replay. */
export function GameHotkeys({
  replayPath,
  players,
  teamsByPlayer,
  durationMs,
}: {
  replayPath: string
  players: ReadonlyArray<GamePlayerStats>
  teamsByPlayer: ReadonlyMap<number, Side>
  durationMs: number
}) {
  const { t } = useTranslation()
  const rate = useFormat(rateFormat)
  const [read, setRead] = useState<{ path: string; commands?: ReplayCommandStats }>()

  useEffect(() => {
    let cancelled = false
    Promise.resolve(ipcRenderer.invoke('replayReadCommandStats', replayPath))
      .then(commands => {
        if (!cancelled) {
          setRead({ path: replayPath, commands })
        }
      })
      .catch(err => {
        logger.error(`Error reading the commands in ${replayPath}: ${getErrorStack(err)}`)
        if (!cancelled) {
          setRead({ path: replayPath })
        }
      })
    return () => {
      cancelled = true
    }
  }, [replayPath])

  const title = <SectionTitle>{t('gameStats.hotkeys', 'Hotkeys')}</SectionTitle>
  if (!read || read.path !== replayPath) {
    // The title holds the section's place, so the page doesn't jump when the replay's been read.
    return (
      <Section>
        {title}
        <SectionNote>{t('gameStats.readingReplay', 'Reading the replay…')}</SectionNote>
      </Section>
    )
  }
  if (!read.commands) {
    return (
      <Section>
        {title}
        <SectionNote>
          {t('gameStats.hotkeysUnreadable', "Couldn't read this game's replay.")}
        </SectionNote>
      </Section>
    )
  }

  const byPlayer = new Map<number, PlayerCommandStats>()
  for (const player of players) {
    const commands = findPlayerCommands(read.commands, player.names)
    if (commands) {
      byPlayer.set(player.id, commands)
    }
  }
  const rates = (player: GamePlayerStats) => {
    const commands = byPlayer.get(player.id)
    return commands && getHotkeyRates(commands)
  }
  // Like a way of playing, more of any of these isn't better, so none stands out as the best.
  const columns: ScoreColumn[] = [
    {
      id: 'hotkeyUse',
      label: t('gameStats.hotkeysPerMinute', 'Hotkeys per min'),
      get: p => rates(p)?.recallsPerMin,
      // One decimal, or a player with a recall or two in a long game would show 0 next to a group
      // used.
      format: value => rate.format(value),
      neutral: true,
      description: t(
        'gameStats.hotkeyUseDescription',
        'How many times a minute the player called up one of their hotkey groups.',
      ),
    },
    {
      id: 'hotkeyJumps',
      label: t('gameStats.hotkeyJumpsPerMinute', 'Jumps per min'),
      get: p => rates(p)?.jumpsPerMin,
      format: value => rate.format(value),
      neutral: true,
      description: t(
        'gameStats.hotkeyJumpsDescription',
        'Times a minute the player double tapped a hotkey, which moves the screen to that group.',
      ),
    },
    {
      id: 'groupsUsed',
      label: t('gameStats.groupsUsed', 'Groups used'),
      get: p => byPlayer.get(p.id)?.groupsUsed,
      neutral: true,
      description: t(
        'gameStats.groupsUsedDescription',
        'How many different hotkey groups the player selected.',
      ),
    },
  ]

  return (
    <Section>
      {title}
      <SectionErrorBoundary>
        <PlayerStatsGrid
          players={players}
          teamsByPlayer={teamsByPlayer}
          columns={columns}
          durationMs={durationMs}
          showRank={false}
        />
      </SectionErrorBoundary>
      <SectionNote>
        {t(
          'gameStats.hotkeysNote',
          "Replays don't record where the screen is, so jumps are the only screen moves counted.",
        )}
      </SectionNote>
    </Section>
  )
}
