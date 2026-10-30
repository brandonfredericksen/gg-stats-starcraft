import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  MACRO_CYCLE_SHARE,
  MACRO_CYCLES,
  SCRIPTED_BURST_SHARE,
} from '../../common/games/command-stats'
import { getFairPlayFlags, MAP_HACK_HIDDEN_TARGETS } from '../../common/games/fair-play'
import { getGameDurationString } from '../../common/games/game-duration'
import { GamePlayerStats } from '../../common/games/game-stats'
import { numberFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { Side } from './game-stats-model'
import { ReplayCommandsRead } from './game-stats-other'
import { PlayerStatsGrid, ScoreColumn } from './game-stats-scoreboard'
import { Section, SectionErrorBoundary, SectionNote, SectionTitle } from './game-stats-shared'

const percentFormat = numberFormat({ style: 'percent', maximumFractionDigits: 0 })

const NoteRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
`

/** Whether a player had a program play for them: a map hack, a macro program or a bot. */
export function GameFairPlay({
  players,
  teamsByPlayer,
  durationMs,
  outOfSyncMs,
  commands,
  onAnalyzeAgain,
}: {
  players: ReadonlyArray<GamePlayerStats>
  teamsByPlayer: ReadonlyMap<number, Side>
  durationMs: number
  outOfSyncMs?: number
  commands: ReplayCommandsRead
  /** Analyzes the game's replay again, if there's one to analyze. */
  onAnalyzeAgain?: () => void
}) {
  const { t, i18n } = useTranslation()
  const percent = useFormat(percentFormat)
  const commandsOf = (player: GamePlayerStats) => commands.byPlayer?.get(player.id)
  // Computers play without commands, so there's nothing to check for them.
  const humans = players.filter(p => p.apm !== undefined)
  if (!humans.length) {
    return null
  }

  const columns: ScoreColumn[] = [
    {
      id: 'hiddenTargets',
      label: t('gameStats.fairPlay.hiddenTargets', 'Hidden units clicked'),
      get: p => p.hiddenTargets?.count,
      neutral: true,
      primary: true,
      description: t(
        'gameStats.fairPlay.hiddenTargetsDescription',
        'Times the player selected or targeted an enemy unit they couldn’t see, in the fog or ' +
          'cloaked. StarCraft only lets players click on what they can see, so {{count}} or more ' +
          'means a map hack.',
        { count: MAP_HACK_HIDDEN_TARGETS },
      ),
    },
    {
      id: 'productionCycles',
      label: t('gameStats.fairPlay.productionCycles', 'Made and switched back'),
      get: p => commandsOf(p)?.productionCycles,
      neutral: true,
      startsGroup: true,
      description: t(
        'gameStats.fairPlay.productionCyclesDescription',
        'Times the player selected something, made something with it and went back to what they ' +
          'had selected, all on one frame. Macro programs do that between the player’s own ' +
          'commands. {{count}} or more, at least {{share}} of what they made, means one did.',
        { count: MACRO_CYCLES, share: percent.format(MACRO_CYCLE_SHARE) },
      ),
    },
    {
      id: 'productions',
      label: t('gameStats.fairPlay.productions', 'Things made'),
      get: p => commandsOf(p)?.productions,
      neutral: true,
      description: t(
        'gameStats.fairPlay.productionsDescription',
        'Commands to make units, morph, research and upgrade.',
      ),
    },
    {
      id: 'burstShare',
      label: t('gameStats.fairPlay.burstShare', 'Sent in bursts'),
      get: p => commandsOf(p)?.burstShare,
      format: value => percent.format(value),
      neutral: true,
      startsGroup: true,
      max: 1,
      description: t(
        'gameStats.fairPlay.burstShareDescription',
        'The share of the player’s commands sent faster than a hand can. From {{share}}, a bot ' +
          'played the game.',
        { share: percent.format(SCRIPTED_BURST_SHARE) },
      ),
    },
  ]

  const flagged = humans.flatMap(player => {
    const flags = getFairPlayFlags(player, commandsOf(player))
    const found = [
      flags.mapHack ? t('gameStats.fairPlay.mapHack', 'a map hack') : undefined,
      flags.macroProgram ? t('gameStats.fairPlay.macroProgram', 'a macro program') : undefined,
      flags.bot ? t('gameStats.fairPlay.bot', 'a bot') : undefined,
    ].filter(f => f !== undefined)
    return found.length ? [{ player, found }] : []
  })
  const unchecked = humans.every(p => !p.hiddenTargets)

  let hiddenNote: string | undefined
  if (outOfSyncMs !== undefined) {
    hiddenNote = t(
      'gameStats.fairPlay.outOfSync',
      'This replay plays back out of sync from {{time}}, so hidden units can’t be checked.',
      { time: getGameDurationString(outOfSyncMs) },
    )
  } else if (unchecked) {
    hiddenNote = t(
      'gameStats.fairPlay.unchecked',
      'Hidden units weren’t checked when this game was analyzed.',
    )
  }

  return (
    <Section>
      <SectionTitle>{t('gameStats.fairPlay.title', 'Fair play')}</SectionTitle>
      <SectionErrorBoundary>
        <PlayerStatsGrid
          players={humans}
          teamsByPlayer={teamsByPlayer}
          columns={columns}
          durationMs={durationMs}
          showRank={false}
        />
      </SectionErrorBoundary>
      {flagged.length ? (
        <SectionNote>
          {flagged
            .map(({ player, found }) =>
              t('gameStats.fairPlay.flagged', '{{player}} likely used {{programs}}.', {
                player: player.name,
                programs: new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(found),
              }),
            )
            .join(' ')}
        </SectionNote>
      ) : null}
      {hiddenNote ? (
        <NoteRow>
          <SectionNote>{hiddenNote}</SectionNote>
          {unchecked && outOfSyncMs === undefined && onAnalyzeAgain ? (
            <TextButton
              label={t('gameStats.analyzeAgain', 'Analyze again')}
              iconStart={<MaterialIcon icon='refresh' size={18} />}
              onClick={onAnalyzeAgain}
            />
          ) : null}
        </NoteRow>
      ) : null}
      {commands.reading ? (
        <SectionNote>{t('gameStats.readingReplay', 'Reading the replay…')}</SectionNote>
      ) : null}
    </Section>
  )
}
