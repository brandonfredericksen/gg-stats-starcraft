import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  MACRO_CYCLE_SHARE,
  MACRO_CYCLES,
  SCRIPTED_BURST_SHARE,
} from '../../common/games/command-stats'
import {
  countHiddenClickTimes,
  getFairPlayFlags,
  HIDDEN_CLICK_GAP_MS,
  MAP_HACK_TIMES,
} from '../../common/games/fair-play'
import { getGameDurationString } from '../../common/games/game-duration'
import { GamePlayerStats } from '../../common/games/game-stats'
import { numberFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { Tooltip } from '../material/tooltip'
import { bodyMedium, bodySmall, labelMedium, labelSmall } from '../styles/typography'
import { Side } from './game-stats-model'
import { ReplayCommandsRead } from './game-stats-other'
import {
  PlayerName,
  SectionErrorBoundary,
  SectionNote,
  StatsPanel,
  TeamChip,
  Unavailable,
} from './game-stats-shared'

const percentFormat = numberFormat({ style: 'percent', maximumFractionDigits: 0 })

/** How a number reads against the line where a program is likely. */
type Level = 'none' | 'some' | 'flagged'

const LEVEL_COLORS: Record<Level, string> = {
  none: 'var(--theme-on-surface)',
  some: 'var(--theme-warning)',
  flagged: 'var(--theme-negative)',
}

const Panel = styled(StatsPanel)`
  overflow-x: auto;
`

const Table = styled.div`
  min-width: 860px;
  display: grid;
  grid-template-columns: minmax(200px, 1.4fr) repeat(3, minmax(150px, 1fr)) minmax(180px, 1.2fr);
`

const Row = styled.div`
  display: contents;
`

const HeaderCell = styled.div<{ $end?: boolean }>`
  ${labelMedium};
  padding: 12px 14px 10px;

  display: flex;
  align-items: flex-end;
  justify-content: ${props => (props.$end ? 'flex-end' : 'flex-start')};

  border-bottom: 1px solid var(--theme-outline-variant);
  color: var(--theme-on-surface-variant);
  font-weight: 600;
  white-space: nowrap;
`

const Cell = styled.div<{ $first: boolean; $end?: boolean }>`
  min-height: 56px;
  min-width: 0;
  padding: 8px 14px;

  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: ${props => (props.$end ? 'flex-end' : 'flex-start')};

  border-top: 1px solid ${props => (props.$first ? 'transparent' : 'var(--theme-outline-variant)')};
`

const PlayerCell = styled(Cell)`
  ${bodyMedium};
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-2);
`

const Value = styled.span<{ $level: Level }>`
  ${bodyMedium};
  color: ${props => LEVEL_COLORS[props.$level]};
  font-weight: ${props => (props.$level === 'none' ? 400 : 700)};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const Detail = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const Verdicts = styled.span`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
`

const Verdict = styled.span`
  ${labelSmall};
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  background: rgb(from var(--theme-negative) r g b / 0.18);
  color: var(--theme-negative);
  font-weight: 700;
  white-space: nowrap;
`

const NothingFound = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const NoteRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
`

function levelOf(count: number, flagged: boolean): Level {
  if (flagged) {
    return 'flagged'
  }
  return count > 0 ? 'some' : 'none'
}

/**
 * Whether a player had a program play for them, a row for each: how many times they clicked units
 * they couldn't see, made something and switched back on one frame, and sent commands faster than
 * a hand can, each against the line where a program is likely.
 */
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
  const { t } = useTranslation()
  const percent = useFormat(percentFormat)
  // Computers play without commands, so there's nothing to check for them.
  const humans = players.filter(p => p.apm !== undefined)
  if (!humans.length) {
    return null
  }
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

  const headers = [
    {
      label: t('gameStats.fairPlay.hiddenTargets', 'Hidden units clicked'),
      description: t(
        'gameStats.fairPlay.hiddenTargetsHelp',
        'Separate times the player selected or targeted an enemy unit they couldn’t see, in the ' +
          'fog or cloaked. Clicks less than {{gap}} seconds apart count as one time. StarCraft ' +
          'only lets players click on what they can see, so {{count}} or more times means a map ' +
          'hack.',
        { count: MAP_HACK_TIMES, gap: HIDDEN_CLICK_GAP_MS / 1000 },
      ),
    },
    {
      label: t('gameStats.fairPlay.productionCycles', 'Made and switched back'),
      description: t(
        'gameStats.fairPlay.productionCyclesHelp',
        'Times the player selected something, made something with it and went back to what they ' +
          'had selected, all on one frame, out of everything they made. Macro programs do that ' +
          'between the player’s own commands. {{count}} or more, and at least {{share}} of what ' +
          'they made, means one did.',
        { count: MACRO_CYCLES, share: percent.format(MACRO_CYCLE_SHARE) },
      ),
    },
    {
      label: t('gameStats.fairPlay.burstShare', 'Faster than a hand'),
      description: t(
        'gameStats.fairPlay.burstShareHelp',
        'The share of the player’s commands sent in bursts of 4 or more on one frame, which no ' +
          'hand can manage. From {{share}}, a bot played the game.',
        { share: percent.format(SCRIPTED_BURST_SHARE) },
      ),
    },
  ]

  return (
    <>
      <SectionErrorBoundary>
        <Panel>
          <Table role='table'>
            <Row role='row'>
              <HeaderCell role='columnheader'>{t('gameStats.player', 'Player')}</HeaderCell>
              {headers.map(header => (
                <HeaderCell key={header.label} role='columnheader' $end={true}>
                  <Tooltip text={header.description} position='top'>
                    {header.label}
                  </Tooltip>
                </HeaderCell>
              ))}
              <HeaderCell role='columnheader'>
                {t('gameStats.fairPlay.verdict', 'Likely used')}
              </HeaderCell>
            </Row>
            {humans.map((player, i) => {
              const first = i === 0
              const team = teamsByPlayer.get(player.id)
              const played = commands.byPlayer?.get(player.id)
              const flags = getFairPlayFlags(player, played)
              const times = countHiddenClickTimes(player.hiddenTargets)
              const found = [
                flags.mapHack ? t('gameStats.fairPlay.mapHack', 'Map hack') : undefined,
                flags.macroProgram
                  ? t('gameStats.fairPlay.macroProgram', 'Macro program')
                  : undefined,
                flags.bot ? t('gameStats.fairPlay.bot', 'Bot') : undefined,
              ].filter(f => f !== undefined)

              let hidden: React.ReactNode = <Unavailable />
              if (player.hiddenTargets && outOfSyncMs === undefined) {
                hidden = (
                  <>
                    <Value $level={levelOf(times, flags.mapHack)}>
                      {t('gameStats.fairPlay.times', {
                        defaultValue: '{{count}} times',
                        defaultValue_one: '{{count}} time',
                        count: times,
                      })}
                    </Value>
                    {player.hiddenTargets.count ? (
                      <Detail>
                        {t('gameStats.fairPlay.clicks', {
                          defaultValue: '{{count}} clicks',
                          defaultValue_one: '{{count}} click',
                          count: player.hiddenTargets.count,
                        })}
                      </Detail>
                    ) : null}
                  </>
                )
              }

              let cycles: React.ReactNode = <Unavailable />
              if (played) {
                cycles = (
                  <>
                    <Value $level={levelOf(played.productionCycles, flags.macroProgram)}>
                      {t('gameStats.fairPlay.cyclesOf', '{{count}} of {{made}}', {
                        count: played.productionCycles,
                        made: played.productions,
                      })}
                    </Value>
                    {played.productionCycles && played.productions ? (
                      <Detail>
                        {percent.format(played.productionCycles / played.productions)}
                      </Detail>
                    ) : null}
                  </>
                )
              }

              let bursts: React.ReactNode = <Unavailable />
              if (played?.burstShare !== undefined) {
                bursts = (
                  <Value $level={flags.bot ? 'flagged' : 'none'}>
                    {percent.format(played.burstShare)}
                  </Value>
                )
              }

              return (
                <Row key={player.id} role='row'>
                  <PlayerCell role='rowheader' $first={first}>
                    <PlayerName player={player} durationMs={durationMs} />
                    {team ? <TeamChip team={team} /> : null}
                  </PlayerCell>
                  <Cell role='cell' $first={first} $end={true}>
                    {hidden}
                  </Cell>
                  <Cell role='cell' $first={first} $end={true}>
                    {cycles}
                  </Cell>
                  <Cell role='cell' $first={first} $end={true}>
                    {bursts}
                  </Cell>
                  <Cell role='cell' $first={first}>
                    {found.length ? (
                      <Verdicts>
                        {found.map(f => (
                          <Verdict key={f}>{f}</Verdict>
                        ))}
                      </Verdicts>
                    ) : (
                      <NothingFound>
                        {t('gameStats.fairPlay.nothingFound', 'Nothing found')}
                      </NothingFound>
                    )}
                  </Cell>
                </Row>
              )
            })}
          </Table>
        </Panel>
      </SectionErrorBoundary>
      <SectionNote>
        {t(
          'gameStats.fairPlay.note',
          'Red is past the line where a program is likely. Amber happened only once or a few ' +
            'times, which lag can explain, so watch it to judge. 0 hidden units clicked doesn’t ' +
            'mean a player was clean: most map hackers never click into the fog.',
        )}
      </SectionNote>
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
    </>
  )
}
