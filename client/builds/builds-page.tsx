import { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ARMY_MIX_MINUTES } from '../../common/games/player-metrics'
import {
  BuildSide,
  BuildStepSummary,
  CoachBuild,
  CoachTeamBuild,
  WORKER_MINUTES,
  WorkerStopSummary,
} from '../../common/my-stats/builds'
import { CoachBucket, CoachResult } from '../../common/my-stats/coach'
import { AssignedRaceChar, raceCharToLabel } from '../../common/races'
import { useCoach, useShapeCounts } from '../coach/coach-data'
import {
  Badge,
  CoachToolbar,
  getPoolPlace,
  Header,
  Message,
  RaceButton,
  Races,
  Root,
  Title,
} from '../coach/coach-page'
import {
  Cell,
  formatGameTime,
  getBuildName,
  GroupHead,
  HeadCell,
  Table,
  Text,
} from '../coach/coach-shared'
import { SectionErrorBoundary } from '../games/game-stats-shared'
import { buttonReset } from '../material/button-reset'
import { RaceTag } from '../material/race-tag'
import { useDemoPlayer } from '../my-stats/demo-player'
import {
  formatPercent,
  HelpLabel,
  PaddedPanel,
  PanelHead,
  PanelHeadNote,
  PanelNote,
  PanelTitle,
} from '../my-stats/my-stats-panels'
import { LoadingDotsArea } from '../progress/dots'
import { labelMedium } from '../styles/typography'
import { OwnGamesNeeded, useOwnGamesState } from '../system-bar/own-games-needed'

/** A step this much later or earlier than the players it's compared with is pointed out. */
const OFF_STEP_MS = 20_000
/** A step fewer games than this share take is marked as one only some players add. */
const OPTIONAL_STEP_SHARE = 0.8
/**
 * A win rate from fewer decided games than this is shown faded, since it's mostly chance. Winners
 * need this many games to be what the user's steps are compared with.
 */
const MIN_RATE_GAMES = 10
/** A win rate this far from other players', both from enough games, is pointed out. */
const OFF_WIN_RATE = 0.15

/** The builds table, its highlight reaching a little past the text on each side. */
const BuildsGrid = styled(Table)`
  margin-inline: calc(-1 * var(--space-3));

  & > :first-child,
  & > button > :first-child {
    padding-left: var(--space-3);
  }

  & > :nth-child(6),
  & > button > :last-child {
    padding-right: var(--space-3);
  }
`

/** A row of the builds table, which picks the build shown below it. */
const BuildRow = styled.button<{ $selected: boolean }>`
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

const YoursTag = styled.span`
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

const Panels = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`

/** A build's name with its race in front, for tables that mix races. */
const RacedName = styled.span`
  margin-block: -2px;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  vertical-align: middle;
`

/** How often a step comes up, or who takes it, after its name. */
const StepShare = styled.span`
  margin-left: var(--space-2);
  color: var(--theme-on-surface-variant);
`

/** A step only the winners or only the user take, which says more than one most players take. */
const StepOnly = styled.span`
  margin-left: var(--space-2);
  color: var(--theme-tab-builds);
  font-weight: 600;
`

/** A step the user takes late, in a red that reads apart from the tab's pink. */
const LateCell = styled(Cell)`
  color: var(--theme-error);
  font-weight: 600;
`

/** The first column of a group in a grouped table, set apart from the group before it. */
const GroupStartCell = styled(Cell)`
  padding-left: var(--space-8);
`

const GroupStartHead = styled(HeadCell)`
  padding-left: var(--space-8);
`

/** A group's heading over its columns, with a line under it spanning them. */
const SpanHead = styled(GroupHead)`
  margin-left: var(--space-8);
  padding-bottom: var(--space-1);
  margin-bottom: var(--space-2);
  border-bottom: 1px solid var(--theme-outline-variant);
  text-align: center;
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
  pool4: t => t('builds.family.pool4', '4 pool'),
  pool9: t => t('builds.family.pool9', '9 pool'),
  overpool: t => t('builds.family.overpool', 'Overpool'),
  pool12: t => t('builds.family.pool12', '12 pool'),
  hatch: t => t('builds.family.hatch', '12 hatch'),
  hatch3: t => t('builds.family.hatch3', '3 hatch before pool'),
}

