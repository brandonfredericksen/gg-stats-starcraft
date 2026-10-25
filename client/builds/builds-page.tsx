import { TFunction } from 'i18next'
import { useSetAtom } from 'jotai'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { LadderRank } from '../../common/games/ladder'
import { MapFamily } from '../../common/games/map-family'
import { CoachBuild, CoachTeamBuild, MIN_WINNER_GAMES } from '../../common/my-stats/builds'
import { CoachBucket, CoachResult, CoachScope } from '../../common/my-stats/coach'
import { MetaResult } from '../../common/my-stats/meta-builds'
import { MyStatsShape } from '../../common/my-stats/my-stats'
import { splitsByMap } from '../../common/my-stats/player-games'
import { AssignedRaceChar, raceCharToLabel } from '../../common/races'
import { coachScopeAtom, useCoach, useMetaBuilds, useShapeCounts } from '../coach/coach-data'
import { CoachToolbar } from '../coach/coach-page'
import { Cell, HeadCell, Text } from '../coach/coach-shared'
import { SectionErrorBoundary } from '../games/game-stats-shared'
import { TextButton } from '../material/button'
import { RaceTag } from '../material/race-tag'
import { useDemoPlayer } from '../my-stats/demo-player'
import { HelpLabel, PaddedPanel, PanelHead, PanelTitle } from '../my-stats/my-stats-panels'
import { Badge, Header, Message, Root, Title } from '../my-stats/page-layout'
import { PageLoadingIndicator } from '../progress/page-loading'
import { useAppDispatch } from '../redux-hooks'
import { openSettings } from '../settings/action-creators'
import { AppSettingsPage } from '../settings/settings-page'
import { OwnGamesNeeded, useNewestOwnGame } from '../system-bar/own-games-needed'
import { WorkersAndArmy } from './build-minutes'
import { BuildOrder } from './build-order'
import {
  BuildCompare,
  BuildsTable,
  closestFamily,
  getBuildFamilyName,
  Row,
  ShownSide,
  SpanHead,
  WinRateCell,
} from './build-shared'
import {
  BuildEntry,
  BuildsList,
  BuildsPickers,
  getLevelHelp,
  getLevelName,
  getTopPlayersHelp,
  hasSplits,
  MIN_RATE_GAMES,
} from './builds-list'

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

