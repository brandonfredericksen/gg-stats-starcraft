import { TFunction } from 'i18next'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { LadderRank } from '../../common/games/ladder'
import { MyStatsSummary } from '../../common/my-stats/my-stats'
import { SeenLadderStanding, SeenShieldBatteryMode } from '../../common/player-ranks'
import { useStatFormat } from '../games/game-stats-shared'
import { relativeTimeFormat, useFormat } from '../i18n/locale-formats'
import { getRegionLabel } from '../live-game/live-player-details'
import { Tooltip } from '../material/tooltip'
import { usePlayerRanks } from '../players/player-ranks'
import {
  DivisionIcon,
  DivisionName,
  getDivisionLabel,
  getDivisionTier,
  LeagueTag,
  SourceTag,
} from '../players/rank-tags'
import { useCurrentMinuteMs } from '../react/date-hooks'
import { bahnschrift, bodySmall, labelMedium, labelSmall } from '../styles/typography'
import { HelpLabel, RecordText } from './my-stats-panels'

/** A rank older than this was likely played over since, so its rating is shown muted. */
const STALE_MS = 30 * 24 * 60 * 60_000

const TIME_AGO_FORMAT = relativeTimeFormat({ numeric: 'auto' })

const Band = styled.div`
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--theme-outline-variant);

  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  /* Set apart by a gap rather than a line, which would start a wrapped row with a stray line. */
  gap: var(--space-3) var(--space-8);
`

/** One source's ranks after its tag. */
const Group = styled.div`
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
`

/** The source's tag, level with its cells' numbers. */
const GroupTag = styled.span`
  flex-shrink: 0;
  margin-top: 21px;
  display: flex;
`

const Cells = styled.div`
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-4);
`

/** As wide as it needs, but no narrower than most, so a wrapped row mostly lines up. */
const Cell = styled.div`
  min-width: 112px;
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const CellTop = styled.div<{ $match: boolean }>`
  ${labelSmall};
  min-width: 0;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  color: ${props => (props.$match ? 'var(--theme-primary)' : 'var(--theme-on-surface-variant)')};
  font-weight: ${props => (props.$match ? 700 : 500)};
`

const CellLabel = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const CellRecord = styled.span`
  flex-shrink: 0;
  font-weight: 500;
`

const Value = styled.div<{ $stale?: boolean }>`
  ${bahnschrift};
  min-width: 0;
  height: 22px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: ${props => (props.$stale ? 'var(--theme-on-surface-variant)' : 'var(--theme-on-surface)')};
  font-size: 18px;
  font-weight: 700;
  line-height: 22px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const Unranked = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const CellDivisionIcon = styled(DivisionIcon)`
  width: 20px;
  height: 20px;
`

const None = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const HelpText = styled.span`
  ${bodySmall};
  max-width: 260px;
  text-align: left;
`

/** ShieldBattery's name for a matchmaking mode, like 3v3 BGH for `3v3bgh`. */
function getModeLabel(mode: string, t: TFunction) {
  const [, size = mode, kind] = /^(\d+v\d+)(.*)$/.exec(mode) ?? []
  switch (kind) {
    case '':
      return size
    case 'fastest':
      return t('myStats.ranks.modeFastest', '{{size}} Fastest', { size })
    case 'bgh':
      return t('myStats.ranks.modeBgh', '{{size}} BGH', { size })
    case 'hunters':
      return t('myStats.ranks.modeHunters', '{{size}} Hunters', { size })
    default:
      return mode
  }
}

/** Whether a ShieldBattery mode, like `3v3bgh`, is a game type the filters picked, like 3v3. */
function matchesShape(mode: string, shape: string | undefined) {
  return !!shape && mode.startsWith(shape)
}

function LeagueValue({
  rank,
  rating,
  stale,
}: {
  rank?: LadderRank
  rating?: number
  stale?: boolean
}) {
  const { t } = useTranslation()
  const format = useStatFormat()
  return (
    <Value $stale={stale}>
      {rank ? <LeagueTag $rank={rank}>{rank.toUpperCase()}</LeagueTag> : null}
      {rating === undefined ? (
        <Unranked>{t('myStats.ranks.unranked', 'Unranked')}</Unranked>
      ) : (
        format.format(rating)
      )}
    </Value>
  )
}

function BattleNetCell({
  standing,
  match,
  isMe,
  nowMs,
}: {
  standing: SeenLadderStanding
  match: boolean
  isMe: boolean
  nowMs: number
}) {
  const { t } = useTranslation()
  const timeAgo = useFormat(TIME_AGO_FORMAT)
  const seen = t('myStats.ranks.seen', 'Seen {{when}}', {
    when: timeAgo.format(Math.min(standing.seenMs, nowMs)),
  })
  const help = isMe
    ? t(
        'myStats.ranks.battleNetHelpMe',
        'Your 1v1 ladder season, from when StarCraft last looked up your profile for a match.',
      )
    : t(
        'myStats.ranks.battleNetHelp',
        'Their 1v1 ladder season, from when StarCraft last looked up their profile for a match you were in.',
      )
  return (
    <Cell>
      <CellTop $match={match}>
        <CellLabel>
          <HelpLabel
            label={getRegionLabel(standing.gatewayId, t) ?? t('myStats.ranks.ladder', '1v1 ladder')}
            help={`${seen}. ${help}`}
            quiet={true}
          />
        </CellLabel>
        <CellRecord>
          <RecordText record={standing} />
        </CellRecord>
      </CellTop>
      <LeagueValue
        rank={standing.rank}
        rating={standing.rating}
        stale={nowMs - standing.seenMs > STALE_MS}
      />
    </Cell>
  )
}

