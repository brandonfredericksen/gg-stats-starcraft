import { TFunction } from 'i18next'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { LadderRank } from '../../common/games/ladder'
import { MyStatsSummary } from '../../common/my-stats/my-stats'
import { SeenLadderStanding, SeenShieldBatteryMode } from '../../common/player-ranks'
import { StatsPanel, useStatFormat } from '../games/game-stats-shared'
import { relativeTimeFormat, useFormat } from '../i18n/locale-formats'
import { getRegionLabel } from '../live-game/live-player-details'
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
import { bahnschrift, bodySmall, labelMedium } from '../styles/typography'
import { HelpLabel, RecordText } from './my-stats-panels'

const Row = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(196px, 1fr));
  gap: var(--space-3);
`

const Tile = styled(StatsPanel)`
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const TileTop = styled.div`
  ${labelMedium};
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--theme-on-surface-variant);
`

const TileName = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Value = styled.div`
  ${bahnschrift};
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 24px;
  font-weight: 700;
  line-height: 28px;
  font-variant-numeric: tabular-nums;
`

const Unranked = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const BigDivisionIcon = styled(DivisionIcon)`
  width: 28px;
  height: 28px;
`

const Note = styled.div`
  ${bodySmall};
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: var(--space-2);
  color: var(--theme-on-surface-variant);
`

const TIME_AGO_FORMAT = relativeTimeFormat({ numeric: 'auto' })

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

function LeagueValue({ rank, value }: { rank?: LadderRank; value?: string }) {
  const { t } = useTranslation()
  return (
    <Value>
      {rank ? <LeagueTag $rank={rank}>{rank.toUpperCase()}</LeagueTag> : null}
      {value ?? <Unranked>{t('myStats.ranks.unranked', 'Unranked')}</Unranked>}
    </Value>
  )
}

function BattleNetTile({ standing, isMe }: { standing: SeenLadderStanding; isMe: boolean }) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const timeAgo = useFormat(TIME_AGO_FORMAT)
  const nowMs = useCurrentMinuteMs()
  return (
    <Tile>
      <TileTop>
        <SourceTag $source='battleNet'>{t('liveGame.battleNetShort', 'BNET')}</SourceTag>
        <TileName>
          {[t('myStats.ranks.ladder', '1v1 ladder'), getRegionLabel(standing.gatewayId, t)]
            .filter(Boolean)
            .join(' · ')}
        </TileName>
      </TileTop>
      <LeagueValue
        rank={standing.rank}
        value={standing.rating === undefined ? undefined : format.format(standing.rating)}
      />
      <Note>
        <RecordText record={standing} />
        <HelpLabel
          label={t('myStats.ranks.seen', 'Seen {{when}}', {
            when: timeAgo.format(Math.min(standing.seenMs, nowMs)),
          })}
          help={
            isMe
              ? t(
                  'myStats.ranks.battleNetSeenHelpMe',
                  'This season on the ladder, from when StarCraft last looked up your profile for a match.',
                )
              : t(
                  'myStats.ranks.battleNetSeenHelp',
                  'This season on the ladder, from when StarCraft last looked up their profile for a match you were in.',
                )
          }
        />
      </Note>
    </Tile>
  )
}

