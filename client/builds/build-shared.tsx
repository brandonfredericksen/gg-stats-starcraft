import { TFunction } from 'i18next'
import styled from 'styled-components'
import { BuildStepSummary } from '../../common/my-stats/builds'
import { Cell, formatGameTime, getBuildName, Table } from '../coach/coach-shared'
import { buttonReset } from '../material/button-reset'
import { labelMedium } from '../styles/typography'

/** A table of builds, its highlight reaching a little past the text on each side. */
export const BuildsGrid = styled(Table)<{ $lastColumn: number }>`
  margin-inline: calc(-1 * var(--space-3));

  & > :first-child,
  & > button > :first-child {
    padding-left: var(--space-3);
  }

  & > :nth-child(${props => props.$lastColumn}),
  & > button > :last-child {
    padding-right: var(--space-3);
  }
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

/** A short tag after a build's name, like the one the user plays most. */
export const BuildTag = styled.span`
  ${labelMedium};
  height: 20px;
  margin-block: -2px;
  margin-left: var(--space-2);
  padding: 0 var(--space-2);

  display: inline-flex;
  align-items: center;
  vertical-align: middle;

  border-radius: var(--radius-full);
  background: var(--theme-tab-builds-tint);
  color: var(--theme-tab-builds);
  font-weight: 600;
`

/** How many players a build's games are from, after the games. */
export const PlayersCount = styled.span`
  margin-left: var(--space-2);
  color: var(--theme-on-surface-variant);
`

/** A name with the game's icon for it in front, when the icons have been saved. */
export const IconName = styled.span`
  margin-block: -6px;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  vertical-align: middle;
`

/** A cell set apart from the cell before it. */
export const GroupStartCell = styled(Cell)`
  padding-left: var(--space-8);
`

const OPENER_NAMES: Record<string, (t: TFunction) => string> = {
  nexusFirst: t => t('builds.family.nexusFirst', 'Nexus first'),
  forgeExpand: t => t('builds.family.forgeExpand', 'Forge expand'),
  forgeCannons: t => t('builds.family.forgeCannons', 'Forge, cannons'),
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
  pool4: t => t('builds.family.earlyPool', 'Early pool'),
  pool9: t => t('builds.family.pool9', '9 pool'),
  overpool: t => t('builds.family.overpool', 'Overpool'),
  pool12: t => t('builds.family.pool12', '12 pool'),
  hatch: t => t('builds.family.hatchFirst', 'Hatch first'),
  hatch3: t => t('builds.family.hatch3', '3 hatch before pool'),
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
  muta1: t => t('builds.family.muta1', '1 hatch spire'),
  muta2: t => t('builds.family.muta2', '2 hatch muta'),
  muta3: t => t('builds.family.muta3', '3 hatch muta'),
  lurker: t => t('builds.family.lurker', 'Lurker'),
  hydra: t => t('builds.family.hydra', 'Hydra'),
  speed: t => t('builds.family.speed', 'speed'),
  allIn: t => t('builds.family.allIn', 'all in'),
}

/** A Spire build's name when Hydras became its army, see `intoHydra` in `getBuildFamily`. */
const SPIRE_NAMES: Record<string, (t: TFunction) => string> = {
  muta1: t => t('builds.family.spire1', '1 hatch spire into Hydra'),
  muta2: t => t('builds.family.spire2', '2 hatch spire into Hydra'),
  muta3: t => t('builds.family.spire3', '3 hatch spire into Hydra'),
}

/**
 * A build's name from its family, like "1 Gate expand, Robo, Reaver" or "Hatch first, 2 hatch
 * muta". See `getBuildFamily`.
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

/** Hatcheries, Nexuses and Command Centers, which players number counting the one they start with. */
const TOWN_HALL_KEYS: ReadonlySet<string> = new Set(['u131', 'u154', 'u106'])

/**
 * A step's name, numbered when it's not the first of its kind, like "Gateway 2". Town halls count
 * the one the player started with, so the first one built is "Hatchery 2".
 */
export function getStepName(step: Pick<BuildStepSummary, 'key' | 'nth'>, t: TFunction) {
  const name = getBuildName(step.key, t)
  const nth = TOWN_HALL_KEYS.has(step.key) ? step.nth + 1 : step.nth
  return nth > 1 ? `${name} ${nth}` : name
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