const FOLLOW_UP_NAMES: Record<string, (t: TFunction) => string> = {
  u155: t => t('builds.family.robo', 'Robo'),
  u163: t => t('builds.family.citadel', 'Citadel'),
  u167: t => t('builds.family.stargate', 'Stargate'),
  u165: t => t('builds.family.templar', 'Templar'),
  bio: t => t('builds.family.bio', 'bio'),
  mech: t => t('builds.family.mech', 'mech'),
  muta2: t => t('builds.family.muta2', '2 hatch muta'),
  muta3: t => t('builds.family.muta3', '3 hatch muta'),
  lurker: t => t('builds.family.lurker', 'Lurker'),
  hydra: t => t('builds.family.hydra', 'Hydra'),
  speed: t => t('builds.family.speed', 'speed'),
}

/**
 * A build's name from its family, like "1 Gate expand, Robo" or "12 hatch, 3 hatch muta". See
 * `getBuildFamily`.
 */
export function getBuildFamilyName(family: string, t: TFunction) {
  const [, opener = '', ...rest] = family.split(' ')
  let name = OPENER_NAMES[opener]?.(t) ?? opener
  if (rest.includes('expand')) {
    name = t('builds.family.expanded', '{{name}} expand', { name })
  }
  const followUps = rest.filter(part => part !== 'expand').map(part => FOLLOW_UP_NAMES[part]?.(t))
  return [name, ...followUps.filter(Boolean)].join(', ')
}

function getStepName(step: Pick<BuildStepSummary, 'key' | 'nth'>, t: TFunction) {
  const name = getBuildName(step.key, t)
  return step.nth > 1 ? `${name} ${step.nth}` : name
}

type WinLoss = Pick<BuildSide, 'wins' | 'losses'>

function rateOf(record: WinLoss | undefined) {
  const decided = record ? record.wins + record.losses : 0
  return record && decided ? { rate: record.wins / decided, decided } : undefined
}

/**
 * A win rate, faded when too few games decide it, with the record when hovered. Compared with
 * another, both from enough games, it's red when well under it and bold when well over.
 */
function WinRateCell({ record, compare }: { record: WinLoss | undefined; compare?: WinLoss }) {
  const { t } = useTranslation()
  const own = rateOf(record)
  if (!record || !own) {
    return (
      <Cell $end={true} $tone='muted'>
        -
      </Cell>
    )
  }
  const other = rateOf(compare)
  const diff =
    other && other.decided >= MIN_RATE_GAMES && own.decided >= MIN_RATE_GAMES
      ? own.rate - other.rate
      : 0
  let tone: 'muted' | 'bad' | undefined
  if (own.decided < MIN_RATE_GAMES) {
    tone = 'muted'
  } else if (diff <= -OFF_WIN_RATE) {
    tone = 'bad'
  }
  return (
    <Cell
      $end={true}
      $tone={tone}
      $strong={diff >= OFF_WIN_RATE}
      title={t('builds.record', '{{wins}} wins, {{losses}} losses', {
        wins: record.wins,
        losses: record.losses,
      })}>
      {formatPercent(own.rate)}
    </Cell>
  )
}

/** Who the other players are here. */
function getPoolNote(bucket: CoachBucket, eapmFloor: number, t: TFunction) {
  const notes = [
    t('builds.poolNote', '{{race}} players over {{floor}} EAPM in {{where}}.', {
      race: raceCharToLabel(bucket.race, t),
      where: getPoolPlace(bucket, t),
      floor: eapmFloor,
    }),
  ]
  if (bucket.allyRace && bucket.anyAlly) {
    notes.push(
      t(
        'builds.anyAllyNote',
        'Theirs are with any teammate, since too few had a {{ally}} one. Yours are all with a {{ally}} teammate.',
        { ally: raceCharToLabel(bucket.allyRace, t) },
      ),
    )
  }
  notes.push(t('builds.fadedNote', 'Faded: under {{minimum}} games.', { minimum: MIN_RATE_GAMES }))
  return notes.join(' ')
}