function ShieldBatteryTile({
  mode,
  seenMs,
  isMe,
}: {
  mode: SeenShieldBatteryMode
  seenMs: number
  isMe: boolean
}) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const timeAgo = useFormat(TIME_AGO_FORMAT)
  const nowMs = useCurrentMinuteMs()
  const tier = mode.division ? getDivisionTier(mode.division) : undefined
  const division = mode.division ? getDivisionLabel(mode.division, t) : undefined
  return (
    <Tile>
      <TileTop>
        <SourceTag $source='shieldBattery'>{t('liveGame.shieldBatteryShort', 'SB')}</SourceTag>
        <TileName>{getModeLabel(mode.mode, t)}</TileName>
      </TileTop>
      <Value>
        {mode.division ? (
          <BigDivisionIcon
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
      <Note>
        <RecordText record={mode} />
        <HelpLabel
          label={t('myStats.ranks.seen', 'Seen {{when}}', {
            when: timeAgo.format(Math.min(seenMs, nowMs)),
          })}
          help={
            isMe
              ? t(
                  'myStats.ranks.shieldBatterySeenHelpMe',
                  'This season in this mode, from when your ShieldBattery profile was last opened.',
                )
              : t(
                  'myStats.ranks.shieldBatterySeenHelp',
                  'This season in this mode, from when you last opened their ShieldBattery profile.',
                )
          }
        />
      </Note>
    </Tile>
  )
}

/**
 * Where a player stands: the rank their eSkill falls in, their 1v1 ladder rank on each Battle.net
 * gateway they've been seen on, and their division in every ShieldBattery mode they've played this
 * season. Ranks the app hasn't seen are left out.
 */
export function RanksRow({
  accounts,
  isMe,
  eSkill,
  fromGame,
}: {
  accounts: ReadonlyArray<string>
  isMe: boolean
  eSkill: MyStatsSummary['eSkill']
  /** Where their replays say they stood on the ladder. */
  fromGame: MyStatsSummary['ladder']
}) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const timeAgo = useFormat(TIME_AGO_FORMAT)
  const nowMs = useCurrentMinuteMs()
  const seen = usePlayerRanks(accounts) ?? []
  const battleNet = seen.flatMap(p => p.battleNet).sort((a, b) => b.seenMs - a.seenMs)
  const shieldBattery = seen.flatMap(p =>
    p.shieldBattery
      ? p.shieldBattery.modes.map(mode => ({ mode, seenMs: p.shieldBattery!.seenMs }))
      : [],
  )

  const tiles: React.ReactNode[] = []
  if (eSkill) {
    tiles.push(
      <Tile key='eSkill'>
        <TileTop>
          <HelpLabel
            label={t('players.eSkill', 'eSkill')}
            help={t(
              'players.eSkillHelp',
              "An estimate, not a ladder rating: the 1v1 ladder MMR and rank that this speed, hotkeys and macro match, over the latest games. Results don't count.",
            )}
          />
        </TileTop>
        <LeagueValue rank={eSkill.rank} value={format.format(eSkill.value)} />
        <Note>
          {t('players.eSkillGames', {
            defaultValue: 'Estimate, {{count}} games',
            defaultValue_one: 'Estimate, 1 game',
            count: eSkill.games,
          })}
        </Note>
      </Tile>,
    )
  }
  for (const standing of battleNet) {
    tiles.push(<BattleNetTile key={`bnet-${standing.gatewayId}`} standing={standing} isMe={isMe} />)
  }
  // Their replays say where they stood when nothing better has been seen.
  if (!battleNet.length && fromGame) {
    tiles.push(
      <Tile key='ladderGame'>
        <TileTop>
          <SourceTag $source='battleNet'>{t('liveGame.battleNetShort', 'BNET')}</SourceTag>
          <TileName>{t('myStats.ranks.ladder', '1v1 ladder')}</TileName>
        </TileTop>
        <LeagueValue
          rank={fromGame.rank}
          value={fromGame.mmr === undefined ? undefined : format.format(fromGame.mmr)}
        />
        <Note>
          {t('myStats.ranks.fromGame', 'Latest ranked game, {{when}}', {
            when: timeAgo.format(Math.min(fromGame.gameTimeMs, nowMs)),
          })}
        </Note>
      </Tile>,
    )
  }
  for (const { mode, seenMs } of shieldBattery) {
    tiles.push(
      <ShieldBatteryTile key={`sb-${mode.mode}`} mode={mode} seenMs={seenMs} isMe={isMe} />,
    )
  }

  return tiles.length ? <Row>{tiles}</Row> : null
}
