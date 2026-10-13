import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { BuildSide, BuildStepSummary } from '../../common/my-stats/builds'
import { Cell, formatGameTime, getBuildName, HeadCell, Table, Tone } from '../coach/coach-shared'
import { buttonReset } from '../material/button-reset'
import { Tooltip } from '../material/tooltip'
import { formatPercent, HelpLabel } from '../my-stats/my-stats-panels'
import { labelMedium } from '../styles/typography'

/**
 * A table of the Builds page. Every row is a `Row` or a `BuildRow`, and their lines and highlights
 * reach a little past the text on each side, the same in every table on the page.
 */
export const BuildsTable = styled(Table)`
  margin-inline: calc(-1 * var(--space-3));

  & > * > :first-child {
    padding-left: var(--space-3);
  }

  & > * > :last-child {
    padding-right: var(--space-3);
  }
`

/** A row of a `BuildsTable`. */
export const Row = styled.div`
  display: contents;
`

/** A row of a table of builds, which picks the build shown below it. */
export const BuildRow = styled.button<{ $selected: boolean }>`
  ${buttonReset};
  display: contents;
  cursor: pointer;

  & > * {
    background-color: ${props =>
      props.$selected ? 'var(--theme-tab-builds-tint)' : 'transparent'};
  }

  & > :first-child {
    box-shadow: ${props => (props.$selected ? 'inset 3px 0 0 var(--theme-tab-builds)' : 'none')};
  }

  &:hover > * {
    background-color: ${props =>
      props.$selected ? 'var(--theme-tab-builds-tint)' : 'var(--theme-container-high)'};
  }

  &:focus-visible > * {
    outline: 2px solid var(--theme-tab-builds-ring);
    outline-offset: -2px;
  }
`

/** A heading over a group of columns, with a line under it spanning them. */
export const SpanHead = styled.span`
  ${labelMedium};
  margin-left: var(--space-5);
  padding-bottom: var(--space-1);
  margin-bottom: var(--space-2);
  border-bottom: 1px solid var(--theme-outline-variant);
  color: var(--theme-on-surface-variant);
  font-weight: 600;
  text-align: center;
`

/**
 * A short tag after a build's name. Pink, the page's color for the user, only for what's about
 * them; outlined for what's about the build.
 */
export const BuildTag = styled.span<{ $you?: boolean }>`
  ${labelMedium};
  height: 20px;
  margin-block: -2px;
  margin-left: var(--space-2);
  padding: 0 var(--space-2);

  display: inline-flex;
  align-items: center;
  vertical-align: middle;

  border-radius: var(--radius-full);
  background: ${props => (props.$you ? 'var(--theme-tab-builds-tint)' : 'transparent')};
  box-shadow: ${props => (props.$you ? 'none' : 'inset 0 0 0 1px var(--theme-outline-strong)')};
  color: ${props => (props.$you ? 'var(--theme-tab-builds)' : 'var(--theme-on-surface-variant)')};
  font-weight: 600;
`

/** A name with the game's icon for it in front, when the icons have been saved. */
export const IconName = styled.span`
  margin-block: -6px;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  vertical-align: middle;
`

/** The size of a game icon in front of a row's name, in every table on the page. */
export const ROW_ICON_SIZE = 26
/** The size of a game icon in a legend or a tooltip. */
export const SMALL_ICON_SIZE = 20

/** Who a build's numbers are from, in the order every table and chart on the page shows them. */
export type SideKey = 'top' | 'level' | 'winners' | 'you'

export interface ShownSide {
  key: SideKey
  label: string
  /**
   * Who the side's players are, within a sentence, for a side the user's numbers can be compared
   * with.
   */
  players?: string
  /** Missing when this side has no games of the build. */
  side: BuildSide | undefined
  /** What the side's column heading explains when hovered. */
  help: string
  /** Too few games to go by, so drawn faded. */
  muted: boolean
}

/**
 * A build picked to look at, with every side that plays it. A side that doesn't play the build
 * itself can stand in with the build it's a variant of, see `asFamily`.
 */
export interface BuildCompare {
  family: string
  sides: ReadonlyArray<ShownSide>
  /** The side the user's numbers are compared with, when there's one besides theirs. */
  basis: ShownSide | undefined
}

/** The columns of a table with a row per step or number and a column per side. */
export const SIDE_COLUMNS = 'minmax(0, 1fr) repeat(4, 136px)'

/** A table's column headings for each side, explained when hovered. */
export function SideHeads({ sides }: { sides: ReadonlyArray<ShownSide> }) {
  return sides.map(side => (
    <HeadCell key={side.key} $end={true}>
      <HelpLabel label={side.label} help={side.help} />
    </HeadCell>
  ))
}