/** What a win rate of other players' means here: how much it follows the user's own games. */
function getWinRateHelp(bucket: CoachBucket, builds: ReadonlyArray<CoachBuild>, t: TFunction) {
  const games = builds.reduce((sum, b) => sum + b.others.games, 0)
  const withUser = builds.reduce((sum, b) => sum + b.others.withUser, 0)
  const notes = [
    t(
      'builds.winRateHelp',
      '{{share}} of these games were with or against you, so their win rates partly follow yours.',
      { share: formatPercent(games ? withUser / games : 0) },
    ),
  ]
  if (bucket.shape !== '1v1' && bucket.shape !== 'ffa') {
    notes.push(t('builds.teamNote', 'Teammates on the same build count their result once.'))
  }
  return notes.join(' ')
}

/** In 2v2, picks the pair of races the builds were played against. */
function AgainstPicker({
  bucket,
  against,
  onPick,
}: {
  bucket: CoachBucket
  against: string
  onPick: (against: string) => void
}) {
  const { t } = useTranslation()
  if (!bucket.buildsAgainst?.length) {
    return null
  }
  return (
    <Races $dense={true} role='group' aria-label={t('builds.against', 'Against')}>
      <RaceButton
        type='button'
        $dense={true}
        $on={!against}
        aria-pressed={!against}
        onClick={() => onPick('')}>
        <span>{t('builds.againstAny', 'Any team')}</span>
      </RaceButton>
      {bucket.buildsAgainst.map(({ opponents }) => {
        const [first, second] = [...opponents] as AssignedRaceChar[]
        return (
          <RaceButton
            key={opponents}
            type='button'
            $dense={true}
            $on={against === opponents}
            aria-pressed={against === opponents}
            aria-label={t('builds.againstPair', 'Against {{first}} and {{second}}', {
              first: raceCharToLabel(first, t),
              second: raceCharToLabel(second, t),
            })}
            onClick={() => onPick(opponents)}>
            {t('myStats.vs', 'vs')}
            <RaceTag race={first} />
            <RaceTag race={second} />
          </RaceButton>
        )
      })}
    </Races>
  )
}

/** Every build played here, the most played first, with the user's marked. Picks one to show. */
function BuildsTable({
  bucket,
  builds,
  userBuild,
  eapmFloor,
  selected,
  onSelect,
  picker,
}: {
  bucket: CoachBucket
  builds: ReadonlyArray<CoachBuild>
  userBuild: string | undefined
  eapmFloor: number
  selected: string
  onSelect: (family: string) => void
  picker: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <PaddedPanel>
      <PanelHead $spread={!!bucket.buildsAgainst?.length}>
        <PanelTitle>{t('builds.popular', 'Builds played here')}</PanelTitle>
        <PanelHeadNote>{t('builds.popularNote', 'Pick one to see how it goes.')}</PanelHeadNote>
        {picker}
      </PanelHead>
      <BuildsGrid $columns='minmax(0, 1fr) 96px 96px 96px 112px 112px'>
        <HeadCell>{t('builds.build', 'Build')}</HeadCell>
        <HeadCell $end={true}>{t('builds.players', 'Players')}</HeadCell>
        <HeadCell $end={true}>{t('builds.games', 'Games')}</HeadCell>
        <HeadCell $end={true}>
          <HelpLabel
            label={t('builds.winRate', 'Win rate')}
            help={getWinRateHelp(bucket, builds, t)}
          />
        </HeadCell>
        <HeadCell $end={true}>{t('builds.yourGames', 'Your games')}</HeadCell>
        <HeadCell $end={true}>{t('builds.yourWinRate', 'Your win rate')}</HeadCell>
        {builds.map(build => (
          <BuildRow
            key={build.family}
            type='button'
            $selected={build.family === selected}
            aria-pressed={build.family === selected}
            onClick={() => onSelect(build.family)}>
            <Cell>
              {getBuildFamilyName(build.family, t)}
              {build.family === userBuild ? (
                <YoursTag>{t('builds.yours', 'You play most')}</YoursTag>
              ) : null}
            </Cell>
            <Cell $end={true}>{build.players}</Cell>
            <Cell $end={true} $tone='muted'>
              {build.others.games}
            </Cell>
            <WinRateCell record={build.others} />
            <Cell $end={true} $tone='muted'>
              {build.user?.games ?? '-'}
            </Cell>
            <WinRateCell record={build.user} compare={build.others} />
          </BuildRow>
        ))}
      </BuildsGrid>
      <PanelNote>{getPoolNote(bucket, eapmFloor, t)}</PanelNote>
    </PaddedPanel>
  )
}

