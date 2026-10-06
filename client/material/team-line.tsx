import styled from 'styled-components'
import { RaceChar } from '../../common/races'
import { MaterialIcon } from '../icons/material/material-icon'
import { bodyMedium, singleLine } from '../styles/typography'
import { RaceTag } from './race-tag'

/** How many players a team line fits on one row before wrapping onto the next. */
const SLOTS_PER_ROW = 4
const MIN_SLOT_WIDTH = 84
/** Four slots and their gaps fit in the 564px a team line has for names in a library row. */
const MAX_SLOT_WIDTH = 138

/**
 * The width of every name slot, from the longest of `names`. Sized once for a whole list of games,
 * every row's names line up in the same columns. Longer names are cut off.
 */
export function getTeamSlotWidth(names: ReadonlyArray<string>): number {
  const longest = names.reduce((max, name) => Math.max(max, name.length), 0)
  return Math.max(MIN_SLOT_WIDTH, Math.min(MAX_SLOT_WIDTH, Math.round(longest * 8.2 + 44)))
}

export type TeamLineResult = 'won' | 'lost' | 'hidden'

const Line = styled.div<{ $result: TeamLineResult }>`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;

  color: ${props =>
    props.$result === 'lost' ? 'var(--theme-on-surface-variant)' : 'var(--theme-on-surface)'};
`

const TrophySlot = styled.span`
  width: 16px;
  flex-shrink: 0;
  display: inline-flex;
  justify-content: center;
`

const Bar = styled.span<{ $result: TeamLineResult }>`
  width: 4px;
  height: 18px;
  flex-shrink: 0;

  border-radius: var(--radius-full);
  background-color: ${props => {
    if (props.$result === 'won') return 'var(--theme-on-surface)'
    else if (props.$result === 'hidden') return 'var(--theme-container-highest)'
    else return 'transparent'
  }};
  box-shadow: inset 0 0 0 1px
    ${props => (props.$result === 'lost' ? 'var(--theme-outline)' : 'transparent')};
`

const Slots = styled.div<{ $slotWidth: number }>`
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(${SLOTS_PER_ROW}, ${props => props.$slotWidth}px);
  align-items: center;
  gap: 2px 4px;
`

const Player = styled.span`
  min-width: 0;
  height: 26px;
  padding: 0 8px 0 4px;

  display: flex;
  align-items: center;
  gap: 6px;
`

const Name = styled.span<{ $result: TeamLineResult; $you: boolean }>`
  ${bodyMedium};
  ${singleLine};
  min-width: 0;
  /* Room below the text so the underline marking the user's name isn't cut off */
  padding-block: 4px;

  font-weight: ${props => {
    if (props.$result === 'won') return 700
    else if (props.$result === 'hidden') return 600
    else return 500
  }};
  text-decoration: ${props => (props.$you ? 'underline' : 'none')};
  text-decoration-color: rgb(from var(--theme-on-surface) r g b / 0.45);
  text-decoration-thickness: 2px;
  text-underline-offset: 4px;
`

export interface TeamLinePlayer {
  name: string
  race: RaceChar
  /** Whether this is one of the user's own names. */
  isYou?: boolean
  isComputer?: boolean
}

/**
 * One team of a game on a single line: a trophy and solid bar when it won, an outline bar and
 * muted names when it lost, and the same quiet look for every team when results are hidden.
 * Players sit in fixed slots so every line of a game lines up.
 */
export function TeamLine({
  players,
  result,
  slotWidth,
  wonLabel,
  renderName,
  className,
}: {
  players: ReadonlyArray<TeamLinePlayer>
  result: TeamLineResult
  /** From `getTeamSlotWidth`, the same for every line in a list. */
  slotWidth: number
  /** Read out for the trophy. */
  wonLabel: string
  /** Shows a player's name some other way, like as a button that opens their card. */
  renderName?: (player: TeamLinePlayer) => React.ReactNode
  className?: string
}) {
  return (
    <Line $result={result} className={className}>
      <TrophySlot title={result === 'won' ? wonLabel : undefined}>
        {result === 'won' ? <MaterialIcon icon='trophy' size={16} filled={false} /> : null}
      </TrophySlot>
      <Bar $result={result} />
      <Slots $slotWidth={slotWidth}>
        {players.map((p, i) => (
          <Player key={i}>
            <RaceTag race={p.race} />
            <Name $result={result} $you={!!p.isYou} title={p.name}>
              {renderName ? renderName(p) : p.name}
            </Name>
          </Player>
        ))}
      </Slots>
    </Line>
  )
}
