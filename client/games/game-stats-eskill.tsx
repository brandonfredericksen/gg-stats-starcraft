import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getErrorStack } from '../../common/errors'
import { GamePlayerStats } from '../../common/games/game-stats'
import { TypedIpcRenderer } from '../../common/ipc'
import { ESkill } from '../../common/my-stats/eskill'
import logger from '../logging/logger'
import { Side } from './game-stats-model'
import { PlayerStatsGrid, ScoreColumn } from './game-stats-scoreboard'
import {
  Section,
  SectionErrorBoundary,
  SectionNote,
  SectionTitle,
  useStatFormat,
} from './game-stats-shared'

const ipcRenderer = new TypedIpcRenderer()

/** The eSkill of each player in the game, by id, once they're worked out. */
function useGameESkill(gameId: string) {
  const [scores, setScores] = useState<{ gameId: string; scores: Record<number, ESkill> }>()

  useEffect(() => {
    let cancelled = false
    Promise.resolve(ipcRenderer.invoke('gameESkill', gameId))
      .then(result => {
        if (!cancelled && result) {
          setScores({ gameId, scores: result })
        }
      })
      .catch(err => {
        logger.error(`Error working out eSkill for ${gameId}: ${getErrorStack(err)}`)
      })
    return () => {
      cancelled = true
    }
  }, [gameId])

  return scores?.gameId === gameId ? scores.scores : undefined
}

/**
 * Each player's eSkill: the 1v1 ladder MMR the way they played this game points to, and how each
 * part of it compares with ladder players of their race. Shown once anyone played long enough to
 * be scored.
 */
export function ESkillSection({
  gameId,
  players,
  teamsByPlayer,
  durationMs,
}: {
  gameId: string
  players: ReadonlyArray<GamePlayerStats>
  teamsByPlayer: ReadonlyMap<number, Side>
  durationMs: number
}) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const scores = useGameESkill(gameId)
  if (!scores || !players.some(p => scores[p.id])) {
    return null
  }

  const partHelp = t(
    'gameStats.eSkillPartHelp',
    'Out of 100: how many ladder players of the same race this part beats.',
  )
  const columns: ScoreColumn[] = [
    {
      id: 'eSkill',
      label: t('gameStats.eSkill', 'eSkill'),
      get: p => scores[p.id]?.value,
      primary: true,
      format: value => {
        const rank = players.map(p => scores[p.id]).find(s => s?.value === value)?.rank
        return rank ? `${format.format(value)} (${rank.toUpperCase()})` : format.format(value)
      },
      description: t(
        'gameStats.eSkillDescription',
        'The 1v1 ladder MMR, and rank, of players who play like this. Nothing an opponent ' +
          'decides, like kills or mining, counts in it.',
      ),
    },
    {
      id: 'speed',
      label: t('gameStats.eSkillSpeed', 'Speed'),
      get: p => scores[p.id]?.parts.speed,
      max: 100,
      startsGroup: true,
      description: `${t('gameStats.eSkillSpeedDescription', 'EAPM over the game and in each part of it.')} ${partHelp}`,
    },
    {
      id: 'hands',
      label: t('gameStats.eSkillHands', 'Hands'),
      get: p => scores[p.id]?.parts.hands,
      max: 100,
      description: `${t('gameStats.eSkillHandsDescription', 'Hotkey recalls, jumps to a group and how many groups were used.')} ${partHelp}`,
    },
    {
      id: 'macro',
      label: t('gameStats.eSkillMacro', 'Macro'),
      get: p => scores[p.id]?.parts.macro,
      max: 100,
      description: `${t('gameStats.eSkillMacroDescription', 'Money banked, workers made from every town hall, larvae left waiting and army made.')} ${partHelp}`,
    },
  ]
  const ranked = players.toSorted(
    (a, b) => (scores[b.id]?.value ?? -Infinity) - (scores[a.id]?.value ?? -Infinity),
  )
  return (
    <Section>
      <SectionTitle>{t('gameStats.eSkill', 'eSkill')}</SectionTitle>
      <SectionErrorBoundary>
        <PlayerStatsGrid
          players={ranked}
          teamsByPlayer={teamsByPlayer}
          columns={columns}
          durationMs={durationMs}
        />
      </SectionErrorBoundary>
      <SectionNote>
        {t(
          'gameStats.eSkillNote',
          'Estimated from speed, hotkeys and macro, ranked against players of the same race in ' +
            'the same kind of game. One game is a rough read, within about 220 MMR on average. ' +
            'My stats averages your latest games. Players who left before 6 minutes have none.',
        )}
      </SectionNote>
    </Section>
  )
}
