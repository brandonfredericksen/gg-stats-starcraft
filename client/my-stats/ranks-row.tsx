import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { LadderRank } from '../../common/games/ladder'
import { MyStatsSummary } from '../../common/my-stats/my-stats'
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
import { bahnschrift, bodySmall, labelMedium, labelSmall, titleSmall } from '../styles/typography'
import { formatPercent, getWinRate, HelpLabel, RecordText } from './my-stats-panels'

/** A rank older than this was likely played over since, so its rating is shown muted. */
const STALE_MS = 30 * 24 * 60 * 60_000

const TIME_AGO_FORMAT = relativeTimeFormat({ numeric: 'auto' })

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
`

/** A source's tag before its ranks, with a little more room before it than between ranks. */
const GroupTag = styled.span`
  display: flex;

  &:not(:first-child) {
    margin-left: var(--space-3);
  }
`

/** One rank, slim enough to read at a glance; hovering it shows the whole of it. */
const Chip = styled.span<{ $match: boolean }>`
  height: 32px;
  padding: 0 var(--space-3) 0 6px;

  display: inline-flex;
  align-items: center;
  gap: var(--space-2);

  background-color: ${props =>
    props.$match ? 'var(--theme-tab-stats-tint)' : 'var(--theme-container-high)'};
  border-radius: var(--radius-md);
  box-shadow: inset 0 0 0 1px
    ${props => (props.$match ? 'var(--theme-tab-stats-ring)' : 'var(--theme-outline-variant)')};
  white-space: nowrap;
  cursor: default;

  &:hover {
    box-shadow: inset 0 0 0 1px var(--theme-outline-strong);
  }
`

const ChipRating = styled.span<{ $stale?: boolean }>`
  ${bahnschrift};
  color: ${props => (props.$stale ? 'var(--theme-on-surface-variant)' : 'var(--theme-on-surface)')};
  font-size: 16px;
  font-weight: 700;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
`

const ChipLabel = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const ChipDivisionIcon = styled(DivisionIcon)`
  width: 20px;
  height: 20px;
`

const Unranked = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

// The card a rank shows on hover

const Card = styled.span`
  width: 232px;
  padding: var(--space-1) 0;

  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  text-align: left;
`

const CardTop = styled.span`
  ${titleSmall};
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 700;
`

const CardMain = styled.span`
  display: flex;
  align-items: center;
  gap: var(--space-3);
`

const CardIcon = styled(DivisionIcon)`
  width: 48px;
  height: 48px;
`

const CardLeague = styled(LeagueTag)`
  width: 40px;
  height: 40px;
  border-width: 2px;
  font-size: 24px;
`

const CardValues = styled.span`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const CardRating = styled.span`
  ${bahnschrift};
  font-size: 28px;
  font-weight: 700;
  line-height: 30px;
  font-variant-numeric: tabular-nums;
`

const CardFacts = styled.span`
  ${bodySmall};
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--theme-on-surface-variant);
`

const CardRecord = styled.span`
  color: var(--theme-on-surface);
  font-weight: 600;
`

const SourceNote = styled.span`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  font-weight: 500;
`

const None = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
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

/** Everything about one rank, for its chip and the card it shows on hover. */
interface RankView {
  key: string
  source: 'battleNet' | 'shieldBattery'
  /** The mode or gateway, like 3v3 BGH or Korea. */
  label: string
  rating?: number
  /** A Battle.net league. */
  rank?: LadderRank
  /** A ShieldBattery division, like `gold2`. */
  division?: string
  record?: { wins: number; losses: number }
  /** Where it's from and when, like "Seen 1 hour ago". */
  when: string
  stale: boolean
  /** Whether it's the game type picked in the filters. */
  match: boolean
}

function divisionSrc(division: string) {
  return `ggstats://app/assets/ranks/${division}.svg`
}

/** The whole of one rank, bigger, for when its chip is hovered. */
function RankCard({ view }: { view: RankView }) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const tier = view.division ? getDivisionTier(view.division) : undefined
  const division = view.division ? getDivisionLabel(view.division, t) : undefined
  const decided = view.record ? view.record.wins + view.record.losses : 0
  return (
    <Card>
      <CardTop>
        <SourceTag $source={view.source}>
          {view.source === 'battleNet'
            ? t('liveGame.battleNetShort', 'BNET')
            : t('liveGame.shieldBatteryShort', 'SB')}
        </SourceTag>
        {view.label}
        {view.source === 'battleNet' ? (
          <SourceNote>{t('myStats.ranks.ladderShort', '1v1 ladder')}</SourceNote>
        ) : null}
      </CardTop>
      <CardMain>
        {view.division ? (
          <CardIcon src={divisionSrc(view.division)} alt='' draggable={false} />
        ) : null}
        {view.rank ? <CardLeague $rank={view.rank}>{view.rank.toUpperCase()}</CardLeague> : null}
        <CardValues>
          <CardRating>
            {view.rating === undefined
              ? t('myStats.ranks.unranked', 'Unranked')
              : format.format(view.rating)}
          </CardRating>
          {division && tier ? <DivisionName $tier={tier}>{division}</DivisionName> : null}
          {view.division === 'unrated' ? (
            <Unranked>{t('myStats.ranks.unrated', 'Unrated')}</Unranked>
          ) : null}
        </CardValues>
      </CardMain>
      <CardFacts>
        {view.record ? (
          <span>
            <CardRecord>
              <RecordText record={view.record} />
            </CardRecord>{' '}
            {decided
              ? t('myStats.ranks.seasonRecord', 'this season, {{rate}} won', {
                  rate: formatPercent(getWinRate({ games: decided, ...view.record })),
                })
              : t('myStats.ranks.seasonRecordNone', 'this season')}
          </span>
        ) : null}
        <span>{view.when}</span>
      </CardFacts>
    </Card>
  )
}

