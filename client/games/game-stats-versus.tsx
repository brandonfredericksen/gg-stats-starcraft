import { TFunction } from 'i18next'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getGameDurationString } from '../../common/games/game-duration'
import { GameStatsResult } from '../../common/games/game-stats'
import { RaceTag } from '../material/race-tag'
import { PlayerNameButton } from '../players/player-card'
import { bahnschrift, bodyMedium, bodySmall, labelSmall, singleLine } from '../styles/typography'
import { getSideTotals, Side } from './game-stats-model'
import {
  GAS_COLOR,
  getStatsResultLabel,
  MINERALS_COLOR,
  ResultChip,
  StatsPanel,
  useStatFormat,
} from './game-stats-shared'

const Banner = styled.div<{ $columns: string }>`
  display: grid;
  grid-template-columns: ${props => props.$columns};
  align-items: stretch;
  gap: 12px;
`

const VsPill = styled.div`
  ${labelSmall};
  width: 40px;
  height: 26px;
  align-self: center;
  justify-self: center;

  display: flex;
  align-items: center;
  justify-content: center;

  border: 1px solid var(--theme-outline-strong);
  border-radius: var(--radius-full);
  background: var(--theme-container);
  color: var(--theme-on-surface-variant);
  font-weight: 700;
`

const SideCard = styled(StatsPanel)`
  min-width: 0;
  padding: 16px 18px;

  display: flex;
  flex-direction: column;
  gap: 10px;
`

const SideHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const SideLabel = styled.span`
  ${bodyMedium};
  font-size: 13px;
  color: var(--theme-on-surface-variant);
`

const Spacer = styled.span`
  flex: 1 1 0;
`

const SideScore = styled.span<{ $lead: boolean }>`
  ${bahnschrift};
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: ${props => (props.$lead ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)')};
`

/** The side's combined numbers, under its players. */
const Totals = styled.dl`
  margin: 2px 0 0;
  padding-top: 12px;

  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px 12px;

  border-top: 1px solid var(--theme-outline-variant);
`

const Total = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
`

const TotalValue = styled.dd<{ $color?: string }>`
  ${bahnschrift};
  margin: 0;
  order: -1;
  color: ${props => props.$color ?? 'var(--theme-on-surface)'};
  font-size: 17px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
`

const TotalLabel = styled.dt`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const SidePlayers = styled.div`
  display: flex;
  flex-direction: column;
`

const SidePlayer = styled.div`
  min-width: 0;
  min-height: 30px;

  display: flex;
  align-items: center;
  gap: 8px;
`

/**
 * A player's EAPM, quiet, between their race and name. Its slot is the same width for every
 * player, so their names line up even when one has no EAPM.
 */
const SidePlayerEapm = styled.span`
  ${bodySmall};
  font-size: 11px;
  /* Room for three digits, sitting closer to the race tag than the row's usual gap. */
  width: 1.8em;
  margin-left: -4px;
  flex-shrink: 0;

  color: rgb(from var(--theme-on-surface-variant) r g b / 0.7);
  /*
   * Equal width digits keep the numbers in a straight column, and spacing them a little closer
   * than usual keeps the column narrow, the same for every digit so it stays straight.
   */
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.04em;
  text-align: right;
  white-space: nowrap;
`

const SidePlayerName = styled.span<{ $lead: boolean; $large: boolean }>`
  ${bahnschrift};
  ${singleLine};
  font-size: ${props => (props.$large ? 26 : 18)}px;
  font-weight: ${props => (props.$lead ? 700 : 600)};
  line-height: 1.2;
  /* The side that lost reads a step quieter, without going as gray as secondary text. */
  color: ${props =>
    props.$lead ? 'var(--theme-on-surface)' : 'rgb(from var(--theme-on-surface) r g b / 0.8)'};
  /* Bahnschrift draws its letters high in the line, so this centers them on the race tag. */
  transform: translateY(0.08em);
`

/**
 * Free for all players in the order they finished: the winner, then whoever stayed in longest. A
 * player still in when the game ended outlasted everyone who left.
 */
function toFinishingOrder(sides: ReadonlyArray<Side>): Side[] {
  const lastedMs = (side: Side) =>
    side.result === 'win' ? Infinity : (side.players[0]?.leftAtMs ?? Number.MAX_SAFE_INTEGER)
  return sides.toSorted((a, b) => lastedMs(b) - lastedMs(a))
}

function getPlaceLabel(place: number, t: TFunction) {
  return t('gameStats.place', {
    defaultValue_ordinal_one: '{{count}}st',
    defaultValue_ordinal_two: '{{count}}nd',
    defaultValue_ordinal_few: '{{count}}rd',
    defaultValue_ordinal_other: '{{count}}th',
    count: place,
    ordinal: true,
  })
}

