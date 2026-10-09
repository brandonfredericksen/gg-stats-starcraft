import { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ARMY_MIX_MINUTES } from '../../common/games/player-metrics'
import { getUnitSupply, getUnitTypeInfo } from '../../common/games/unit-types'
import {
  BuildSide,
  BuildStepSummary,
  CoachBuild,
  CoachTeamBuild,
  isArmyMixUnit,
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
import { GameIcon } from '../games/game-icon'
import { SectionErrorBoundary } from '../games/game-stats-shared'
import { TextButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { RaceTag } from '../material/race-tag'
import { Segmented, SegmentOption } from '../material/segmented'
import { Tooltip } from '../material/tooltip'
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
import { useAppDispatch } from '../redux-hooks'
import { openSettings } from '../settings/action-creators'
import { AppSettingsPage } from '../settings/settings-page'
import { bodyMedium, labelMedium, labelSmall } from '../styles/typography'
import { OwnGamesNeeded, useOwnGamesState } from '../system-bar/own-games-needed'

/** A step this much later or earlier than the players it's compared with is pointed out. */
const OFF_STEP_MS = 20_000
/** A step fewer games than this share take is marked as one only some players add. */
const OPTIONAL_STEP_SHARE = 0.8
/**
 * A win rate from fewer games than this, as the Games column counts them, is shown faded, since
 * it's mostly chance. Winners need this many games to be what the user's steps are compared with.
 */
const MIN_RATE_GAMES = 10
/** A win rate this far from other players', both from enough games, is pointed out. */
const OFF_WIN_RATE = 0.15
/** An army count is pointed out when it differs by at least this many units and by this ratio. */
const ARMY_DIFF_MIN = 0.5
const ARMY_DIFF_RATIO = 1.3

/** The builds table, its highlight reaching a little past the text on each side. */
const BuildsGrid = styled(Table)`
  margin-inline: calc(-1 * var(--space-3));

  & > :first-child,
  & > button > :first-child {
    padding-left: var(--space-3);
  }

  & > :nth-child(5),
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

/** How many players a build's games are from, after the games. */
const PlayersCount = styled.span`
  margin-left: var(--space-2);
  color: var(--theme-on-surface-variant);
`

/** A name with the game's icon for it in front, when the icons have been saved. */
const IconName = styled.span`
  margin-block: -6px;
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

/** A count of units the user has clearly more of than the side they're compared with. */
const MoreCell = styled(Cell)`
  color: var(--theme-positive);
  font-weight: 600;
`

/** A count of units the user has clearly fewer of than the side they're compared with. */
const FewerCell = styled(Cell)`
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
  bio: t => t('builds.family.bio', 'bio'),
  mech: t => t('builds.family.mech', '3rd Factory'),
  muta2: t => t('builds.family.muta2', '2 hatch muta'),
  muta3: t => t('builds.family.muta3', '3 hatch muta'),
  lurker: t => t('builds.family.lurker', 'Lurker'),
  hydra: t => t('builds.family.hydra', 'Hydra'),
  speed: t => t('builds.family.speed', 'speed'),
}

/**
 * A build's name from its family, like "1 Gate expand, Robo" or "Hatch first, 3 hatch muta". See
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

/** A record, with the games it's from as the Games column next to it counts them. */
type WinLoss = Pick<BuildSide, 'games' | 'wins' | 'losses'>

function rateOf(record: WinLoss | undefined) {
  const decided = record ? record.wins + record.losses : 0
  return record && decided ? { rate: record.wins / decided, games: record.games } : undefined
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
    other && other.games >= MIN_RATE_GAMES && own.games >= MIN_RATE_GAMES
      ? own.rate - other.rate
      : 0
  let tone: 'muted' | 'bad' | undefined
  if (own.games < MIN_RATE_GAMES) {
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
  if (bucket.rank) {
    notes.push(
      t('myStats.rankOnly', 'Only players who were rank {{rank}} going into the game count.', {
        rank: bucket.rank.toUpperCase(),
      }),
    )
  }
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

/** The pairs of opponents' races that have builds to show, for the picker. */
function getPickablePairs(bucket: CoachBucket) {
  return bucket.buildsAgainst?.filter(b => b.builds.length) ?? []
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
  const pairs = getPickablePairs(bucket)
  if (!pairs.length) {
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
      {pairs.map(({ opponents }) => {
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
      <PanelHead $spread={getPickablePairs(bucket).length > 0}>
        <PanelTitle>{t('builds.popular', 'Builds played here')}</PanelTitle>
        <PanelHeadNote>{t('builds.popularNote', 'Pick one to see how it goes.')}</PanelHeadNote>
        {picker}
      </PanelHead>
      <BuildsGrid $columns='minmax(0, 1fr) 168px 96px 112px 112px'>
        <HeadCell>{t('builds.build', 'Build')}</HeadCell>
        <HeadCell $end={true}>
          <HelpLabel
            label={t('builds.played', 'Played')}
            help={t(
              'builds.playedHelp',
              'How many games had this build, counting each player in a game, and how many different players those were. One player can play it many times.',
            )}
          />
        </HeadCell>
        <HeadCell $end={true}>
          <HelpLabel
            label={t('builds.winRate', 'Win rate')}
            help={getWinRateHelp(bucket, builds, t)}
          />
        </HeadCell>
        <HeadCell $end={true}>
          <HelpLabel
            label={t('builds.yourGames', 'Your games')}
            help={t('builds.yourGamesHelp', 'How many of your own games used this build.')}
          />
        </HeadCell>
        <HeadCell $end={true}>
          <HelpLabel
            label={t('builds.yourWinRate', 'Your win rate')}
            help={t('builds.yourWinRateHelp', 'How often you won when you played this build.')}
          />
        </HeadCell>
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
            <Cell $end={true}>
              {t('builds.gamesCount', {
                defaultValue: '{{count}} games',
                defaultValue_one: '{{count}} game',
                count: build.others.games,
              })}
              <PlayersCount>
                {t('builds.playersCount', {
                  defaultValue: '{{count}} players',
                  defaultValue_one: '{{count}} player',
                  count: build.players,
                })}
              </PlayersCount>
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

/**
 * In 2v2, the builds teammates paired, and how those teams did, against every pair of opponents'
 * races whichever is picked for the builds above.
 */
function TeamBuilds({
  teams,
  anyOpponents,
}: {
  teams: ReadonlyArray<CoachTeamBuild>
  /** Whether a pair of opponents' races can be picked above, which this doesn't follow. */
  anyOpponents: boolean
}) {
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
          {t(
            'builds.teamBuildsOthersNote',
            "What other players' teams opened together, each team counted once, next to yours.",
          )}
          {anyOpponents
            ? ` ${t('builds.teamBuildsAnyNote', 'Against any team, whichever is picked above.')}`
            : null}
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
              record={
                team.userGames
                  ? { games: team.userGames, wins: team.userWins, losses: team.userLosses }
                  : undefined
              }
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

const stepId = (step: Pick<BuildStepSummary, 'key' | 'nth'>) => `${step.key}#${step.nth}`

/**
 * A build's steps in most players' order, with steps only the winners or the user take after the
 * step before them, and each side's own take on every step.
 */
function getBuildSteps(
  build: CoachBuild,
  stepsOf: (side: BuildSide) => BuildStepSummary[] = side => side.steps,
) {
  const sides = [build.others, build.winners, build.user]
  const lists = sides.map(side => (side ? stepsOf(side) : []))
  const byId = lists.map(list => new Map(list.map(step => [stepId(step), step])))
  const steps: BuildStepSummary[] = [...lists[0]]
  for (const list of lists.slice(1)) {
    list.forEach((step, i) => {
      if (steps.some(other => stepId(other) === stepId(step))) {
        return
      }
      const before = list[i - 1]
      const at = before ? steps.findIndex(other => stepId(other) === stepId(before)) : -1
      steps.splice(at + 1, 0, step)
    })
  }
  return { steps, sides, byId }
}

/** A build's steps as most players take them, next to the winners' and the user's. */
function BuildSteps({ build, race }: { build: CoachBuild; race: AssignedRaceChar }) {
  const { t } = useTranslation()
  const id = stepId
  const { steps, sides, byId } = getBuildSteps(build)
  const basis = hasEnoughWinners(build) ? 1 : 0
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
              'Players who won with this build and were still in at the end. Empty until at least 5 such games have been analyzed.',
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
              <IconName>
                <GameIcon buildKey={step.key} size={32} />
                {getStepName(step, t)}
              </IconName>
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

/** Each side's color in the timings chart. Most players are a band, the others a marker shape. */
const SIDE_COLORS = ['var(--theme-data-1)', 'var(--theme-best)', 'var(--theme-tab-builds)']

type MarkShape = 'diamond' | 'square'

/** Each side's marker in the timings chart. Most players are drawn as a band instead. */
const SIDE_SHAPES: Array<MarkShape | undefined> = [undefined, 'diamond', 'square']

const ROW_HEIGHT = 32
/** The stretches of a game the timings chart can zoom to, each from and to a time. */
const TIME_WINDOWS: ReadonlyArray<readonly [fromMs: number, toMs: number]> = [
  [0, 3 * 60_000],
  [3 * 60_000, 6 * 60_000],
  [6 * 60_000, 9 * 60_000],
  [9 * 60_000, 12 * 60_000],
  [12 * 60_000, 15 * 60_000],
]
/** Shown with everything else, every worker this many apart, like the 10th, 15th and 20th. */
const KEY_WORKER_EVERY = 5
/** Shown with everything else, the first this many of an army unit, then every other one. */
const KEY_UNITS_FIRST = 4
/** Zerglings and Scourge, which come in pairs, so only every other one is a new time. */
const PAIRED_UNIT_KEYS: ReadonlySet<string> = new Set(['u37', 'u47'])
/** Overlords are supply, so they sit with the buildings rather than the army. */
const OVERLORD_ID = 42
/** With more rows than this, the times run along the bottom of the chart as well as the top. */
const BOTTOM_AXIS_ROWS = 15

type TimingsFilter = 'all' | 'build' | 'workers' | 'army'
type StepKind = Exclude<TimingsFilter, 'all'>

/** Whether a step is a building, tech, upgrade or Overlord, a worker, or an army unit. */
function getStepKind(key: string, t: TFunction): StepKind {
  const [, id] = /^u(\d+)$/.exec(key) ?? []
  const unit = id !== undefined ? getUnitTypeInfo(Number(id), t) : undefined
  if (!unit || unit.isBuilding || Number(id) === OVERLORD_ID) {
    return 'build'
  }
  return unit.isWorker ? 'workers' : 'army'
}

/**
 * Whether a step is worth a row with everything else shown: every building, tech and upgrade,
 * workers at round counts, and the first few of each army unit, then every other one, the way a
 * build is talked about.
 */
function isKeyStep(step: BuildStepSummary, t: TFunction) {
  const kind = getStepKind(step.key, t)
  if (kind === 'workers') {
    return step.nth % KEY_WORKER_EVERY === 0
  }
  if (kind === 'army') {
    return PAIRED_UNIT_KEYS.has(step.key)
      ? step.nth % 2 === 0
      : step.nth <= KEY_UNITS_FIRST || step.nth % 2 === 0
  }
  return true
}

/**
 * A side's steps and units together, in order of time. The first of an army unit is in both, and
 * kept once, from the units.
 */
function stepsAndUnits(side: BuildSide) {
  const units = new Set(side.unitSteps.map(stepId))
  return [...side.steps.filter(step => !units.has(stepId(step))), ...side.unitSteps].sort(
    (a, b) => a.timeMs - b.timeMs,
  )
}

const TimingsLegend = styled.div`
  ${labelMedium};
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  color: var(--theme-on-surface-variant);
`

const LegendItem = styled.span<{ $muted?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  opacity: ${props => (props.$muted ? 0.5 : 1)};
`

const Mark = styled.span<{ $color: string; $shape: MarkShape }>`
  width: 10px;
  height: 10px;
  flex: none;
  background: ${props => props.$color};
  border-radius: 2px;
  transform: ${props => (props.$shape === 'diamond' ? 'rotate(45deg) scale(0.9)' : 'none')};
`

/** The band most players' middle half of games make, with a line where most take a step. */
const BandSwatch = styled.span`
  position: relative;
  width: 22px;
  height: 10px;
  flex: none;
  border-radius: 4px;
  background: color-mix(in srgb, var(--theme-data-1) 32%, transparent);

  &::after {
    content: '';
    position: absolute;
    left: 50%;
    top: -2px;
    bottom: -2px;
    width: 2px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--theme-data-1);
  }
`

const TimingsGrid = styled.div`
  ${bodyMedium};
  display: grid;
  grid-template-columns: minmax(120px, 216px) minmax(0, 1fr);
`

/** A step's name and track, which highlight together when either is hovered. */
const TimingsRow = styled.div`
  display: contents;

  & > :first-child {
    border-radius: 4px 0 0 4px;
  }

  & > :last-child {
    border-radius: 0 4px 4px 0;
  }

  &:hover > * {
    background: var(--theme-container-high);
  }
`

const TimingsName = styled.span<{ $kind: StepKind }>`
  height: ${ROW_HEIGHT}px;
  padding-inline: var(--space-2) var(--space-4);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  overflow: hidden;
  white-space: nowrap;
  color: ${props =>
    props.$kind === 'workers' ? 'var(--theme-on-surface-variant)' : 'var(--theme-on-surface)'};
`

const TrackTooltip = styled(Tooltip)`
  display: block;
`

const Track = styled.div`
  position: relative;
  height: ${ROW_HEIGHT}px;
`

/** A minute's gridline down a row's track. */
const GridLine = styled.span`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--theme-outline-variant);
  opacity: 0.6;
`

const Band = styled.span`
  position: absolute;
  top: 50%;
  height: 10px;
  min-width: 4px;
  margin-top: -5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--theme-data-1) 32%, transparent);
