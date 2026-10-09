import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { LADDER_RANKS, LadderRank } from '../../common/games/ladder'
import { RankBadge } from '../ladder/rank-badge'
import { SegmentMenu, SegmentOption } from '../material/segmented'
import { myStatsFiltersAtom } from './my-stats-data'

/**
 * The 1v1 ladder rank other players need to be compared with, for My stats and the coach alike.
 * Until the user picks, it's the rank of their latest ranked game, shown as `autoRank`.
 */
export function RankMenu({
  autoRank,
  label,
  showLabel,
}: {
  autoRank: LadderRank | undefined
  label: string
  showLabel?: boolean
}) {
  const { t } = useTranslation()
  const [filters, setFilters] = useAtom(myStatsFiltersAtom)
  const options: Array<SegmentOption<LadderRank | 'any' | undefined>> = [
    {
      value: undefined,
      label: t('myStats.filters.rankAuto', 'Auto'),
      menuLabel: autoRank
        ? t('myStats.filters.rankAutoMenu', 'Auto: your latest rank')
        : t('myStats.filters.rankAutoNone', 'Auto: any rank, until you have a ranked game'),
      icon: autoRank ? <RankBadge rank={autoRank} /> : undefined,
    },
    { value: 'any', label: t('myStats.filters.rankAny', 'Any rank') },
    ...LADDER_RANKS.toReversed().map(rank => ({
      value: rank,
      label: t('myStats.filters.rankOption', 'Rank {{rank}}', { rank: rank.toUpperCase() }),
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