/** In 2v2, the builds teammates paired, and how those teams did. */
function TeamBuilds({ teams }: { teams: ReadonlyArray<CoachTeamBuild> }) {
  const { t } = useTranslation()
  const named = (family: string) => (
    <RacedName>
      <RaceTag race={family.split(' ')[0] as AssignedRaceChar} />
      {getBuildFamilyName(family, t)}
    </RacedName>
  )
  return (
    <PaddedPanel>
      <PanelHead>
        <PanelTitle>{t('builds.teamTitle', 'Team builds')}</PanelTitle>
        <PanelHeadNote>
          {t('builds.teamBuildsNote', 'What teammates opened together, each team counted once.')}
        </PanelHeadNote>
      </PanelHead>
      <Table $columns='minmax(0, 1fr) minmax(0, 1fr) 96px 96px 112px 112px'>
        <HeadCell>{t('builds.build', 'Build')}</HeadCell>
        <HeadCell>{t('builds.teammateBuild', 'Teammate')}</HeadCell>
        <HeadCell $end={true}>{t('builds.games', 'Games')}</HeadCell>
        <HeadCell $end={true}>{t('builds.winRate', 'Win rate')}</HeadCell>
        <HeadCell $end={true}>{t('builds.yourGames', 'Your games')}</HeadCell>
        <HeadCell $end={true}>{t('builds.yourWinRate', 'Your win rate')}</HeadCell>
        {teams.map(team => {
          const id = team.families.join('+')
          return [
            <Cell key={`${id}-mine`}>{named(team.families[0])}</Cell>,
            <Cell key={`${id}-theirs`}>{named(team.families[1])}</Cell>,
            <Cell key={`${id}-games`} $end={true} $tone='muted'>
              {team.games}
            </Cell>,
            <WinRateCell key={`${id}-rate`} record={team} />,
            <Cell key={`${id}-user`} $end={true} $tone='muted'>
              {team.userGames || '-'}
            </Cell>,
            <WinRateCell
              key={`${id}-user-rate`}
              record={team.userGames ? { wins: team.userWins, losses: team.userLosses } : undefined}
              compare={team}
            />,
          ]
        })}
      </Table>
    </PaddedPanel>
  )
}

/** A step's supply and time, like "21 · 4:13", or a dash for a side that doesn't usually take it. */
function formatStep(step: BuildStepSummary | undefined) {
  if (!step) {
    return '-'
  }
  const time = formatGameTime(step.timeMs)
  return step.supply !== undefined ? `${step.supply} · ${time}` : time
}

/** Whether the winners played enough games of a build to be what the user is compared with. */
function hasEnoughWinners(build: CoachBuild): build is CoachBuild & { winners: BuildSide } {
  return !!build.winners && build.winners.games >= MIN_RATE_GAMES
}