`

const Median = styled.span`
  position: absolute;
  top: 50%;
  height: 14px;
  width: 2px;
  margin: -7px 0 0 -1px;
  border-radius: 1px;
  background: var(--theme-data-1);
`

const PlacedMark = styled(Mark)<{ $muted?: boolean }>`
  position: absolute;
  top: 50%;
  margin: -5px 0 0 -5px;
  box-shadow: 0 0 0 2px var(--theme-container-low);
  opacity: ${props => (props.$muted ? 0.5 : 1)};
`

const AxisLabels = styled.div`
  ${labelMedium};
  position: relative;
  height: 20px;
  margin-block: var(--space-1);
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const AxisLabel = styled.span`
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  white-space: nowrap;
`

const TipLine = styled.span`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-variant-numeric: tabular-nums;
`

/** A side's time for a step in the tooltip, with the middle half of games for most players. */
function getTipTime(step: BuildStepSummary | undefined, s: number, t: TFunction) {
  if (!step) {
    return '-'
  }
  if (s !== 0) {
    return formatStep(step)
  }
  return t('builds.timingsRange', '{{time}}, half of games {{early}} to {{late}}', {
    time: formatStep(step),
    early: formatGameTime(step.earlyMs),
    late: formatGameTime(step.lateMs),
  })
}

