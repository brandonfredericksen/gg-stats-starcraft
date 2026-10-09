import styled from 'styled-components'
import { LadderRank } from '../../common/games/ladder'
import { getRankColor } from '../styles/colors'
import { labelMedium } from '../styles/typography'

const Badge = styled.span<{ $rank: LadderRank }>`
  ${labelMedium};
  flex-shrink: 0;
  width: 20px;
  height: 22px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  /* A shield: square shoulders, a pointed foot. */
  clip-path: polygon(0 0, 100% 0, 100% 68%, 50% 100%, 0 68%);
  padding-bottom: 3px;

  background-color: color-mix(in srgb, ${props => getRankColor(props.$rank)} 22%, transparent);
  box-shadow: inset 0 2px 0 ${props => getRankColor(props.$rank)};
  color: ${props => getRankColor(props.$rank)};
  font-weight: 800;
  line-height: 1;
`

/** A 1v1 ladder rank's letter on a shield in the rank's color. */
export function RankBadge({ rank, className }: { rank: LadderRank; className?: string }) {
  return (
    <Badge $rank={rank} className={className} aria-hidden={true}>
      {rank.toUpperCase()}
    </Badge>
  )
}
