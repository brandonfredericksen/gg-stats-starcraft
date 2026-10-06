import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { AssignedRaceChar, raceCharToLabel } from '../../common/races'
import { getRaceColor } from '../styles/colors'
import { labelSmall } from '../styles/typography'
import { RaceTag } from './race-tag'
import { Tooltip } from './tooltip'

/** A race's part of the bar too thin for its letter, which is left out rather than cut off. */
const MIN_LETTER_SHARE = 0.3

const Root = styled.span`
  ${labelSmall};
  width: 48px;
  height: 18px;
  flex-shrink: 0;

  display: inline-flex;
  overflow: hidden;

  border-radius: 5px;
  font-weight: 800;
  line-height: 1;
`

const Segment = styled.span<{ $color: string }>`
  min-width: 0;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  background-color: rgb(from ${props => props.$color} r g b / 0.2);
  color: ${props => props.$color};

  & + & {
    border-left: 1px solid var(--theme-container-low);
  }
`

const Breakdown = styled.span`
  display: grid;
  grid-template-columns: auto auto auto;
  align-items: center;
  gap: 4px 8px;
`

const Percent = styled.span`
  font-variant-numeric: tabular-nums;
  text-align: right;
`

/**
 * The races someone played as one small bar, split by how much they played each, in the races'
 * colors. Always the same width, so the names next to it line up.
 */
export function RaceMix({
  races,
  className,
}: {
  /** How many games they played as each race. */
  races: ReadonlyArray<{ race: AssignedRaceChar; games: number }>
  className?: string
}) {
  const { t } = useTranslation()
  const total = races.reduce((sum, { games }) => sum + games, 0)
  const shares = races
    .filter(({ games }) => games > 0)
    .map(({ race, games }) => ({ race, share: games / total }))
    .sort((a, b) => b.share - a.share)
  const label = shares
    .map(({ race, share }) =>
      t('races.mixPart', '{{race}} {{percent}}%', {
        race: raceCharToLabel(race, t),
        percent: Math.round(share * 100),
      }),
    )
    .join(', ')

  return (
    <Tooltip
      className={className}
      position='top'
      text={
        <Breakdown>
          {shares.map(({ race, share }) => (
            <Fragment key={race}>
              <RaceTag race={race} />
              <span>{raceCharToLabel(race, t)}</span>
              <Percent>{Math.round(share * 100)}%</Percent>
            </Fragment>
          ))}
        </Breakdown>
      }>
      <Root role='img' aria-label={label}>
        {shares.map(({ race, share }) => (
          <Segment key={race} $color={getRaceColor(race)} style={{ flex: `${share} 1 0` }}>
            {share >= MIN_LETTER_SHARE ? race.toUpperCase() : null}
          </Segment>
        ))}
      </Root>
    </Tooltip>
  )
}
