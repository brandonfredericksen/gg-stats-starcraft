import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getRaceLetter } from '../../common/games/game-labels'
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
  /* The letter lands a little low in the square; this centers it, measured at 4x. */
  padding-bottom: 1px;
`

/** A player's race as its letter on a tint of the race's color, sized to sit next to a name. */
export function RaceTag({ race, className }: { race: RaceChar; className?: string }) {
  const { t } = useTranslation()
  return (
    <Root $color={getRaceColor(race)} className={className} aria-hidden={true}>
      {getRaceLetter(race, t)}
    </Root>
  )
}