/**
 * Every step of a build on a game clock, with workers and army units one by one: when the middle
 * half of most players' games take it, and when the winners and the user typically do.
 */
function BuildTimings({ build }: { build: CoachBuild }) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<TimingsFilter>('all')
  const [windowFrom, setWindowFrom] = useState<number>()
  const { steps: all, sides, byId } = getBuildSteps(build, stepsAndUnits)
  const timeOf = (step: BuildStepSummary) =>
    byId[0].get(stepId(step))?.timeMs ??
    Math.min(...byId.flatMap(side => side.get(stepId(step))?.timeMs ?? []))
  // By when most players take each, or when the first side that does if most don't.
  const kindSteps = all
    .filter(step => (filter === 'all' ? isKeyStep(step, t) : getStepKind(step.key, t) === filter))
    .sort((a, b) => timeOf(a) - timeOf(b))
  const windows = TIME_WINDOWS.filter(([from, to]) =>
    kindSteps.some(step => timeOf(step) >= from && timeOf(step) < to),
  )
  const picked = windows.find(([from]) => from === windowFrom)
  const steps = picked
    ? kindSteps.filter(step => timeOf(step) >= picked[0] && timeOf(step) < picked[1])
    : kindSteps
  const fewWinners = !!build.winners && !hasEnoughWinners(build)
  const labels = [
    t('builds.mostPlayers', 'Most players'),
    t('builds.winners', 'Winners'),
    t('builds.you', 'You'),
  ]

  const latest = Math.max(
    (picked?.[1] ?? 0) || 60_000,
    ...steps.flatMap(step =>
      byId.map(side => {
        const taken = side.get(stepId(step))
        return taken ? Math.max(taken.timeMs, taken.lateMs) : 0
      }),
    ),
  )
  const every = picked || latest <= 12 * 60_000 ? 1 : 2
  const start = picked ? picked[0] / 60_000 : 0
  const end = picked ? picked[1] / 60_000 : Math.ceil(latest / (every * 60_000)) * every
  const ticks = Array.from({ length: (end - start) / every + 1 }, (_, i) => start + i * every)
  const at = (ms: number) => {
    const clamped = Math.min(Math.max(ms, start * 60_000), end * 60_000)
    return `${((clamped - start * 60_000) / ((end - start) * 60_000)) * 100}%`
  }
  // A side's step outside the picked stretch sits faded at its edge, before or after it.
  const inWindow = (ms: number) => ms >= start * 60_000 && ms <= end * 60_000

  const axis = (place: string) => [
    <span key={`${place}-gap`} />,
    <AxisLabels key={place}>
      {ticks.map(minute => (
        <AxisLabel key={minute} style={{ left: at(minute * 60_000) }}>
          {formatGameTime(minute * 60_000)}
        </AxisLabel>
      ))}
    </AxisLabels>,
  ]

  const filterOptions: Array<SegmentOption<TimingsFilter>> = [
    {
      value: 'all',
      label: t('builds.timingsAll', 'Key steps'),
      title: t(
        'builds.timingsAllHelp',
        'Every building, tech and upgrade, every 5th worker, and the first 4 of each army unit, then every other one.',
      ),
    },
    { value: 'build', label: t('builds.timingsBuild', 'Buildings and tech') },
    { value: 'workers', label: t('builds.timingsWorkers', 'Every worker') },
    { value: 'army', label: t('builds.timingsArmy', 'Every army unit') },
  ]

  return (
    <PaddedPanel>
      <PanelHead $spread={true}>
        <PanelTitle>{t('builds.timingsTitle', 'Build timings')}</PanelTitle>
        <Segmented
          label={t('builds.timingsShow', 'What to show')}
          options={filterOptions}
          value={filter}
          onChange={setFilter}
        />
      </PanelHead>
      {windows.length > 1 ? (
        <div>
          <Segmented
            label={t('builds.timingsWhen', 'When in the game')}
            options={[
              { value: -1, label: t('builds.timingsWholeGame', 'Whole build') },
              ...windows.map(([from, to]) => ({
                value: from,
                label: t('builds.timingsWindow', '{{from}} to {{to}}', {
                  from: formatGameTime(from),
                  to: formatGameTime(to),
                }),
              })),
            ]}
            value={picked ? picked[0] : -1}
            onChange={value => setWindowFrom(value < 0 ? undefined : value)}
          />
        </div>
      ) : null}
      <TimingsLegend>
        <LegendItem>
          <BandSwatch />
          {t('builds.timingsMostLegend', 'Most players, the middle half of games')}
        </LegendItem>
        {sides.map((side, s) => {
          const shape = SIDE_SHAPES[s]
          return side && shape ? (
            <LegendItem key={s} $muted={s === 1 && fewWinners}>
              <Mark $color={SIDE_COLORS[s]} $shape={shape} />
              {labels[s]}
            </LegendItem>
          ) : null
        })}
      </TimingsLegend>
      {steps.length ? (
        <TimingsGrid>
          {axis('top')}
          {steps.map(step => {
            const taken = byId.map(side => side.get(stepId(step)))
            const others = taken[0]
            return (
              <TimingsRow key={stepId(step)}>
                <TimingsName $kind={getStepKind(step.key, t)}>
                  <GameIcon buildKey={step.key} size={26} />
                  {getStepName(step, t)}
                </TimingsName>
                <TrackTooltip
                  position='top'
                  tabIndex={-1}
                  text={
                    <>
                      <TipLine>
                        <GameIcon buildKey={step.key} size={28} />
                        {getStepName(step, t)}
                      </TipLine>
                      {taken.map((side, s) => {
                        const shape = SIDE_SHAPES[s]
                        return sides[s] ? (
                          <TipLine key={s}>
                            {shape ? (
                              <Mark $color={SIDE_COLORS[s]} $shape={shape} />
                            ) : (
                              <BandSwatch />
                            )}
                            {labels[s]} {getTipTime(side, s, t)}
                          </TipLine>
                        ) : null
                      })}
                    </>
                  }>
                  <Track>
                    {ticks.map(minute => (
                      <GridLine key={minute} style={{ left: at(minute * 60_000) }} />
                    ))}
                    {others ? (
                      <>
                        <Band
                          style={{
                            left: at(others.earlyMs),
                            width: `calc(${at(others.lateMs)} - ${at(others.earlyMs)})`,
                          }}
                        />
                        <Median style={{ left: at(others.timeMs) }} />
                      </>
                    ) : null}
                    {taken.map((side, s) => {
                      const shape = SIDE_SHAPES[s]
                      return side && shape ? (
                        <PlacedMark
                          key={s}
                          $color={SIDE_COLORS[s]}
                          $shape={shape}
                          $muted={(s === 1 && fewWinners) || !inWindow(side.timeMs)}
                          style={{ left: at(side.timeMs) }}
                        />
                      ) : null
                    })}
                  </Track>
                </TrackTooltip>
              </TimingsRow>
            )
          })}
          {steps.length > BOTTOM_AXIS_ROWS ? axis('bottom') : null}
        </TimingsGrid>
      ) : (
        <Text>{t('builds.timingsNone', 'None of these in most games of this build.')}</Text>
      )}
      <PanelNote>
        {t(
          'builds.timingsNote',
          'Buildings and tech go to 10 minutes, workers and army units to 15. A side shows a step when most of its games take it.',
        )}{' '}
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

/** Colors for the units in the army makeup, in order. Units past these share the last, as others. */
const UNIT_COLORS = [
  'var(--theme-data-1)',
  'var(--theme-data-2)',
  'var(--theme-data-3)',
  'var(--theme-data-4)',
  'var(--theme-data-5)',
  'var(--theme-data-6)',
  'var(--theme-data-7)',
]
const OTHER_UNITS_COLOR = 'var(--theme-data-8)'
/** The size of a unit's icon on its part of a bar. */
const MAKEUP_ICON_SIZE = 30

const MakeupGrid = styled.div`
  ${labelMedium};
  display: grid;
  grid-template-columns: 72px repeat(${ARMY_MIX_MINUTES.length}, minmax(0, 1fr));
  align-items: center;
  gap: var(--space-2) var(--space-3);
  color: var(--theme-on-surface-variant);
`

const MakeupHead = styled.span`
  font-weight: 600;
  text-align: center;
`

const MakeupBar = styled.div`
  height: 44px;
  display: flex;
  gap: 2px;
`

const MakeupPart = styled.span<{ $color: string; $muted?: boolean }>`
  ${labelSmall};
  min-width: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  overflow: hidden;
  border-radius: 4px;
  /* Neutral, with the unit's color only along the bottom, so the light icon and share on it stand
     out. The padding keeps the icon clear of the color. */
  padding-bottom: 3px;
  background: var(--theme-container-high);
  box-shadow: inset 0 -3px 0 ${props => props.$color};
  color: var(--theme-on-surface);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  opacity: ${props => (props.$muted ? 0.5 : 1)};
  /* A part shows what fits of its icon and share, by its own width. */
  container-type: inline-size;

  &:hover {
    background: var(--theme-container-highest);
  }
`

const MakeupTooltip = styled(Tooltip)`
  display: block;
`

const MakeupTip = styled.div`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  font-variant-numeric: tabular-nums;
`

const MakeupTipTitle = styled.span`
  ${labelMedium};
  grid-column: 1 / -1;
  font-weight: 600;
`

const MakeupTipName = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
`

const MakeupTipValue = styled.span`
  font-weight: 600;
  text-align: right;
`

const MakeupTipCount = styled.span`
  color: var(--theme-on-surface-variant);
  text-align: right;
`

const MakeupTipNote = styled.span`
  ${labelSmall};
  grid-column: 1 / -1;
  color: var(--theme-on-surface-variant);
`

const MakeupPartIcon = styled.span`
  display: flex;

  @container (max-width: ${MAKEUP_ICON_SIZE + 4}px) {
    display: none;
  }
`

/** A part's share, after its icon when that's there too. */
const MakeupPartShare = styled.span<{ $withIcon: boolean }>`
  @container (max-width: ${props => (props.$withIcon ? MAKEUP_ICON_SIZE + 48 : 40)}px) {
    display: none;
  }
`

const MakeupEmpty = styled.span`
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  border: 1px dashed var(--theme-outline-variant);
`

const MakeupLegend = styled(TimingsLegend)`
  margin-top: var(--space-1);
`

const UnitSwatch = styled.span<{ $color: string }>`
  width: 10px;
  height: 10px;
  flex: none;
  border-radius: 2px;
  background: ${props => props.$color};
`

/**
 * What each side's army is made of at each minute, by the supply each unit takes, so a pair of
 * Zerglings weighs what one Hydralisk does.
 */
function ArmyMakeup({
  sides,
  units,
  mutedSide,
}: {
  sides: ReadonlyArray<[label: string, side: BuildSide | undefined]>
  units: ReadonlyArray<number>
  /** A side drawn faded, for too few games to go by. */
  mutedSide?: number
}) {
  const { t } = useTranslation()
  const named = units.slice(0, UNIT_COLORS.length)
  const hasOthers = sides.some(([, side]) =>
    side?.armyMix.some(entry => !named.includes(entry.unitId) && entry.counts.some(Boolean)),
  )
  const colorOf = (unitId: number) => UNIT_COLORS[named.indexOf(unitId)] ?? OTHER_UNITS_COLOR
  const nameOf = (unitId: number | undefined) =>
    unitId === undefined ? t('builds.otherUnits', 'Other') : getBuildName(`u${unitId}`, t)

  const partsOf = (side: BuildSide, i: number) => {
    const supplies = new Map<number | undefined, { supply: number; count: number }>()
    for (const entry of side.armyMix) {
      const count = entry.counts[i] ?? 0
      const supply = count * getUnitSupply(entry.unitId)
      if (supply > 0) {
        const unitId = named.includes(entry.unitId) ? entry.unitId : undefined
        const sum = supplies.get(unitId) ?? { supply: 0, count: 0 }
        supplies.set(unitId, { supply: sum.supply + supply, count: sum.count + count })
      }
    }
    const total = Array.from(supplies.values()).reduce((sum, part) => sum + part.supply, 0)
    const order = (unitId: number | undefined) =>
      unitId === undefined ? named.length : named.indexOf(unitId)
    return Array.from(supplies, ([unitId, { supply, count }]) => ({
      unitId,
      count,
      share: supply / total,
    }))
      .filter(part => part.share > 0)
      .sort((a, b) => order(a.unitId) - order(b.unitId))
  }

  return (
    <>
      <MakeupGrid>
        <span />
        {ARMY_MIX_MINUTES.map(minute => (
          <MakeupHead key={minute}>{t('builds.atMinute', '{{minute}} min', { minute })}</MakeupHead>
        ))}
        {sides.map(([label, side], s) => [
          <span key={`${label}-label`}>{label}</span>,
          ...ARMY_MIX_MINUTES.map((minute, i) => {
            const parts = side ? partsOf(side, i) : []
            if (!parts.length) {
              return <MakeupEmpty key={`${label}-${minute}`}>-</MakeupEmpty>
            }
            return (
              <MakeupTooltip
                key={`${label}-${minute}`}
                position='top'
                text={
                  <MakeupTip>
                    <MakeupTipTitle>
                      {t('builds.makeupTipTitle', '{{side}} at {{minute}} min', {
                        side: label,
                        minute,
                      })}
                    </MakeupTipTitle>
                    {parts.map(part => [
                      <UnitSwatch
                        key={`${part.unitId}-swatch`}
                        $color={
                          part.unitId === undefined ? OTHER_UNITS_COLOR : colorOf(part.unitId)
                        }
                      />,
                      <MakeupTipName key={`${part.unitId}-name`}>
                        {part.unitId !== undefined ? (
                          <GameIcon buildKey={`u${part.unitId}`} size={24} />
                        ) : null}
                        {nameOf(part.unitId)}
                      </MakeupTipName>,
                      <MakeupTipValue key={`${part.unitId}-share`}>
                        {formatPercent(part.share)}
                      </MakeupTipValue>,
                      <MakeupTipCount key={`${part.unitId}-count`}>
                        {t('builds.makeupTipCount', '{{made}} made', {
                          made: formatCount(part.count),
                        })}
                      </MakeupTipCount>,
                    ])}
                    <MakeupTipNote>
                      {t(
                        'builds.makeupTipNote',
                        'Share of army supply, and units made on average.',
                      )}
                    </MakeupTipNote>
                  </MakeupTip>
                }>
                <MakeupBar>
                  {parts.map(part => (
                    <MakeupPart
                      key={part.unitId ?? 'other'}
                      $color={part.unitId === undefined ? OTHER_UNITS_COLOR : colorOf(part.unitId)}
                      $muted={s === mutedSide}
                      style={{ flex: `${part.share} 1 0` }}>
                      {part.unitId !== undefined ? (
                        <MakeupPartIcon>
                          <GameIcon buildKey={`u${part.unitId}`} size={MAKEUP_ICON_SIZE} />
                        </MakeupPartIcon>
                      ) : null}
                      <MakeupPartShare $withIcon={part.unitId !== undefined}>
                        {formatPercent(part.share)}
                      </MakeupPartShare>
                    </MakeupPart>
                  ))}
                </MakeupBar>
              </MakeupTooltip>
            )
          }),
        ])}
      </MakeupGrid>
      <MakeupLegend>
        {named.map(unitId => (
          <LegendItem key={unitId}>
            <UnitSwatch $color={colorOf(unitId)} />
            <GameIcon buildKey={`u${unitId}`} size={22} />
            {nameOf(unitId)}
          </LegendItem>
        ))}
        {hasOthers ? (
          <LegendItem>
            <UnitSwatch $color={OTHER_UNITS_COLOR} />
            {nameOf(undefined)}
          </LegendItem>
        ) : null}
      </MakeupLegend>
    </>
  )
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
      if (isArmyMixUnit(entry) && !units.includes(entry.unitId)) {
        units.push(entry.unitId)
      }
    }
  }
  const countOf = (side: BuildSide | undefined, unitId: number, i: number) =>
    side ? (side.armyMix.find(e => e.unitId === unitId)?.counts[i] ?? 0) : undefined
  const minutes = ARMY_MIX_MINUTES
  const basis = hasEnoughWinners(build) ? 1 : 0

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
        <ArmyMakeup
          sides={sides}
          units={units}
          mutedSide={build.winners && !hasEnoughWinners(build) ? 1 : undefined}
        />
      ) : null}
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
            <Cell key={`${unitId}-name`}>
              <IconName>
                <GameIcon buildKey={`u${unitId}`} size={32} />
                {getBuildName(`u${unitId}`, t)}
              </IconName>
            </Cell>,
            ...minutes.flatMap((_, i) =>
              sides.map(([label, side], s) => {
                const count = countOf(side, unitId, i)
                let Count = s === 0 ? GroupStartCell : Cell
                if (s === 2 && count !== undefined) {
                  const compared = countOf(sides[basis][1], unitId, i)
                  if (compared !== undefined) {
                    if (count - compared >= ARMY_DIFF_MIN && count >= compared * ARMY_DIFF_RATIO) {
                      Count = MoreCell
                    } else if (
                      compared - count >= ARMY_DIFF_MIN &&
                      count <= compared / ARMY_DIFF_RATIO
                    ) {
                      Count = FewerCell
                    }
                  }
                }
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
      {units.length && build.user ? (
        <PanelNote>
          {t(
            'builds.armyLegend',
            'Your counts in green are well above {{basis}}, in red well below.',
            {
              basis: basis
                ? t('builds.basisWinners', 'the winners')
                : t('builds.basisMost', 'most players'),
            },
          )}
        </PanelNote>
      ) : null}
    </PaddedPanel>
  )
}

/**
 * Why there are no builds to show. Off the mirror in 1v1, the user's own games never add to the
 * pool, since their opponents play the other race, so only replays of games they weren't in can.
 */
function NoBuilds({ bucket }: { bucket: CoachBucket | undefined }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  if (!bucket?.opponentRace || bucket.opponentRace === bucket.race) {
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

  const race = raceCharToLabel(bucket.race, t)
  const opponent = raceCharToLabel(bucket.opponentRace, t)
  return (
    <Message>
      <PanelTitle>
        {t('builds.noneOffMirrorTitle', 'Not enough {{race}} vs {{opponent}} games yet', {
          race,
          opponent,
        })}
      </PanelTitle>
      <Text>
        {t(
          'builds.noneOffMirror',
          "Your opponents here play {{opponent}}, so their builds count toward {{opponent}} vs {{race}}. Other {{race}} players' builds against {{opponent}} only come from games you weren't in, like a replay pack. Add a folder of them to your library and analyze them.",
          { race, opponent },
        )}
      </Text>
      <div>
        <TextButton
          label={t('builds.replayFolders', 'Replay folders')}
          onClick={() => dispatch(openSettings(AppSettingsPage.Replays))}
        />
      </div>
    </Message>
  )
}

/** The builds for the kind of game picked, with the one picked shown in detail. */
function BuildsBody({ coach }: { coach: Extract<CoachResult, { status: 'ready' }> }) {
  const bucket = coach.buckets[0]
  const [picked, setPicked] = useState<string>()
  const [against, setAgainst] = useState('')
  const view = bucket?.buildsAgainst?.find(b => b.opponents === against) ?? bucket
  if (!bucket || !view?.builds.length) {
    return <NoBuilds bucket={bucket} />
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
        <BuildTimings build={selected} />
      </SectionErrorBoundary>
      <SectionErrorBoundary>
        <ArmyMix build={selected} />
      </SectionErrorBoundary>
      <SectionErrorBoundary>
        <Workers build={selected} race={bucket.race} />
      </SectionErrorBoundary>
      {bucket.teamBuilds?.length ? (
        <SectionErrorBoundary>
          <TeamBuilds
            teams={bucket.teamBuilds}
            anyOpponents={getPickablePairs(bucket).length > 0}
          />
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
