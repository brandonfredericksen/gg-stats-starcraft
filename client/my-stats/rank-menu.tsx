import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { LADDER_RANKS, LadderRank } from '../../common/games/ladder'
import { RankMmr } from '../../common/my-stats/coach'
import { useStatFormat } from '../games/game-stats-shared'
import { RankBadge } from '../ladder/rank-badge'
import { SegmentMenu, SegmentOption } from '../material/segmented'
import { myStatsFiltersAtom } from './my-stats-data'

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
  const rankName = (rank: LadderRank) =>
    t('myStats.filters.rankOption', 'Rank {{rank}}', { rank: rank.toUpperCase() })

  const options: Array<SegmentOption<LadderRank | 'any' | undefined>> = [
    {
      value: undefined,
      label: t('myStats.filters.rankAuto', 'Auto'),
      menuDetail: autoRank
        ? t('myStats.filters.rankAutoDetail', 'Your latest rank, {{rank}}', {
            rank: autoRank.toUpperCase(),
          })
        : t('myStats.filters.rankAutoNone', 'Any rank, until you have a ranked game'),
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