function rateOf(record: { wins: number; losses: number }) {
  const decided = record.wins + record.losses
  return decided ? record.wins / decided : undefined
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
        <PanelTitle>
          <HelpLabel
            label={t('builds.teamTitle', 'Team builds')}
            help={[
              t(
                'builds.teamBuildsOthersNote',
                "What other players' teams opened together, each team counted once, next to yours.",
              ),
              anyOpponents
                ? t('builds.teamBuildsAnyNote', 'Against any team, whichever is picked above.')
                : '',
            ].join(' ')}
          />
        </PanelTitle>
      </PanelHead>
      <BuildsTable $columns='minmax(0, 1fr) minmax(0, 1fr) 80px 112px 80px 112px'>
        <Row>
          <span />
          <span />
          <SpanHead style={{ gridColumn: 'span 2' }}>
            {t('builds.otherTeams', 'Other teams')}
          </SpanHead>
          <SpanHead style={{ gridColumn: 'span 2' }}>{t('builds.you', 'You')}</SpanHead>
        </Row>
        <Row>
          <HeadCell>{t('builds.build', 'Build')}</HeadCell>
          <HeadCell>{t('builds.partnerBuild', "Partner's build")}</HeadCell>
          <HeadCell $end={true}>{t('builds.games', 'Games')}</HeadCell>
          <HeadCell $end={true}>{t('builds.winRate', 'Win rate')}</HeadCell>
          <HeadCell $end={true}>{t('builds.games', 'Games')}</HeadCell>
          <HeadCell $end={true}>{t('builds.winRate', 'Win rate')}</HeadCell>
        </Row>
        {teams.map(team => {
          const user = { wins: team.userWins, losses: team.userLosses }
          return (
            <Row key={team.families.join('+')}>
              <Cell>{named(team.families[0])}</Cell>
              <Cell>{named(team.families[1])}</Cell>
              <Cell $end={true}>{team.games}</Cell>
              <WinRateCell
                rate={rateOf(team)}
                wins={team.wins}
                losses={team.losses}
                faded={team.games < MIN_RATE_GAMES}
              />
              <Cell $end={true} $tone={team.userGames ? undefined : 'muted'}>
                {team.userGames || '-'}
              </Cell>
              <WinRateCell
                rate={team.userGames ? rateOf(user) : undefined}
                wins={user.wins}
                losses={user.losses}
                faded={team.userGames < MIN_RATE_GAMES}
              />
            </Row>
          )
        })}
      </BuildsTable>
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
          "Other {{race}} players' builds against {{opponent}} come from games you weren't in, like a replay pack. Add one to your library and analyze it.",
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

/** The builds of players at the user's level, and the user's, against the opponents picked. */
interface LevelBuilds {
  builds: ReadonlyArray<CoachBuild>
  userBuild?: string
}

/**
 * Every build played here, top players' first, by how much they play each, then the rest by how
 * much players at the user's level do.
 */
function getEntries(meta: MetaResult | 'error', level: LevelBuilds): BuildEntry[] {
  const top = meta === 'error' ? [] : meta.builds
  const entries: BuildEntry[] = top.map(build => ({
    family: build.family,
    top: build,
    level: level.builds.find(b => b.family === build.family),
  }))
  for (const build of level.builds) {
    if (!entries.some(entry => entry.family === build.family)) {
      entries.push({ family: build.family, top: undefined, level: build })
    }
  }
  return entries
}

/**
 * Every side of a build, with the closest build a side plays standing in for one it doesn't, and
 * a note saying which. The user's side is always their games of the build itself.
 */
function getCompare(
  entry: BuildEntry,
  meta: MetaResult | 'error',
  level: LevelBuilds,
  bucket: CoachBucket,
  autoRank: LadderRank | undefined,
  eapmFloor: number,
  scope: Omit<CoachScope, 'games'>,
  t: TFunction,
): { compare: BuildCompare; note: string | undefined; typicalGame: string | undefined } {
  const topBuilds = meta === 'error' ? [] : meta.builds
  const topFamily = closestFamily(entry.family, f => topBuilds.some(b => b.family === f))
  const top = topBuilds.find(b => b.family === topFamily)
  const played = level.builds.filter(b => b.others.games > 0)
  const levelFamily = closestFamily(entry.family, f => played.some(b => b.family === f))
  const others = played.find(b => b.family === levelFamily)
  const winners = others?.winners
  const user = entry.level?.user
  const levelName = getLevelName(bucket, autoRank, eapmFloor, t)

  const sides: ShownSide[] = [
    {
      key: 'top',
      label: t('builds.topPlayers', 'Top players'),
      players: t('builds.basisTop', 'top players'),
      side: top?.side,
      help: getTopPlayersHelp(meta, scope, t),
      muted: false,
    },
    {
      key: 'level',
      label: levelName.label,
      players: levelName.players,
      side: others?.others,
      help: getLevelHelp(bucket, eapmFloor, t),
      muted: false,
    },
    {
      key: 'winners',
      label: t('builds.winners', 'Winners'),
      players: t('builds.basisWinners', 'the winners'),
      side: winners,
      help: t(
        'builds.winnersHelp',
        'Wins with this build by {{players}} who were still in at the end. Empty under {{empty}} such games, and faded under {{minimum}}.',
        { players: levelName.players, empty: MIN_WINNER_GAMES, minimum: MIN_RATE_GAMES },
      ),
      muted: !!winners && winners.games < MIN_RATE_GAMES,
    },
    {
      key: 'you',
      label: t('builds.you', 'You'),
      side: user,
      help: t('builds.youHelp', 'Your games with this build.'),
      muted: false,
    },
  ]
  const basis =
    sides.find(s => s.key === 'winners' && s.side && !s.muted) ??
    sides.find(s => s.key === 'level' && s.side) ??
    sides.find(s => s.key === 'top' && s.side)

  const standIns: string[] = []
  if (topFamily && topFamily !== entry.family) {
    standIns.push(
      t('builds.topAs', 'Top players as {{build}}, the closest build they play.', {
        build: getBuildFamilyName(topFamily, t),
      }),
    )
  }
  if (levelFamily && levelFamily !== entry.family) {
    standIns.push(
      t('builds.levelAs', '{{side}} as {{build}}, the closest build they play.', {
        side: levelName.label,
        build: getBuildFamilyName(levelFamily, t),
      }),
    )
  }

  return {
    compare: { family: entry.family, sides, basis },
    note: standIns.length ? standIns.join(' ') : undefined,
    typicalGame: top?.typicalGame,
  }
}

/** The builds for the kind of game picked, with the one picked shown in detail. */
function BuildsBody({ coach }: { coach: Extract<CoachResult, { status: 'ready' }> }) {
  const { t } = useTranslation()
  const bucket = coach.buckets[0]
  const { scope } = coach
  const [picked, setPicked] = useState<string>()
  const [against, setAgainst] = useState('')
  const [opening, setOpening] = useState('')
  const [map, setMap] = useState<MapFamily>()
  const meta = useMetaBuilds({
    shape: scope.shape,
    race: scope.race,
    opponentRace: scope.opponentRace,
    allyRace: scope.allyRace,
    mapFamily: scope.mapFamily ?? map,
    opponents: against || undefined,
    opponentOpening: opening || undefined,
  })
  if (!meta) {
    return <PageLoadingIndicator />
  }

  const level: LevelBuilds = against
    ? (bucket?.buildsAgainst?.find(b => b.opponents === against) ?? { builds: [] })
    : (bucket ?? { builds: [] })
  const entries = getEntries(meta, level)
  if (!bucket || (!entries.length && !against && !opening)) {
    return <NoBuilds bucket={bucket} />
  }
  const selected =
    entries.find(e => e.family === picked) ??
    entries.find(e => e.family === level.userBuild) ??
    entries[0]
  const detail = selected
    ? getCompare(selected, meta, level, bucket, coach.autoRank, coach.eapmFloor, scope, t)
    : undefined

  return (
    <Panels>
      <SectionErrorBoundary>
        <BuildsList
          entries={entries}
          meta={meta}
          scope={scope}
          bucket={bucket}
          autoRank={coach.autoRank}
          eapmFloor={coach.eapmFloor}
          userBuild={level.userBuild}
          selected={selected?.family ?? ''}
          onSelect={setPicked}
          pickers={
            hasSplits(meta, bucket) ? (
              <BuildsPickers
                meta={meta}
                bucket={bucket}
                opening={opening}
                onOpening={setOpening}
                map={map}
                onMap={setMap}
                against={against}
                onAgainst={setAgainst}
              />
            ) : undefined
          }
        />
      </SectionErrorBoundary>
      {detail ? (
        <>
          <SectionErrorBoundary>
            <BuildOrder
              compare={detail.compare}
              note={detail.note}
              typicalGame={detail.typicalGame}
            />
          </SectionErrorBoundary>
          <SectionErrorBoundary>
            <WorkersAndArmy compare={detail.compare} race={bucket.race} />
          </SectionErrorBoundary>
        </>
      ) : null}
      {bucket.teamBuilds?.length ? (
        <SectionErrorBoundary>
          <TeamBuilds
            teams={bucket.teamBuilds}
            anyOpponents={!!bucket.buildsAgainst?.some(b => b.builds.length)}
          />
        </SectionErrorBoundary>
      ) : null}
    </Panels>
  )
}

const SHAPES: ReadonlyArray<MyStatsShape> = ['1v1', '2v2', '3v3', '4v4', 'ffa']
const RACES: ReadonlyArray<AssignedRaceChar> = ['p', 't', 'z']
const MAP_FAMILIES: ReadonlyArray<MapFamily> = ['standard', 'fastest', 'bgh']

/**
 * Every kind of game builds can be shown for, the user's most played first, then every other one.
 * Builds come from other players' games, so the user needn't have played a kind for it to be here.
 */
function getEveryScope(played: ReadonlyArray<CoachScope>): CoachScope[] {
  const scopes = [...played]
  const keyOf = (s: Omit<CoachScope, 'games'>) =>
    `${s.shape}:${s.race}:${s.opponentRace ?? ''}:${s.allyRace ?? ''}:${s.mapFamily ?? ''}`
  const known = new Set(played.map(keyOf))
  for (const shape of SHAPES) {
    for (const mapFamily of splitsByMap(shape) ? MAP_FAMILIES : [undefined]) {
      for (const race of RACES) {
        for (const other of shape === '1v1' || shape === '2v2' ? RACES : [undefined]) {
          const scope: CoachScope = {
            shape,
            race,
            opponentRace: shape === '1v1' ? other : undefined,
            allyRace: shape === '2v2' ? other : undefined,
            mapFamily,
            games: 0,
          }
          if (!known.has(keyOf(scope))) {
            scopes.push(scope)
          }
        }
      }
    }
  }
  return scopes
}

/** The builds players use in any kind of game, and how the user's compares where they played it. */
export function BuildsView({ coach }: { coach: CoachResult | 'error' | undefined }) {
  const { t } = useTranslation()
  const counts = useShapeCounts()
  const setScope = useSetAtom(coachScopeAtom)
  const scopes = getEveryScope(coach && coach !== 'error' ? coach.scopes : [])
  const noGames = coach !== 'error' && coach?.status === 'noGames'
  useEffect(() => {
    if (noGames) {
      const { games: _, ...first } = getEveryScope([])[0]
      setScope(first)
    }
  }, [noGames, setScope])

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
    content = <PageLoadingIndicator />
  } else {
    let body: React.ReactNode
    if (coach.status === 'ready') {
      body = <BuildsBody key={JSON.stringify(coach.scope)} coach={coach} />
    } else {
      body = (
        <Message>
          <Text>
            {t(
              'builds.noGames',
              'None of your analyzed games can be compared yet. Analyze a few more of yours.',
            )}
          </Text>
        </Message>
      )
    }
    content = (
      <>
        <CoachToolbar coach={coach} scopes={scopes} counts={counts} />
        {body}
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
  const newest = useNewestOwnGame()
  const { coach } = useCoach()
  const demo = useDemoPlayer()
  if (!demo && !newest) {
    return <PageLoadingIndicator />
  }
  if (!demo && newest && newest.state !== 'found') {
    return <OwnGamesNeeded state={newest.state} onRetry={newest.retry} />
  }
  return <BuildsView coach={coach} />
}