/** A build's steps as most players take them, next to the winners' and the user's. */
function BuildSteps({ build, race }: { build: CoachBuild; race: AssignedRaceChar }) {
  const { t } = useTranslation()
  const id = (step: BuildStepSummary) => `${step.key}#${step.nth}`
  const sides = [build.others, build.winners, build.user]
  const byId = sides.map(side => new Map(side?.steps.map(step => [id(step), step])))
  const basis = hasEnoughWinners(build) ? 1 : 0
  // Most players' order, then steps only winners or the user take, after the step before them.
  const steps: BuildStepSummary[] = [...build.others.steps]
  for (const side of sides.slice(1)) {
    side?.steps.forEach((step, i) => {
      if (steps.some(other => id(other) === id(step))) {
        return
      }
      const before = side.steps[i - 1]
      const at = before ? steps.findIndex(other => id(other) === id(before)) : -1
      steps.splice(at + 1, 0, step)
    })
  }
  const fewWinners = !!build.winners && !hasEnoughWinners(build)

  return (
    <PaddedPanel>
      <PanelHead>
        <PanelTitle>{getBuildFamilyName(build.family, t)}</PanelTitle>
        <PanelHeadNote>
          {t(
            'builds.stepsNote',
            'Supply and time of each step, by when most {{race}} players take it.',
            { race: raceCharToLabel(race, t) },
          )}
        </PanelHeadNote>
      </PanelHead>
      <Table $columns='minmax(0, 1fr) 140px 140px 140px'>
        <HeadCell>{t('builds.step', 'Step')}</HeadCell>
        <HeadCell $end={true}>{t('builds.mostPlayers', 'Most players')}</HeadCell>
        <HeadCell $end={true}>
          <HelpLabel
            label={t('builds.winners', 'Winners')}
            help={t(
              'builds.winnersHelp',
              'Players who won with this build and were still in at the end.',
            )}
          />
        </HeadCell>
        <HeadCell $end={true}>{t('builds.you', 'You')}</HeadCell>
        <Cell $tone='muted'>{t('builds.gamesRow', 'Games')}</Cell>
        {sides.map((side, i) => (
          <Cell key={i} $end={true} $tone='muted'>
            {side?.games ?? '-'}
          </Cell>
        ))}
        {steps.map(step => {
          const others = byId[0].get(id(step))
          const winners = byId[1].get(id(step))
          const user = byId[2].get(id(step))
          const compared = byId[basis].get(id(step))
          const diff = compared && user ? user.timeMs - compared.timeMs : 0
          const UserCell = diff >= OFF_STEP_MS ? LateCell : Cell
          let only: string | undefined
          if (!others && winners) {
            only = t('builds.winnersOnly', 'winners only')
          } else if (!others && !winners && user) {
            only = t('builds.youOnly', 'only you')
          }
          return [
            <Cell key={`${id(step)}-name`}>
              {getStepName(step, t)}
              {only ? <StepOnly>{only}</StepOnly> : null}
              {others && others.share < OPTIONAL_STEP_SHARE ? (
                <StepShare>
                  {t('builds.stepShare', 'in {{share}} of games', {
                    share: formatPercent(others.share),
                  })}
                </StepShare>
              ) : null}
            </Cell>,
            <Cell key={`${id(step)}-others`} $end={true}>
              {formatStep(others)}
            </Cell>,
            <Cell key={`${id(step)}-winners`} $end={true} $tone={fewWinners ? 'muted' : undefined}>
              {build.winners ? formatStep(winners) : '-'}
            </Cell>,
            <UserCell key={`${id(step)}-you`} $end={true} $strong={diff <= -OFF_STEP_MS}>
              {build.user ? formatStep(user) : '-'}
            </UserCell>,
          ]
        })}
      </Table>
      <PanelNote>
        {build.user
          ? t(
              'builds.stepsLegend',
              'Your steps in red come {{seconds}}s or more after {{basis}}, in bold that much before.',
              {
                seconds: OFF_STEP_MS / 1000,
                basis: basis
                  ? t('builds.basisWinners', 'the winners')
                  : t('builds.basisMost', 'most players'),
              },
            )
          : t('builds.notYours', "You haven't played this build in these games.")}{' '}
        {build.winners
          ? ''
          : t('builds.fewWinners', 'Too few won games to show how winners play it.')}
      </PanelNote>
    </PaddedPanel>
  )
}

function getWorkerStopText(stop: WorkerStopSummary | undefined, t: TFunction) {
  if (!stop) {
    return '-'
  }
  if (stop.stopped * 2 < stop.games) {
    return t('builds.workersKeepGoing', 'Past 10 min')
  }
  return t('builds.workersStop', '{{workers}} · {{time}}', {
    workers: stop.workers,
    time: formatGameTime(stop.atMs),
  })
}