function ShieldBatteryCell({
  mode,
  match,
  stale,
}: {
  mode: SeenShieldBatteryMode
  match: boolean
  stale: boolean
}) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const tier = mode.division ? getDivisionTier(mode.division) : undefined
  const division = mode.division ? getDivisionLabel(mode.division, t) : undefined
  return (
    <Cell>
      <CellTop $match={match}>
        <CellLabel>{getModeLabel(mode.mode, t)}</CellLabel>
        <CellRecord>
          <RecordText record={mode} />
        </CellRecord>
      </CellTop>
      <Value $stale={stale}>
        {mode.division ? (
          <CellDivisionIcon
            src={`ggstats://app/assets/ranks/${mode.division}.svg`}
            alt=''
            draggable={false}
          />
        ) : null}
        {format.format(mode.rating)}
        {division && tier ? <DivisionName $tier={tier}>{division}</DivisionName> : null}
        {mode.division === 'unrated' ? (
          <Unranked>{t('myStats.ranks.unrated', 'Unrated')}</Unranked>
        ) : null}
      </Value>
    </Cell>
  )
}

/**
 * Where a player stands, in one band above the filters: their 1v1 ladder rank on each Battle.net
 * gateway they've been seen on, and their division in every ShieldBattery mode they played this
 * season, most played first. The game type picked in the filters is marked out, never narrowed to.
 */
export function RanksRow({
  accounts,
  isMe,
  shape,
  fromGame,
}: {
  accounts: ReadonlyArray<string>
  isMe: boolean
  /** The game type picked in the filters. */
  shape: string | undefined
  /** Where their replays say they stood on the ladder, for when no profile was seen. */
  fromGame: MyStatsSummary['ladder']
}) {
  const { t } = useTranslation()
  const timeAgo = useFormat(TIME_AGO_FORMAT)
  const nowMs = useCurrentMinuteMs()
  const seen = usePlayerRanks(accounts)
  if (!seen) {
    return null
  }
  const battleNet = seen.flatMap(p => p.battleNet).sort((a, b) => b.seenMs - a.seenMs)
  const shieldBattery = seen.flatMap(p => (p.shieldBattery ? [p.shieldBattery] : []))
  const ladderMatch = shape === '1v1'

  const groups: React.ReactNode[] = []
  if (battleNet.length || fromGame) {
    groups.push(
      <Group key='bnet'>
        <GroupTag>
          <SourceTag $source='battleNet'>{t('liveGame.battleNetShort', 'BNET')}</SourceTag>
        </GroupTag>
        <Cells>
          {battleNet.map(standing => (
            <BattleNetCell
              key={standing.gatewayId}
              standing={standing}
              match={ladderMatch}
              isMe={isMe}
              nowMs={nowMs}
            />
          ))}
          {/* Their replays say where they stood when no profile of theirs was seen. */}
          {!battleNet.length && fromGame ? (
            <Cell>
              <CellTop $match={ladderMatch}>
                <CellLabel>
                  <HelpLabel
                    label={t('myStats.ranks.ladder', '1v1 ladder')}
                    help={t('myStats.ranks.fromGame', 'From the latest ranked game, {{when}}.', {
                      when: timeAgo.format(Math.min(fromGame.gameTimeMs, nowMs)),
                    })}
                    quiet={true}
                  />
                </CellLabel>
              </CellTop>
              <LeagueValue
                rank={fromGame.rank}
                rating={fromGame.mmr}
                stale={nowMs - fromGame.gameTimeMs > STALE_MS}
              />
            </Cell>
          ) : null}
        </Cells>
      </Group>,
    )
  }
  for (const profile of shieldBattery) {
    const stale = nowMs - profile.seenMs > STALE_MS
    groups.push(
      <Group key={`sb-${profile.userId}`}>
        <GroupTag>
          <Tooltip
            text={
              <HelpText>
                {t('myStats.ranks.seen', 'Seen {{when}}', {
                  when: timeAgo.format(Math.min(profile.seenMs, nowMs)),
                })}
                {'. '}
                {isMe
                  ? t(
                      'myStats.ranks.shieldBatteryHelpMe',
                      'Your season in each ShieldBattery mode, from when your profile was last opened in ShieldBattery.',
                    )
                  : t(
                      'myStats.ranks.shieldBatteryHelp',
                      'Their season in each ShieldBattery mode, from when you last opened their profile in ShieldBattery.',
                    )}
              </HelpText>
            }
            position='top'>
            <SourceTag $source='shieldBattery'>{t('liveGame.shieldBatteryShort', 'SB')}</SourceTag>
          </Tooltip>
        </GroupTag>
        <Cells>
          {profile.modes.map(mode => (
            <ShieldBatteryCell
              key={mode.mode}
              mode={mode}
              match={matchesShape(mode.mode, shape)}
              stale={stale}
            />
          ))}
        </Cells>
      </Group>,
    )
  }

  if (groups.length) {
    return <Band>{groups}</Band>
  }
  // Seeing none of someone else's ranks is worth knowing; for the user's own page it's noise.
  return isMe ? null : (
    <None>
      <HelpLabel
        label={t('myStats.ranks.none', 'No ranks seen yet')}
        help={t(
          'myStats.ranks.noneHelp',
          "Their ranks show here once StarCraft looks up their profile for a ladder match you're in, or you open their ShieldBattery profile.",
        )}
      />
    </None>
  )
}