/**
 * Who played who and how it went: a card per side with its result and total score, and in a free
 * for all a card per player in the order they finished.
 */
export function Versus({ sides }: { sides: ReadonlyArray<Side> }) {
  const { t } = useTranslation()
  const isFreeForAll = sides.length > 2 && !sides.some(side => side.isTeam)
  const hasResults = sides.some(side => side.result !== 'unknown')

  if (isFreeForAll) {
    const ordered = hasResults ? toFinishingOrder(sides) : sides
    return (
      <Banner $columns={`repeat(${Math.min(ordered.length, 4)}, minmax(0, 1fr))`}>
        {ordered.map((side, i) => (
          <SideSummary
            key={side.key}
            side={side}
            resultLabel={hasResults ? getPlaceLabel(i + 1, t) : getStatsResultLabel(side.result, t)}
            result={side.result === 'win' ? 'win' : 'unknown'}
            lead={!hasResults || side.result === 'win'}
          />
        ))}
      </Banner>
    )
  }

  return (
    <Banner $columns={sides.map(() => 'minmax(0, 1fr)').join(' 40px ')}>
      {sides.map((side, i) => (
        <React.Fragment key={side.key}>
          {i > 0 ? <VsPill>{t('gameStats.versusShort', 'vs')}</VsPill> : null}
          <SideSummary
            side={side}
            resultLabel={getStatsResultLabel(side.result, t)}
            result={side.result}
            lead={side.result !== 'loss'}
          />
        </React.Fragment>
      ))}
    </Banner>
  )
}

function SideSummary({
  side,
  resultLabel,
  result,
  lead,
}: {
  side: Side
  resultLabel: string
  result: GameStatsResult
  /** Whether the side is shown at full strength, as winners are, or muted like the sides that lost. */
  lead: boolean
}) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const score = side.players.reduce((total, player) => total + player.totalScore, 0)
  const isTeam = side.players.length > 1
  const totals = getSideTotals(side.players)
  const shown: Array<{ label: string; value: string | undefined; color?: string }> = [
    {
      label: t('gameStats.minerals', 'Minerals'),
      value: format.format(totals.minerals),
      color: MINERALS_COLOR,
    },
    { label: t('gameStats.gas', 'Gas'), value: format.format(totals.gas), color: GAS_COLOR },
    {
      label: t('gameStats.peakArmySupply', 'Peak army supply'),
      value: totals.peakArmySupply === undefined ? undefined : format.format(totals.peakArmySupply),
    },
    {
      label: t('gameStats.supplyBlocked', 'Supply blocked'),
      value:
        totals.supplyBlockedMs === undefined
          ? undefined
          : getGameDurationString(totals.supplyBlockedMs),
    },
    {
      label: isTeam ? t('gameStats.averageEapm', 'Avg. EAPM') : t('gameStats.eapm', 'EAPM'),
      value: totals.eapm === undefined ? undefined : format.format(totals.eapm),
    },
    {
      label: t('gameStats.averageUnspent', 'Avg. unspent'),
      value: totals.averageUnspent === undefined ? undefined : format.format(totals.averageUnspent),
    },
  ]
  return (
    <SideCard>
      <SideHeader>
        <ResultChip $result={result}>{resultLabel}</ResultChip>
        {isTeam ? (
          <SideLabel>
            {t('gameStats.teamName', 'Team {{number}}', { number: side.number })}
          </SideLabel>
        ) : null}
        <Spacer />
        <SideScore
          $lead={lead}
          title={t('gameStats.totalScore', 'Total score')}
          aria-label={t('gameStats.totalScoreValue', 'Total score {{score}}', {
            score: format.format(score),
          })}>
          {format.format(score)}
        </SideScore>
      </SideHeader>
      <SidePlayers>
        {side.players.map(player => (
          <SidePlayer key={player.id}>
            {player.race ? <RaceTag race={player.race} /> : null}
            <SidePlayerEapm title={t('gameStats.eapm', 'EAPM')}>
              {player.eapm !== undefined ? format.format(player.eapm) : null}
            </SidePlayerEapm>
            <SidePlayerName $lead={lead} $large={!isTeam}>
              <PlayerNameButton name={player.name} race={player.race}>
                {player.name}
              </PlayerNameButton>
            </SidePlayerName>
          </SidePlayer>
        ))}
      </SidePlayers>
      <Totals>
        {shown
          .filter(total => total.value !== undefined)
          .map(total => (
            <Total key={total.label}>
              <TotalLabel>{total.label}</TotalLabel>
              <TotalValue $color={total.color}>{total.value}</TotalValue>
            </Total>
          ))}
      </Totals>
    </SideCard>
  )
}
