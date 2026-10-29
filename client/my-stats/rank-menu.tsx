import { TFunction } from 'i18next'
import { useAtom, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { LADDER_RANKS, LadderRank } from '../../common/games/ladder'
import { ESKILL_FLOORS, RankMmr } from '../../common/my-stats/coach'
import { useStatFormat } from '../games/game-stats-shared'
import { RankBadge } from '../ladder/rank-badge'
import { SegmentMenu, SegmentOption } from '../material/segmented'
import { myStatsFiltersAtom, useShowsOtherPlayer } from './my-stats-data'

/**
 * The 1v1 ladder rank other players need to be compared with, for My stats and the coach alike,
 * each with the MMRs it covers. Until the user picks, it's the rank of their latest ranked game,
 * shown as `autoRank`.
 */
export function RankMenu({
  autoRank,
  rankMmr,
  label,
  showLabel,
}: {
  autoRank: LadderRank | undefined
  rankMmr: RankMmr | undefined
  label: string
  showLabel?: boolean
}) {
  const { t } = useTranslation()
  const format = useStatFormat()
  const [filters, setFilters] = useAtom(myStatsFiltersAtom)
  const other = useShowsOtherPlayer()

  const describeMmr = (rank: LadderRank) => {
    const range = rankMmr?.[rank]
    if (!range) {
      return undefined
    }
    const low = format.format(range.low)
    const high = format.format(range.high)
    if (rank === 's') {
      return t('myStats.filters.rankMmrUp', '{{low}} MMR and up', { low })
    }
    if (rank === 'f') {
      return t('myStats.filters.rankMmrDown', 'Up to {{high}} MMR', { high })
    }
    return t('myStats.filters.rankMmr', '{{low}} to {{high}} MMR', { low, high })
  }
  const describeAuto = () => {
    if (autoRank) {
      return other
        ? t('myStats.filters.rankAutoDetailTheirs', 'Their latest rank, {{rank}}', {
            rank: autoRank.toUpperCase(),
          })
        : t('myStats.filters.rankAutoDetail', 'Your latest rank, {{rank}}', {
            rank: autoRank.toUpperCase(),
          })
    }
    return other
      ? t('myStats.filters.rankAutoNoneTheirs', 'Any rank, until they have a ranked game')
      : t('myStats.filters.rankAutoNone', 'Any rank, until you have a ranked game')
  }
  const rankName = (rank: LadderRank) =>
    t('myStats.filters.rankOption', 'Rank {{rank}}', { rank: rank.toUpperCase() })

  const options: Array<SegmentOption<LadderRank | 'any' | undefined>> = [
    {
      value: undefined,
      label: t('myStats.filters.rankAuto', 'Auto'),
      menuDetail: describeAuto(),
      icon: autoRank ? <RankBadge rank={autoRank} /> : undefined,
    },
    {
      value: 'any',
      label: t('myStats.filters.rankAny', 'Any rank'),
      menuDetail: t('myStats.filters.rankAnyDetail', 'Ranked or not'),
    },
    ...LADDER_RANKS.toReversed().map(rank => ({
      value: rank,
      label: rankName(rank),
      menuDetail: describeMmr(rank),
      icon: <RankBadge rank={rank} />,
    })),
  ]
  return (
    <SegmentMenu
      label={label}
      showLabel={showLabel}
      options={options}
      value={filters.rank}
      onChange={rank => setFilters(f => ({ ...f, rank }))}
    />
  )
}

/** What other players at an eSkill floor are called, like "eSkill B+". S is the top, so no "+". */
export function getESkillFloorName(floor: LadderRank, t: TFunction) {
  const rank = floor.toUpperCase()
  return floor === 's'
    ? t('myStats.filters.eSkillTop', 'eSkill {{rank}}', { rank })
    : t('myStats.filters.eSkillFloor', 'eSkill {{rank}}+', { rank })
}

/**
 * The eSkill rank other players need to be compared with, for My stats and the coach alike. A pick
 * applies to both.
 */
export function ESkillFloorMenu({
  floor,
  label,
  showLabel,
}: {
  floor: LadderRank
  label: string
  showLabel?: boolean
}) {
  const { t } = useTranslation()
  const setFilters = useSetAtom(myStatsFiltersAtom)
  const options: Array<SegmentOption<LadderRank>> = ESKILL_FLOORS.map(value => ({
    value,
    label: getESkillFloorName(value, t),
    menuLabel:
      value === 's'
        ? t('myStats.filters.eSkillTopPlayers', 'Players at eSkill {{rank}}', {
            rank: value.toUpperCase(),
          })
        : t('myStats.filters.eSkillFloorPlayers', 'Players at eSkill {{rank}} and up', {
            rank: value.toUpperCase(),
          }),
    icon: <RankBadge rank={value} />,
  }))
  return (
    <SegmentMenu
      label={label}
      showLabel={showLabel}
      options={options}
      value={floor}
      onChange={eSkillFloor => setFilters(f => ({ ...f, eSkillFloor }))}
    />
  )
}