/** A win rate under this, in whole percent, is colored as bad, and over `GOOD_WIN_PERCENT` good. */
const BAD_WIN_PERCENT = 40
const GOOD_WIN_PERCENT = 60

/** A win rate's color, by the rate as it's shown: green well over even, red well under. */
function winRateTone(rate: number): Tone | undefined {
  const percent = Math.round(rate * 100)
  if (percent > GOOD_WIN_PERCENT) {
    return 'good'
  }
  return percent < BAD_WIN_PERCENT ? 'bad' : undefined
}

/**
 * A win rate, colored by how it goes, or faded when too few games decide it. The record shows when
 * hovered.
 */
export function WinRateCell({
  rate,
  wins,
  losses,
  faded,
}: {
  rate: number | undefined
  wins: number
  losses: number
  faded: boolean
}) {
  const { t } = useTranslation()
  if (rate === undefined) {
    return (
      <Cell $end={true} $tone='muted'>
        -
      </Cell>
    )
  }
  return (
    <Cell $end={true} $tone={faded ? 'muted' : winRateTone(rate)}>
      <Tooltip
        position='top'
        text={t('builds.record', '{{wins}} wins, {{losses}} losses', { wins, losses })}>
        {formatPercent(rate)}
      </Tooltip>
    </Cell>
  )
}

const OPENER_NAMES: Record<string, (t: TFunction) => string> = {
  nexusFirst: t => t('builds.family.nexusFirst', 'Nexus first'),
  forgeExpand: t => t('builds.family.forgeExpand', 'Forge expand'),
  forgeCannons: t => t('builds.family.forgeCannons', 'Forge, Cannons'),
  forge: t => t('builds.family.forge', 'Forge first'),
  gates1: t => t('builds.family.gates1', '1 Gate'),
  gates2: t => t('builds.family.gates2', '2 Gate'),
  gates3: t => t('builds.family.gates3', '3 Gate'),
  gates4: t => t('builds.family.gates4', '4+ Gate'),
  ccFirst: t => t('builds.family.ccFirst', 'CC first'),
  fd: t => t('builds.family.fd', 'FD'),
  factDouble: t => t('builds.family.factDouble', '1 Factory double expand'),
  raxCC: t => t('builds.family.raxCC', 'Rax CC'),
  bbs: t => t('builds.family.bbs', 'BBS'),
  twoRax: t => t('builds.family.twoRax', '2 Rax'),
  raxAcademy: t => t('builds.family.raxAcademy', 'Rax Academy'),
  rax: t => t('builds.family.rax', 'Rax'),
  twoPort: t => t('builds.family.twoPort', '2 Starport'),
  twoFact: t => t('builds.family.twoFact', '2 Factory'),
  oneOneOne: t => t('builds.family.oneOneOne', '1-1-1'),
  siegeExpand: t => t('builds.family.siegeExpand', 'Siege expand'),
  factExpand: t => t('builds.family.factExpand', 'Factory expand'),
  factory: t => t('builds.family.factory', 'Factory'),
  pool4: t => t('builds.family.pool4', '4/5 Pool'),
  pool8: t => t('builds.family.pool8', '8 Pool'),
  pool9: t => t('builds.family.pool9', '9 Pool'),
  overpool: t => t('builds.family.overpool', 'Overpool'),
  pool11: t => t('builds.family.pool11', '11 Pool'),
  pool12: t => t('builds.family.pool12', '12 Pool'),
  hatch: t => t('builds.family.hatchFirst', 'Hatch first'),
  hatch3: t => t('builds.family.hatch3', '3 Hatch before Pool'),
}

const FOLLOW_UP_NAMES: Record<string, (t: TFunction) => string> = {
  u155: t => t('builds.family.robo', 'Robo'),
  u163: t => t('builds.family.citadel', 'Citadel'),
  u167: t => t('builds.family.stargate', 'Stargate'),
  u165: t => t('builds.family.templar', 'Templar'),
  reaver: t => t('builds.family.reaver', 'Reaver'),
  dt: t => t('builds.family.dt', 'DT'),
  carrier: t => t('builds.family.carrier', 'Carrier'),
  arbiter: t => t('builds.family.arbiter', 'Arbiter'),
  gate3: t => t('builds.family.gate3', 'then 3rd Gate'),
  forge: t => t('builds.family.thenForge', 'then Forge'),
  core: t => t('builds.family.thenCore', 'then Core'),
  bio: t => t('builds.family.bio', 'bio'),
  bioTanks: t => t('builds.family.bioTanks', 'bio and tanks'),
  wraith: t => t('builds.family.wraith', 'Wraith'),
  valkyrie: t => t('builds.family.valkyrie', 'Valkyrie'),
  muta1: t => t('builds.family.muta1', '1 Hatch Muta'),
  muta2: t => t('builds.family.muta2', '2 Hatch Muta'),
  muta3: t => t('builds.family.muta3', '3 Hatch Muta'),
  lurker: t => t('builds.family.lurker', 'Lurker'),
  hydra: t => t('builds.family.hydra', 'Hydra'),
  speed: t => t('builds.family.speed', 'speed'),
  allIn: t => t('builds.family.allIn', 'all in'),
}

