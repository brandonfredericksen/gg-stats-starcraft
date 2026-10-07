import { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ARMY_MIX_MINUTES } from '../../common/games/player-metrics'
import {
  ArmyMixEntry,
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
import {
  formatPercent,
  PaddedPanel,
  PanelHead,
  PanelHeadNote,
  PanelNote,
  PanelTitle,
} from '../my-stats/my-stats-panels'
import { LoadingDotsArea } from '../progress/dots'
import { labelMedium } from '../styles/typography'
import { OwnGamesNeeded, useOwnGamesState } from '../system-bar/own-games-needed'

/** A step this much later or earlier than most players is pointed out. */
const OFF_STEP_MS = 20_000
/** A step fewer games than this share take is marked as one only some players add. */
const OPTIONAL_STEP_SHARE = 0.8
/** A win rate from fewer decided games than this is shown faded, since it's mostly chance. */
const MIN_RATE_GAMES = 10
/** Past this share of other players' games played with or against the user, the page says so. */
const WITH_USER_NOTE_SHARE = 0.5

/** A row of the builds table, which picks the build shown below it. */
const BuildRow = styled.button<{ $selected: boolean }>`
  ${buttonReset};
  display: contents;
  cursor: pointer;

  & > * {
    background-color: ${props => (props.$selected ? 'var(--theme-container-high)' : 'transparent')};
  }

  &:hover > * {
    background-color: var(--theme-container-high);
  }

  &:focus-visible > * {
    outline: 2px solid var(--theme-grey-blue);
    outline-offset: -2px;
  }
`

const YoursTag = styled.span`
  ${labelMedium};
  height: 20px;
  margin-left: var(--space-2);
  padding: 0 var(--space-2);

  display: inline-flex;
  align-items: center;

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
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
`

/** How often a step comes up, after its name, when only some players take it. */
const StepShare = styled.span`
  margin-left: var(--space-2);
  color: var(--theme-on-surface-variant);
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

/** A win rate, faded when too few games decide it, with the record when hovered. */
function WinRateCell({ record }: { record: Pick<BuildSide, 'wins' | 'losses'> | undefined }) {
  const { t } = useTranslation()
  const decided = record ? record.wins + record.losses : 0
  if (!record || !decided) {
    return (
      <Cell $end={true} $tone='muted'>
        -
      </Cell>
    )
  }
  return (
    <Cell
      $end={true}
      $tone={decided < MIN_RATE_GAMES ? 'muted' : undefined}
      title={t('builds.record', '{{wins}} wins, {{losses}} losses', {
        wins: record.wins,
        losses: record.losses,
      })}>
      {formatPercent(record.wins / decided)}
    </Cell>
  )
}

/** Who the other players are here, and how much their results follow the user's. */
function getPoolNote(
  bucket: CoachBucket,
  builds: ReadonlyArray<CoachBuild>,
  eapmFloor: number,
  t: TFunction,
) {
  const games = builds.reduce((sum, b) => sum + b.others.games, 0)
  const withUser = builds.reduce((sum, b) => sum + b.others.withUser, 0)
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
  if (games && withUser / games > WITH_USER_NOTE_SHARE) {
    notes.push(
      t(
        'builds.withUserNote',
        '{{share}} of their games were with or against you, so their win rates partly follow yours.',
        { share: formatPercent(withUser / games) },
      ),
    )
  }
  if (bucket.shape !== '1v1' && bucket.shape !== 'ffa') {
    notes.push(t('builds.teamNote', 'Teammates on the same build count their result once.'))
  }
  notes.push(
    t('builds.fadedNote', 'Faded win rates come from fewer than {{count}} games.', {
      count: MIN_RATE_GAMES,
    }),
  )
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
    <Races role='group' aria-label={t('builds.against', 'Against')}>
      <RaceButton type='button' $on={!against} aria-pressed={!against} onClick={() => onPick('')}>
        <span>{t('builds.againstAny', 'Any team')}</span>
      </RaceButton>
      {bucket.buildsAgainst.map(({ opponents }) => {
        const [first, second] = [...opponents] as AssignedRaceChar[]
        return (
          <RaceButton
            key={opponents}
            type='button'
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
      <Table $columns='minmax(0, 1fr) 96px 96px 96px 112px 112px'>
        <HeadCell>{t('builds.build', 'Build')}</HeadCell>
        <HeadCell $end={true}>{t('builds.players', 'Players')}</HeadCell>
        <HeadCell $end={true}>{t('builds.games', 'Games')}</HeadCell>
        <HeadCell $end={true}>{t('builds.winRate', 'Win rate')}</HeadCell>
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
            <WinRateCell record={build.user} />
          </BuildRow>
        ))}
      </Table>
      <PanelNote>{getPoolNote(bucket, builds, eapmFloor, t)}</PanelNote>
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

/** A build's steps as most players take them, next to the winners' and the user's. */
function BuildSteps({ build, race }: { build: CoachBuild; race: AssignedRaceChar }) {
  const { t } = useTranslation()
  const id = (step: BuildStepSummary) => `${step.key}#${step.nth}`
  const sides = [build.others, build.winners, build.user]
  const byId = sides.map(side => new Map(side?.steps.map(step => [id(step), step])))
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

  return (
    <PaddedPanel>
      <PanelHead>
        <PanelTitle>{getBuildFamilyName(build.family, t)}</PanelTitle>
        <PanelHeadNote>
          {t(
            'builds.stepsNote',
            'Supply and time of each step, in the order {{race}} players usually take them.',
            { race: raceCharToLabel(race, t) },
          )}
        </PanelHeadNote>
      </PanelHead>
      <Table $columns='minmax(0, 1fr) 140px 140px 140px'>
        <HeadCell>{t('builds.step', 'Step')}</HeadCell>
        <HeadCell $end={true}>{t('builds.mostPlayers', 'Most players')}</HeadCell>
        <HeadCell $end={true}>{t('builds.winners', 'Winners')}</HeadCell>
        <HeadCell $end={true}>{t('builds.you', 'You')}</HeadCell>
        <Cell $tone='muted'>{t('builds.gamesRow', 'Games')}</Cell>
        {sides.map((side, i) => (
          <Cell key={i} $end={true} $tone='muted'>
            {side?.games ?? '-'}
          </Cell>
        ))}
        {steps.map(step => {
          const others = byId[0].get(id(step))
          const user = byId[2].get(id(step))
          const diff = others && user ? user.timeMs - others.timeMs : 0
          return [
            <Cell key={`${id(step)}-name`}>
              {getStepName(step, t)}
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
            <Cell key={`${id(step)}-winners`} $end={true} $tone='muted'>
              {build.winners ? formatStep(byId[1].get(id(step))) : '-'}
            </Cell>,
            <Cell
              key={`${id(step)}-you`}
              $end={true}
              $tone={diff >= OFF_STEP_MS ? 'bad' : undefined}
              $strong={diff <= -OFF_STEP_MS}>
              {build.user ? formatStep(user) : '-'}
            </Cell>,
          ]
        })}
      </Table>
      <PanelNote>
        {build.user
          ? t(
              'builds.stepsLegend',
              'Your steps in red come {{seconds}} seconds or more after most players, in bold that much before.',
              { seconds: OFF_STEP_MS / 1000 },
            )
          : t('builds.notYours', "You haven't played this build in these games.")}{' '}
        {build.winners
          ? t(
              'builds.winnersNote',
              "Winners leave out players their team carried after they'd gone out.",
            )
          : t('builds.fewWinners', 'Too few won games to show how winners play it.')}
      </PanelNote>
    </PaddedPanel>
  )
}

