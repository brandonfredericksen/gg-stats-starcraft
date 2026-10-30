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
const percentFormat = numberFormat({ style: 'percent', maximumFractionDigits: 0 })

/** What the player's army units made were worth, for every mineral and gas they mined. */
function getArmyPerMined(player: GamePlayerStats) {
  const mined = player.mineralsMined + player.gasMined
  return player.armyProduced && mined > 0
    ? (player.armyProduced.minerals + player.armyProduced.gas) / mined
    : undefined
}

/** The score of the enemy army a player killed for every point of their own army that died. */
function getKilledPerLost(player: GamePlayerStats) {
  return player.armyKilled && player.armyLost && player.armyLost.score > 0
    ? player.armyKilled.score / player.armyLost.score
    : undefined
}

/** What a game's replay says about each player's commands, once it's been read. */
export interface ReplayCommandsRead {
  reading: boolean
  /** Missing while reading, and when the replay couldn't be read. */
  byPlayer?: ReadonlyMap<number, PlayerCommandStats>
}

/** Reads the commands in a game's replay, if it has one, for each of its players. */
export function useReplayCommands(
  replayPath: string | undefined,
  players: ReadonlyArray<GamePlayerStats>,
): ReplayCommandsRead {
  const [read, setRead] = useState<{ path: string; commands?: ReplayCommandStats }>()

  useEffect(() => {
    if (!replayPath) {
      return undefined
    }
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

  const reading = !!replayPath && read?.path !== replayPath
  if (reading || !read?.commands) {
    return { reading }
  }
  const byPlayer = new Map<number, PlayerCommandStats>()
  for (const player of players) {
    const commands = findPlayerCommands(read.commands, player.names)
    if (commands) {
      byPlayer.set(player.id, commands)
    }
  }
  return { reading, byPlayer }
}

/**
 * How each player traded and spent, and how they used hotkeys if the game's replay can be read for
 * its commands.
 */
export function GameOtherStats({
  replayPath,
  commands,
  players,
  teamsByPlayer,
  durationMs,
}: {
  replayPath?: string
  commands: ReplayCommandsRead
  players: ReadonlyArray<GamePlayerStats>
  teamsByPlayer: ReadonlyMap<number, Side>
  durationMs: number
}) {
  const { t } = useTranslation()
  const rate = useFormat(rateFormat)
  const percent = useFormat(percentFormat)
  const { reading } = commands
  const byPlayer = commands.byPlayer ?? new Map<number, PlayerCommandStats>()
  const rates = (player: GamePlayerStats) => {
    const played = byPlayer.get(player.id)
    return played && getHotkeyRates(played)
  }

  const columns: ScoreColumn[] = [
    {
      id: 'armyPerMined',
      label: t('gameStats.armyPerMined', 'Army per mined'),
      get: getArmyPerMined,
      format: value => percent.format(value),
      description: t(
        'gameStats.armyPerMinedDescription',
        'What the army units made cost in minerals and gas, out of everything the player mined.',
      ),
    },
    {
      id: 'armyKilled',
      label: t('gameStats.armyKilled', 'Army killed'),
      get: p => p.armyKilled?.score,
      description: t(
        'gameStats.otherArmyKilledDescription',
        "StarCraft's score for the enemy army units this player killed, which counts gas and " +
          'tech for more than minerals.',
      ),
      startsGroup: true,
    },
    {
      id: 'armyLost',
      label: t('gameStats.armyLost', 'Army lost'),
      get: p => p.armyLost?.score,
      description: t(
        'gameStats.otherArmyLostDescription',
        "The same score for this player's army units that died.",
      ),
      lowerIsBetter: true,
    },
    {
      id: 'killedPerLost',
      label: t('gameStats.killedPerLost', 'Killed per lost'),
      get: getKilledPerLost,
      format: value => rate.format(value),
      primary: true,
      description: t(
        'gameStats.killedPerLostDescription',
        'Army killed divided by army lost. Above 1, the player traded well.',
      ),
    },
  ]
  if (replayPath) {
    // Like a way of playing, more of any of these isn't better, so none stands out as the best.
    columns.push(
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
        startsGroup: true,
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
    )
  }

  let note: string | undefined
  if (reading) {
    note = t('gameStats.readingReplay', 'Reading the replay…')
  } else if (replayPath && !commands.byPlayer) {
    note = t('gameStats.hotkeysUnreadable', "Couldn't read this game's replay.")
  } else if (replayPath) {
    note = t(
      'gameStats.hotkeysNote',
      "Replays don't record where the screen is, so jumps are the only screen moves counted.",
    )
  }

  return (
    <Section>
      <SectionTitle>{t('gameStats.otherStats', 'Other stats')}</SectionTitle>
      <SectionErrorBoundary>
        <PlayerStatsGrid
          players={players}
          teamsByPlayer={teamsByPlayer}
          columns={columns}
          durationMs={durationMs}
          showRank={false}
        />
      </SectionErrorBoundary>
      {note ? <SectionNote>{note}</SectionNote> : null}
    </Section>
  )
}