/** A Spire build's name when Hydras became its army, see `intoHydra` in `getBuildFamily`. */
const SPIRE_NAMES: Record<string, (t: TFunction) => string> = {
  muta1: t => t('builds.family.spire1', '1 Hatch Spire into Hydra'),
  muta2: t => t('builds.family.spire2', '2 Hatch Spire into Hydra'),
  muta3: t => t('builds.family.spire3', '3 Hatch Spire into Hydra'),
}

/**
 * A build's name from its family, like "1 Gate expand, Robo, Reaver" or "Hatch first, 2 Hatch
 * Muta". Unit and building names are capitalized and the rest is lowercase. See `getBuildFamily`.
 */
export function getBuildFamilyName(family: string, t: TFunction) {
  const [, opener = '', ...rest] = family.split(' ')
  let name = OPENER_NAMES[opener]?.(t) ?? opener
  if (rest.includes('expand')) {
    name = t('builds.family.expanded', '{{name}} expand', { name })
  }
  const intoHydra = rest.includes('intoHydra')
  const followUps = rest
    .filter(part => part !== 'expand' && part !== 'intoHydra')
    .map(part => (intoHydra && SPIRE_NAMES[part] ? SPIRE_NAMES[part] : FOLLOW_UP_NAMES[part])?.(t))
  return [name, ...followUps.filter(Boolean)].join(', ')
}

/** Whether a build is an all-in, see `getBuildFamily`. */
export function isAllInFamily(family: string) {
  return family.split(' ').includes('allIn')
}

/**
 * The closest of some builds to a build: the build itself, or else the build it's a variant of,
 * like "9 Pool" for "9 Pool, 2 Hatch Spire into Hydra", down to its opening.
 */
export function closestFamily(family: string, has: (family: string) => boolean) {
  const parts = family.split(' ')
  // The race and the opening name the shortest build.
  for (let length = parts.length; length >= 2; length--) {
    const candidate = parts.slice(0, length).join(' ')
    if (has(candidate)) {
      return candidate
    }
  }
  return undefined
}

/** Hatcheries, Nexuses and Command Centers, which players number counting the one they start with. */
const TOWN_HALL_KEYS: ReadonlySet<string> = new Set(['u131', 'u154', 'u106'])

/**
 * A step's name, numbered when it's not the first of its kind, like "Gateway 2". Town halls are
 * said the way players say them, counting the one the player started with, so the first one built
 * is the "2nd Hatch".
 */
export function getStepName(step: Pick<BuildStepSummary, 'key' | 'nth'>, t: TFunction) {
  const name = getBuildName(step.key, t)
  if (TOWN_HALL_KEYS.has(step.key)) {
    return t('builds.townHallStep', {
      defaultValue_ordinal_one: '{{count}}st {{name}}',
      defaultValue_ordinal_two: '{{count}}nd {{name}}',
      defaultValue_ordinal_few: '{{count}}rd {{name}}',
      defaultValue_ordinal_other: '{{count}}th {{name}}',
      count: step.nth + 1,
      ordinal: true,
      name: TOWN_HALL_SHORT_NAMES[step.key]?.(t) ?? name,
    })
  }
  return step.nth > 1 ? `${name} ${step.nth}` : name
}

/** What players call a town hall when they count them, like the "3rd Hatch". */
const TOWN_HALL_SHORT_NAMES: Record<string, (t: TFunction) => string> = {
  u131: t => t('builds.townHall.hatch', 'Hatch'),
  u154: t => t('builds.townHall.nexus', 'Nexus'),
  u106: t => t('builds.townHall.cc', 'CC'),
}

/** A step's supply and time, like "21 · 4:13", or a dash for a side that doesn't usually take it. */
export function formatStep(step: BuildStepSummary | undefined) {
  if (!step) {
    return '-'
  }
  const time = formatGameTime(step.timeMs)
  return step.supply !== undefined ? `${step.supply} · ${time}` : time
}

export const stepId = (step: Pick<BuildStepSummary, 'key' | 'nth'>) => `${step.key}#${step.nth}`