/** Workers over the first 10 minutes, and when players stop making them. */
function Workers({ build, race }: { build: CoachBuild; race: AssignedRaceChar }) {
  const { t } = useTranslation()
  const rows: Array<[string, BuildSide | undefined]> = [
    [t('builds.mostPlayers', 'Most players'), build.others],
    [t('builds.winners', 'Winners'), build.winners],
    [t('builds.you', 'You'), build.user],
  ]
  return (
    <PaddedPanel>
      <PanelHead>
        <PanelTitle>{t('builds.workersTitle', 'Workers')}</PanelTitle>
        <PanelHeadNote>
          {t('builds.workersNote', 'How many by each minute, and when players stop making them.')}
        </PanelHeadNote>
      </PanelHead>
      <Table $columns={`minmax(0, 1fr) repeat(${WORKER_MINUTES.length}, 72px) 140px 140px`}>
        <HeadCell />
        {WORKER_MINUTES.map(minute => (
          <HeadCell key={minute} $end={true}>
            {t('builds.atMinute', '{{minute}} min', { minute })}
          </HeadCell>
        ))}
        <HeadCell $end={true}>
          <HelpLabel
            label={t('builds.workersStopHead', 'Stop at')}
            help={t(
              'builds.workersStopHelp',
              'Workers and time when a typical game stops making them: the first 1:30 or more without a new one after 3:00, other than out of supply.',
            )}
          />
        </HeadCell>
        <HeadCell $end={true}>
          <HelpLabel
            label={t('builds.workersGamesHead', 'Games that stop')}
            help={t(
              'builds.workersGamesHelp',
              'Of the games that stopped or went on past 10 minutes. Games over before either are left out.',
            )}
          />
        </HeadCell>
        {rows.map(([label, side], s) => {
          const muted = s === 1 && !hasEnoughWinners(build)
          return [
            <Cell key={`${label}-label`} $tone={muted ? 'muted' : undefined}>
              {label}
            </Cell>,
            ...WORKER_MINUTES.map((minute, i) => (
              <Cell key={`${label}-${minute}`} $end={true} $tone={muted ? 'muted' : undefined}>
                {side?.workersAt[i] ?? '-'}
              </Cell>
            )),
            <Cell
              key={`${label}-stop`}
              $end={true}
              $tone={muted ? 'muted' : undefined}
              $strong={s === 2}>
              {side ? getWorkerStopText(side.workerStop, t) : '-'}
            </Cell>,
            <Cell key={`${label}-games`} $end={true} $tone='muted'>
              {side?.workerStop
                ? t('builds.workersGames', '{{stopped}} of {{games}}', {
                    stopped: side.workerStop.stopped,
                    games: side.workerStop.games,
                  })
                : '-'}
            </Cell>,
          ]
        })}
      </Table>
      {race === 'z' ? (
        <PanelNote>
          {t(
            'builds.zergWorkersNote',
            'Zerg often pause drones to save larvae for an army, then drone again, so a stop here can be a pause.',
          )}
        </PanelNote>
      ) : null}
    </PaddedPanel>
  )
}

/** An average count of units, or a dash for a side with no games. */
function formatCount(count: number | undefined) {
  if (count === undefined) {
    return '-'
  }
  return count < 0.05 ? '0' : count.toFixed(1)
}

/** How a build's army comes together over the first 10 minutes: most players, winners, the user. */
function ArmyMix({ build }: { build: CoachBuild }) {
  const { t } = useTranslation()
  const sides: Array<[string, BuildSide | undefined]> = [
    [t('builds.mostShort', 'Most'), build.others],
    [t('builds.winners', 'Winners'), build.winners],
    [t('builds.you', 'You'), build.user],
  ]
  const units: number[] = []
  for (const [, side] of sides) {
    for (const entry of side?.armyMix ?? []) {
      if (!units.includes(entry.unitId)) {
        units.push(entry.unitId)
      }
    }
  }
  const countOf = (side: BuildSide | undefined, unitId: number, i: number) =>
    side ? (side.armyMix.find(e => e.unitId === unitId)?.counts[i] ?? 0) : undefined
  const minutes = ARMY_MIX_MINUTES

  return (
    <PaddedPanel>
      <PanelHead>
        <PanelTitle>{t('builds.armyTitle', 'Army, early game')}</PanelTitle>
        <PanelHeadNote>
          {t(
            'builds.armyNote',
            'Units one player started by each minute, on average, in games still going then.',
          )}
        </PanelHeadNote>
      </PanelHead>
      {units.length ? (
        <Table $columns={`minmax(0, 1fr) repeat(${minutes.length * sides.length}, 72px)`}>
          <GroupHead $first={true} />
          {minutes.map(minute => (
            <SpanHead key={minute} $first={true} style={{ gridColumn: `span ${sides.length}` }}>
              {t('builds.atMinute', '{{minute}} min', { minute })}
            </SpanHead>
          ))}
          <HeadCell>{t('builds.unit', 'Unit')}</HeadCell>
          {minutes.flatMap(minute =>
            sides.map(([label], s) => {
              const Head = s === 0 ? GroupStartHead : HeadCell
              return (
                <Head key={`${minute}-${label}`} $end={true}>
                  {label}
                </Head>
              )
            }),
          )}
          {units.map(unitId => [
            <Cell key={`${unitId}-name`}>{getBuildName(`u${unitId}`, t)}</Cell>,
            ...minutes.flatMap((_, i) =>
              sides.map(([label, side], s) => {
                const count = countOf(side, unitId, i)
                const Count = s === 0 ? GroupStartCell : Cell
                return (
                  <Count
                    key={`${unitId}-${label}-${i}`}
                    $end={true}
                    $tone={count === undefined || count < 0.05 ? 'muted' : undefined}
                    $strong={s === 2 && count !== undefined && count >= 0.05}>
                    {formatCount(count)}
                  </Count>
                )
              }),
            ),
          ])}
        </Table>
      ) : (
        <Text>{t('builds.noArmy', 'No army units in enough of these games yet.')}</Text>
      )}
    </PaddedPanel>
  )
}

