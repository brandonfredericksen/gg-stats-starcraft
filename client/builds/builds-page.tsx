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
import {
  formatPercent,
  PaddedPanel,
  PanelHead,
  PanelHeadNote,
  PanelTitle,
} from '../my-stats/my-stats-panels'
import { LoadingDotsArea } from '../progress/dots'
import { labelMedium } from '../styles/typography'
import { OwnGamesNeeded, useOwnGamesState } from '../system-bar/own-games-needed'

/** A step this much later than most players is pointed out. */
const LATE_STEP_MS = 20_000
/** Supply Depots and Pylons. */
const SUPPLY_BUILDING_KEYS: ReadonlySet<string> = new Set(['u109', 'u156'])
/**
 * Supply buildings after this many follow the supply, not the build, so they're left out of the
 * steps rather than filling the list.
 */
const SHOWN_SUPPLY_BUILDINGS = 2

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

/**
 * A build's name from its opening family: what it's built around, and whether it expands first.
 * See `openingFamily`.
 */
export function getBuildFamilyName(family: string, t: TFunction) {
  const [base, core = ''] = family.split(/:(.*)/s)
  const [kind, detail] = core.split(':')
  let name: string
  if (kind === 'forge') {
    name = t('builds.family.forge', 'Forge first')
  } else if (kind.startsWith('gates')) {
    name = t('builds.family.gates', '{{count}} Gate', { count: Number(kind.slice(5)) })
  } else if (kind === 'hatch') {
    name = t('builds.family.hatch', 'Hatchery first')
  } else if (kind === 'earlyPool') {
    name = t('builds.family.earlyPool', 'Early pool')
  } else if (kind === 'pool') {
    name = t('builds.family.pool', 'Pool first')
  } else if (kind === 'rax' && detail) {
    name = t('builds.family.rax', 'Barracks, then {{next}}', { next: getBuildName(detail, t) })
  } else if (kind === 'tech' && detail) {
    name = t('builds.family.tech', '{{tech}} first', { tech: getBuildName(detail, t) })
  } else {
    name = t('builds.family.noTech', 'No early tech')
  }
  return base === 'expand' ? t('builds.family.expand', '{{name}}, fast expand', { name }) : name
}

function getStepName(step: Pick<BuildStepSummary, 'key' | 'nth'>, t: TFunction) {
  const name = getBuildName(step.key, t)
  return step.nth > 1 ? `${name} ${step.nth}` : name
}

function getWinRate(side: BuildSide | undefined) {
  if (!side) {
    return undefined
  }
  const decided = side.wins + side.losses
  return decided ? side.wins / decided : undefined
}

