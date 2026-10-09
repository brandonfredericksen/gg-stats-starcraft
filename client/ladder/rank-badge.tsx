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

  /* A hexagon standing on a point, the same on every side, so the letter sits in its middle. */
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  background: linear-gradient(
    170deg,
    color-mix(in srgb, ${props => getRankColor(props.$rank)}, white 30%) 0%,
    ${props => getRankColor(props.$rank)} 55%
  );
  color: var(--theme-rank-letter);
  font-weight: 800;
  line-height: 1;
  /* Down to the capital itself, so it's centered by its own height rather than the font's. */
  text-box: trim-both cap alphabetic;
  /* The capital lands a pixel low in the badge's even height, which this lifts it by. */
  padding-bottom: 2px;
`

/** A 1v1 ladder rank's letter on a hexagon in the rank's color. */
export function RankBadge({ rank, className }: { rank: LadderRank; className?: string }) {
  return (
    <Badge $rank={rank} className={className} aria-hidden={true}>
      {rank.toUpperCase()}
    </Badge>
  )
}