function RankChip({ view }: { view: RankView }) {
  const { t } = useTranslation()
  const format = useStatFormat()
  return (
    <Tooltip text={<RankCard view={view} />} position='bottom'>
      <Chip $match={view.match}>
        {view.division ? (
          <ChipDivisionIcon src={divisionSrc(view.division)} alt='' draggable={false} />
        ) : null}
        {view.rank ? <LeagueTag $rank={view.rank}>{view.rank.toUpperCase()}</LeagueTag> : null}
        {view.rating === undefined ? (
          <Unranked>{t('myStats.ranks.unranked', 'Unranked')}</Unranked>
        ) : (
          <ChipRating $stale={view.stale}>{format.format(view.rating)}</ChipRating>
        )}
        <ChipLabel>{view.label}</ChipLabel>
      </Chip>
    </Tooltip>
  )
}

/**
 * Where a player stands: their 1v1 ladder rank on each Battle.net gateway they've been seen on, and
 * their division in every ShieldBattery mode they played this season, most played first. Each is a
 * slim chip that shows the whole rank on hover. The game type picked in the filters is marked out,
 * never narrowed to.
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
  const seenWhen = (ms: number) =>
    t('myStats.ranks.seen', 'Seen {{when}}', { when: timeAgo.format(Math.min(ms, nowMs)) })

  const battleNet: RankView[] = seen
    .flatMap(p => p.battleNet)
    .sort((a, b) => b.seenMs - a.seenMs)
    .map(standing => ({
      key: `bnet-${standing.gatewayId}`,
      source: 'battleNet',
      label: getRegionLabel(standing.gatewayId, t) ?? t('myStats.ranks.ladder', '1v1 ladder'),
      rating: standing.rating,
      rank: standing.rank,
      record: standing,
      when: seenWhen(standing.seenMs),
      stale: nowMs - standing.seenMs > STALE_MS,
      match: shape === '1v1',
    }))
  // Their replays say where they stood when no profile of theirs was seen.
  if (!battleNet.length && fromGame) {
    battleNet.push({
      key: 'bnet-game',
      source: 'battleNet',
      label: t('myStats.ranks.ladder', '1v1 ladder'),
      rating: fromGame.mmr,
      rank: fromGame.rank,
      when: t('myStats.ranks.fromGame', 'From the latest ranked game, {{when}}.', {
        when: timeAgo.format(Math.min(fromGame.gameTimeMs, nowMs)),
      }),
      stale: nowMs - fromGame.gameTimeMs > STALE_MS,
      match: shape === '1v1',
    })
  }
  const shieldBattery: RankView[] = seen.flatMap(p => {
    const profile = p.shieldBattery
    return profile
      ? profile.modes.map(mode => ({
          key: `sb-${profile.userId}-${mode.mode}`,
          source: 'shieldBattery' as const,
          label: getModeLabel(mode.mode, t),
          rating: mode.rating,
          division: mode.division,
          record: mode,
          when: seenWhen(profile.seenMs),
          stale: nowMs - profile.seenMs > STALE_MS,
          match: !!shape && mode.mode.startsWith(shape),
        }))
      : []
  })

  if (!battleNet.length && !shieldBattery.length) {
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
  return (
    <Row>
      {battleNet.length ? (
        <GroupTag>
          <SourceTag $source='battleNet'>{t('liveGame.battleNetShort', 'BNET')}</SourceTag>
        </GroupTag>
      ) : null}
      {battleNet.map(view => (
        <RankChip key={view.key} view={view} />
      ))}
      {shieldBattery.length ? (
        <GroupTag>
          <SourceTag $source='shieldBattery'>{t('liveGame.shieldBatteryShort', 'SB')}</SourceTag>
        </GroupTag>
      ) : null}
      {shieldBattery.map(view => (
        <RankChip key={view.key} view={view} />
      ))}
    </Row>
  )
}