function getWorkerStopText(stop: WorkerStopSummary | undefined, t: TFunction) {
  if (!stop) {
    return t('builds.workersNoData', 'Not enough games to tell.')
  }
  if (stop.stopped * 2 < stop.games) {
    return t('builds.workersKeepGoing', 'Keep going past 10 minutes in most games.')
  }
  return t('builds.workersStop', 'Stop at {{workers}}, around {{time}}.', {
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
          {t(
            'builds.workersNote',
            'How many in a typical game, and when players stop making them: the first 1:30 or more without a new one after 3:00, other than out of supply.',
          )}
        </PanelHeadNote>
      </PanelHead>
      <Table $columns={`160px repeat(${WORKER_MINUTES.length}, 72px) minmax(0, 1fr) max-content`}>
        <HeadCell />
        {WORKER_MINUTES.map(minute => (
          <HeadCell key={minute} $end={true}>
            {t('builds.atMinute', '{{minute}} min', { minute })}
          </HeadCell>
        ))}
        <HeadCell>{t('builds.workersStopHead', 'Stop making them')}</HeadCell>
        <HeadCell />
        {rows.map(([label, side], s) => [
          <Cell key={`${label}-label`}>{label}</Cell>,
          ...WORKER_MINUTES.map((minute, i) => (
            <Cell key={`${label}-${minute}`} $end={true} $tone={s === 1 ? 'muted' : undefined}>
              {side?.workersAt[i] ?? '-'}
            </Cell>
          )),
          <Cell key={`${label}-stop`}>{side ? getWorkerStopText(side.workerStop, t) : '-'}</Cell>,
          <Cell key={`${label}-games`} $end={true} $tone='muted'>
            {side?.workerStop
              ? t('builds.workersGames', '{{stopped}} of {{games}} games stop', {
                  stopped: side.workerStop.stopped,
                  games: side.workerStop.games,
                })
              : ''}
          </Cell>,
        ])}
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

/** How a build's army comes together over the first 10 minutes: most players, winners, the user. */
function ArmyMix({ build }: { build: CoachBuild }) {
  const { t } = useTranslation()
  const sides: Array<[string, BuildSide | undefined]> = [
    [t('builds.mostPlayers', 'Most players'), build.others],
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
  const countOf = (side: BuildSide | undefined, unitId: number, i: number) => {
    const entry: ArmyMixEntry | undefined = side?.armyMix.find(e => e.unitId === unitId)
    if (!side) {
      return '-'
    }
    const count = entry?.counts[i] ?? 0
    return count < 0.05 ? '0' : count.toFixed(1)
  }
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
        <Table $columns={`minmax(0, 1fr) repeat(${minutes.length * sides.length}, 60px)`}>
          <GroupHead $first={true} />
          {sides.map(([label]) => (
            <GroupHead
              key={label}
              $first={true}
              $end={true}
              style={{ gridColumn: `span ${minutes.length}` }}>
              {label}
            </GroupHead>
          ))}
          <HeadCell>{t('builds.unit', 'Unit')}</HeadCell>
          {sides.flatMap(([label]) =>
            minutes.map(minute => (
              <HeadCell key={`${label}-${minute}`} $end={true}>
                {t('builds.atMinute', '{{minute}} min', { minute })}
              </HeadCell>
            )),
          )}
          {units.map(unitId => [
            <Cell key={`${unitId}-name`}>{getBuildName(`u${unitId}`, t)}</Cell>,
            ...sides.flatMap(([label, side], s) =>
              minutes.map((_, i) => (
                <Cell
                  key={`${unitId}-${label}-${i}`}
                  $end={true}
                  $tone={s === 1 ? 'muted' : undefined}>
                  {countOf(side, unitId, i)}
                </Cell>
              )),
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
  if (!state) {
    return <LoadingDotsArea />
  }
  if (state !== 'found') {
    return <OwnGamesNeeded state={state} />
  }
  return <BuildsView coach={coach} />
}