/** The builds for the kind of game picked, with the one picked shown in detail. */
function BuildsBody({ coach }: { coach: Extract<CoachResult, { status: 'ready' }> }) {
  const { t } = useTranslation()
  const bucket = coach.buckets[0]
  const [picked, setPicked] = useState<string>()
  const [against, setAgainst] = useState('')
  const view = bucket?.buildsAgainst?.find(b => b.opponents === against) ?? bucket
  if (!bucket || !view?.builds.length) {
    return (
      <Message>
        <Text>
          {t(
            'builds.none',
            'Not enough games of other players here to tell their builds apart yet. Analyze more replays of this kind.',
          )}
        </Text>
      </Message>
    )
  }
  const selected =
    view.builds.find(b => b.family === picked) ??
    view.builds.find(b => b.family === view.userBuild) ??
    view.builds[0]

  return (
    <Panels>
      <SectionErrorBoundary>
        <BuildsTable
          bucket={bucket}
          builds={view.builds}
          userBuild={view.userBuild}
          eapmFloor={coach.eapmFloor}
          selected={selected.family}
          onSelect={setPicked}
          picker={<AgainstPicker bucket={bucket} against={against} onPick={setAgainst} />}
        />
      </SectionErrorBoundary>
      <SectionErrorBoundary>
        <BuildSteps build={selected} race={bucket.race} />
      </SectionErrorBoundary>
      <SectionErrorBoundary>
        <ArmyMix build={selected} />
      </SectionErrorBoundary>
      <SectionErrorBoundary>
        <Workers build={selected} race={bucket.race} />
      </SectionErrorBoundary>
      {bucket.teamBuilds?.length ? (
        <SectionErrorBoundary>
          <TeamBuilds teams={bucket.teamBuilds} />
        </SectionErrorBoundary>
      ) : null}
    </Panels>
  )
}

/** The builds players use in the user's kind of game, and how the user's compares. */
export function BuildsView({ coach }: { coach: CoachResult | 'error' | undefined }) {
  const { t } = useTranslation()
  const counts = useShapeCounts()

  let content: React.ReactNode
  if (coach === 'error') {
    content = (
      <Message>
        <Text>
          {t('builds.loadError', "Builds couldn't be worked out. Your replays are fine.")}
        </Text>
      </Message>
    )
  } else if (!coach) {
    content = <LoadingDotsArea />
  } else {
    content = (
      <>
        <CoachToolbar coach={coach} counts={counts} />
        {coach.status === 'ready' ? (
          <BuildsBody key={JSON.stringify(coach.scope)} coach={coach} />
        ) : (
          <Message>
            <Text>
              {t(
                'builds.noGames',
                'None of your analyzed games can be compared yet. Analyze a few more of yours.',
              )}
            </Text>
          </Message>
        )}
      </>
    )
  }

  return (
    <Root>
      <Header>
        <Title>{t('builds.title', 'Builds')}</Title>
        <Badge>{t('myStats.coach.experimental', 'Experimental')}</Badge>
      </Header>
      {content}
    </Root>
  )
}

/** The Builds page, which needs the user's names to tell which games are theirs. */
export function BuildsPage() {
  const state = useOwnGamesState()
  const { coach } = useCoach()
  const demo = useDemoPlayer()
  if (!demo && !state) {
    return <LoadingDotsArea />
  }
  if (!demo && state && state !== 'found') {
    return <OwnGamesNeeded state={state} />
  }
  return <BuildsView coach={coach} />
}