/** Every build played here, the most played first, with the user's marked. Picks one to show. */
function BuildsTable({
  bucket,
  eapmFloor,
  selected,
  onSelect,
}: {
  bucket: CoachBucket
  eapmFloor: number
  selected: string
  onSelect: (family: string) => void
}) {
  const { t } = useTranslation()
  const race = raceCharToLabel(bucket.race, t)
  return (
    <PaddedPanel>
      <PanelHead>
        <PanelTitle>{t('builds.popular', 'Builds played here')}</PanelTitle>
        <PanelHeadNote>
          {t(
            'builds.popularNote',
            '{{race}} in {{where}}, players over {{floor}} EAPM. Pick one to see how it goes.',
            { race, where: getPoolPlace(bucket, t), floor: eapmFloor },
          )}
        </PanelHeadNote>
      </PanelHead>
      <Table $columns='minmax(0, 1fr) 96px 96px 96px 112px 112px'>
        <HeadCell>{t('builds.build', 'Build')}</HeadCell>
        <HeadCell $end={true}>{t('builds.players', 'Players')}</HeadCell>
        <HeadCell $end={true}>{t('builds.games', 'Games')}</HeadCell>
        <HeadCell $end={true}>{t('builds.winRate', 'Win rate')}</HeadCell>
        <HeadCell $end={true}>{t('builds.yourGames', 'Your games')}</HeadCell>
        <HeadCell $end={true}>{t('builds.yourWinRate', 'Your win rate')}</HeadCell>
        {bucket.builds.map(build => {
          const winRate = getWinRate(build.others)
          const userWinRate = getWinRate(build.user)
          return (
            <BuildRow
              key={build.family}
              type='button'
              $selected={build.family === selected}
              aria-pressed={build.family === selected}
              onClick={() => onSelect(build.family)}>
              <Cell>
                {getBuildFamilyName(build.family, t)}
                {build.family === bucket.userBuild ? (
                  <YoursTag>{t('builds.yours', 'Yours')}</YoursTag>
                ) : null}
              </Cell>
              <Cell $end={true}>{build.players}</Cell>
              <Cell $end={true} $tone='muted'>
                {build.others.games}
              </Cell>
              <Cell $end={true}>{winRate !== undefined ? formatPercent(winRate) : '-'}</Cell>
              <Cell $end={true} $tone='muted'>
                {build.user?.games ?? '-'}
              </Cell>
              <Cell $end={true}>
                {userWinRate !== undefined ? formatPercent(userWinRate) : '-'}
              </Cell>
            </BuildRow>
          )
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
  // Most players' order first, then steps only winners or the user take, each by its time.
  const order: BuildStepSummary[] = []
  for (const side of sides) {
    for (const step of side?.steps ?? []) {
      if (!order.some(other => id(other) === id(step))) {
        order.push(step)
      }
    }
  }
  const steps = order.filter(
    step => !SUPPLY_BUILDING_KEYS.has(step.key) || step.nth <= SHOWN_SUPPLY_BUILDINGS,
  )
  steps.sort(
    (a, b) => (byId[0].get(id(a))?.timeMs ?? a.timeMs) - (byId[0].get(id(b))?.timeMs ?? b.timeMs),
  )

  return (
    <PaddedPanel>
      <PanelHead>
        <PanelTitle>{getBuildFamilyName(build.family, t)}</PanelTitle>
        <PanelHeadNote>
          {t(
            'builds.stepsNote',
            'Supply and time of each step most games of it take, for most {{race}} players, the ones who won, and you.',
            { race: raceCharToLabel(race, t) },
          )}
        </PanelHeadNote>
      </PanelHead>
      <Table $columns='minmax(0, 1fr) 140px 140px 140px'>
        <HeadCell>{t('builds.step', 'Step')}</HeadCell>
        <HeadCell $end={true}>{t('builds.mostPlayers', 'Most players')}</HeadCell>
        <HeadCell $end={true}>{t('builds.winners', 'Winners')}</HeadCell>
        <HeadCell $end={true}>{t('builds.you', 'You')}</HeadCell>
        {steps.map(step => {
          const others = byId[0].get(id(step))
          const user = byId[2].get(id(step))
          const late = others && user && user.timeMs - others.timeMs >= LATE_STEP_MS
          return [
            <Cell key={`${id(step)}-name`}>{getStepName(step, t)}</Cell>,
            <Cell key={`${id(step)}-others`} $end={true}>
              {formatStep(others)}
            </Cell>,
            <Cell key={`${id(step)}-winners`} $end={true} $tone='muted'>
              {formatStep(byId[1].get(id(step)))}
            </Cell>,
            <Cell key={`${id(step)}-you`} $end={true} $tone={late ? 'bad' : undefined}>
              {build.user ? formatStep(user) : '-'}
            </Cell>,
          ]
        })}
      </Table>
      {build.user ? null : (
        <Text>{t('builds.notYours', "You haven't played this build in these games.")}</Text>
      )}
    </PaddedPanel>
  )
}

function getWorkerStopText(stop: WorkerStopSummary | undefined, t: TFunction) {
  if (!stop) {
    return t('builds.workersNoData', 'Not enough games to tell.')
  }
  if (stop.stopped * 2 < stop.games) {
    return t('builds.workersKeepGoing', 'Keep making workers past 12 minutes in most games.')
  }
  return t('builds.workersStop', 'Stop at {{workers}} workers, around {{time}}.', {
    workers: stop.workers,
    time: formatGameTime(stop.atMs),
  })
}

/** When players of a build stop making workers: most players, the winners, and the user. */
function WorkerStops({ build }: { build: CoachBuild }) {
  const { t } = useTranslation()
  const rows: Array<[string, BuildSide | undefined]> = [
    [t('builds.mostPlayers', 'Most players'), build.others],
    [t('builds.winners', 'Winners'), build.winners],
    [t('builds.you', 'You'), build.user],
  ]
  return (
    <PaddedPanel>
      <PanelHead>
        <PanelTitle>{t('builds.workersTitle', 'When to stop making workers')}</PanelTitle>
        <PanelHeadNote>
          {t(
            'builds.workersNote',
            'The first minute or more without a new worker, after the first 3 minutes.',
          )}
        </PanelHeadNote>
      </PanelHead>
      <Table $columns='160px minmax(0, 1fr) auto'>
        {rows.map(([label, side]) => [
          <Cell key={`${label}-label`}>{label}</Cell>,
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
    </PaddedPanel>
  )
}

/** How a build's army comes together by 5, 7 and 10 minutes: most players, winners, the user. */
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
          {t('builds.armyNote', 'Units started by {{minutes}} minutes, on average a game.', {
            minutes: minutes.join(', '),
          })}
        </PanelHeadNote>
      </PanelHead>
      {units.length ? (
        <Table $columns={`minmax(0, 1fr) repeat(${minutes.length * sides.length}, 64px)`}>
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
  if (!bucket?.builds.length) {
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
    bucket.builds.find(b => b.family === picked) ??
    bucket.builds.find(b => b.family === bucket.userBuild) ??
    bucket.builds[0]

  return (
    <Panels>
      <SectionErrorBoundary>
        <BuildsTable
          bucket={bucket}
          eapmFloor={coach.eapmFloor}
          selected={selected.family}
          onSelect={setPicked}
        />
      </SectionErrorBoundary>
      <SectionErrorBoundary>
        <BuildSteps build={selected} race={bucket.race} />
      </SectionErrorBoundary>
      <SectionErrorBoundary>
        <ArmyMix build={selected} />
      </SectionErrorBoundary>
      <SectionErrorBoundary>
        <WorkerStops build={selected} />
      </SectionErrorBoundary>
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
