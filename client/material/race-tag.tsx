import styled from 'styled-components'
import { RaceChar } from '../../common/races'
import { getRaceColor } from '../styles/colors'
import { labelSmall } from '../styles/typography'

const Root = styled.span<{ $color: string }>`
  ${labelSmall};
  width: 18px;
  height: 18px;
  flex-shrink: 0;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  background-color: rgb(from ${props => props.$color} r g b / 0.16);
  border-radius: 5px;
  color: ${props => props.$color};
  font-weight: 800;
  line-height: 1;
`

/** A player's race as its letter on a tint of the race's color, sized to sit next to a name. */
export function RaceTag({ race, className }: { race: RaceChar; className?: string }) {
  return (
    <Root $color={getRaceColor(race)} className={className} aria-hidden={true}>
      {race.toUpperCase()}
    </Root>
  )
}
