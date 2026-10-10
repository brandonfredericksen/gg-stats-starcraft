import { TFunction } from 'i18next'
import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css, keyframes } from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { withAssumedResults } from '../../common/games/assumed-results'
import { getGameDurationString } from '../../common/games/game-duration'
import { GameStats, GameStatsSource, ReplayStatsSource } from '../../common/games/game-stats'
import { GameStatusString } from '../../common/games/game-status'
import { TypedIpcRenderer } from '../../common/ipc'
import { useFormatLocale } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { jotaiStore } from '../jotai-store'
import { FilledButton, TextButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Card } from '../material/card'
import { PageNav } from '../navigation/page-nav'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useCurrentMinuteMs } from '../react/date-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { analyzeReplay, startReplay } from '../replays/action-creators'
import { getPlayedDayLabel } from '../replays/replay-days'
import { bahnschrift, bodyLarge, labelLarge, titleLarge } from '../styles/typography'
import { recentReplayPathsAtom } from './game-atoms'
import {
  cancelReplayAnalysisAtom,
  gameStatsByIdAtom,
  loadSavedGameStats,
  ReplayAnalysisFailure,
} from './game-stats-atoms'
import { getMatchup, groupSides, Side } from './game-stats-model'
import { GameStatsView } from './game-stats-view'
import { useMyPlayerNames } from './my-player-names'

const ipcRenderer = new TypedIpcRenderer()

const Root = styled.div`
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 22px 32px 56px;
`

/** The stats for a replay analyzed from the replay library. */
export function GameStatsPage({ params }: { params: { gameId: string } }) {
  const { gameId } = params
  const gameStats = useAtomValue(gameStatsByIdAtom).get(gameId)
  // An analysis keeps running when the page reloads, though what this page knew about it doesn't.
  const isAnalyzing = useAppSelector(
    s =>
      s.gameClient.status?.id === gameId &&
      !!s.gameClient.status.isReplayAnalysis &&
      IN_PROGRESS_STATES.has(s.gameClient.status.state),
  )
  const isMissing = !gameStats

  useEffect(() => {
    if (isMissing) {
      loadSavedGameStats(gameId).catch(swallowNonBuiltins)
    }
  }, [gameId, isMissing])

  let content: React.ReactNode
  switch (gameStats?.status) {
    case undefined:
    case 'loading':
    case 'missing':
      if (isAnalyzing) {
        content = <AnalyzingView gameId={gameId} />
      } else if (gameStats?.status === 'missing') {
        content = <MissingView />
      } else {
        content = <LoadingDotsArea />
      }
      break
    case 'analyzing':
      content = <AnalyzingView gameId={gameId} replayName={gameStats.source.name} />
      break
    case 'done':
      content = (
        <StatsView
          gameId={gameId}
          stats={gameStats.stats}
          source={gameStats.source}
          playedAtMs={gameStats.playedAtMs}
        />
      )
      break
    case 'failed':
      content = <FailedView replay={gameStats.source} reason={gameStats.reason} />
      break
    default:
      content = assertUnreachable(gameStats)
  }

  return <Root>{content}</Root>
}

const IN_PROGRESS_STATES: ReadonlySet<GameStatusString> = new Set([
  'launching',
  'configuring',
  'awaitingPlayers',
  'starting',
  'playing',
])

/** Goes back to wherever the page was opened from, or to the replays if it was opened directly. */
function goBack() {
  if (window.history.length > 1) {
    window.history.back()
  } else {
    push('/replays')
  }
}

function BackButton() {
  const { t } = useTranslation()
  return (
    <TextButton
      label={t('gameStats.back', 'Back')}
      iconStart={<MaterialIcon icon='arrow_back' />}
      onClick={goBack}
    />
  )
}

const StatusPanel = styled(Card)`
  width: 100%;
  max-width: 560px;
  margin: 48px auto 0;
  padding: 40px 32px;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
`

const pulse = keyframes`
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.08);
    opacity: 0.7;
  }
`

const spin = keyframes`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`

const StatusIcon = styled(MaterialIcon).attrs({ size: 56 })<{
  $animate?: boolean
  $error?: boolean
}>`
  color: ${props => (props.$error ? 'var(--theme-negative)' : 'var(--theme-amber)')};
  ${props =>
    props.$animate
      ? css`
          animation: ${pulse} 1.6s ease-in-out infinite;

          @media (prefers-reduced-motion: reduce) {
            animation: none;
          }
        `
      : ''}
`

const StatusTitle = styled.h1`
  ${titleLarge};
  margin: 0;
`

const StatusBody = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
  overflow-wrap: anywhere;
`

const StatusActions = styled.div`
  margin-top: 8px;
  display: flex;
  gap: 8px;
`

type StepState = 'done' | 'active' | 'waiting'

const Steps = styled.ol`
  width: 100%;
  margin: 8px 0 0;
  padding: 0;

  display: flex;
  flex-direction: column;
  gap: 12px;
  list-style: none;
  text-align: left;
`

/** Announces each step as it starts, without the list losing what it is. */
const StepsStatus = styled.div`
  width: 100%;
`

const Step = styled.li<{ $state: StepState }>`
  ${bodyLarge};
  display: flex;
  align-items: center;
  gap: 12px;
  color: ${props =>
    props.$state === 'waiting' ? 'var(--theme-on-surface-variant)' : 'var(--theme-on-surface)'};
`

const StepMarker = styled.div`
  width: 24px;
  height: 24px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;
`

const ActiveStepIcon = styled(MaterialIcon)`
  color: var(--theme-amber);
  animation: ${spin} 1s linear infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`

function StepMarkerIcon({ state }: { state: StepState }) {
  switch (state) {
    case 'done':
      return <MaterialIcon icon='check_circle' size={20} />
    case 'active':
      return <ActiveStepIcon icon='progress_activity' size={20} />
    case 'waiting':
      return <MaterialIcon icon='radio_button_unchecked' size={20} filled={false} />
    default:
      return assertUnreachable(state)
  }
}

function AnalyzingView({ gameId, replayName }: { gameId: string; replayName?: string }) {
  const { t } = useTranslation()
  const gameState = useAppSelector(s =>
    s.gameClient.status?.id === gameId ? s.gameClient.status.state : undefined,
  )
  // The game reports its stats as soon as it reaches the end, so everything after starting up
  // happens while it's playing.
  const playing = gameState === 'playing'
  const steps: Array<{ label: string; state: StepState }> = [
    {
      label: t('gameStats.stepStarting', 'Starting StarCraft in the background'),
      state: playing ? 'done' : 'active',
    },
    {
      label: t('gameStats.stepPlaying', 'Playing through the replay'),
      state: playing ? 'active' : 'waiting',
    },
  ]

  const onCancel = () => {
    jotaiStore.set(cancelReplayAnalysisAtom, gameId)
    ipcRenderer.invoke('activeGameClearConfig', gameId)?.catch(swallowNonBuiltins)
    goBack()
  }

  return (
    <StatusPanel>
      <StatusIcon icon='analytics' $animate={true} />
      <StatusTitle>{t('gameStats.analyzingTitle', 'Analyzing replay')}</StatusTitle>
      {replayName ? <StatusBody>{replayName}</StatusBody> : null}
      <StepsStatus role='status' aria-live='polite'>
        <Steps>
          {steps.map(step => (
            <Step key={step.label} $state={step.state}>
              <StepMarker>
                <StepMarkerIcon state={step.state} />
              </StepMarker>
              {step.label}
            </Step>
          ))}
        </Steps>
      </StepsStatus>
      <StatusActions>
        <TextButton label={t('common.actions.cancel', 'Cancel')} onClick={onCancel} />
      </StatusActions>
    </StatusPanel>
  )
}

function getFailureMessage(reason: ReplayAnalysisFailure, replayName: string, t: TFunction) {
  switch (reason) {
    case 'launch':
      return t(
        'gameStats.failedLaunch',
        "StarCraft couldn't load {{replayName}}. It may be corrupt, or from a version of " +
          'StarCraft newer than this one supports.',
        { replayName },
      )
    case 'replaced':
      return t(
        'gameStats.failedReplaced',
        'Another game started, which stopped the analysis of {{replayName}}.',
        { replayName },
      )
    case 'stopped':
      return t(
        'gameStats.failedStopped',
        'StarCraft stopped before it finished playing through {{replayName}}.',
        { replayName },
      )
    case 'noStats':
      return t('gameStats.failedNoStats', "StarCraft couldn't get any stats from {{replayName}}.", {
        replayName,
      })
    default:
      return assertUnreachable(reason)
  }
}

function FailedView({
  replay,
  reason,
}: {
  replay: ReplayStatsSource
  reason: ReplayAnalysisFailure
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  return (
    <StatusPanel role='alert'>
      <StatusIcon icon='error' $error={true} />
      <StatusTitle>{t('gameStats.failedTitle', "This replay couldn't be analyzed")}</StatusTitle>
      <StatusBody>{getFailureMessage(reason, replay.name, t)}</StatusBody>
      <StatusActions>
        <BackButton />
        <FilledButton
          label={t('gameStats.tryAgain', 'Try again')}
          onClick={() => dispatch(analyzeReplay({ ...replay, reanalyze: true }))}
        />
      </StatusActions>
    </StatusPanel>
  )
}

function MissingView() {
  const { t } = useTranslation()
  return (
    <StatusPanel>
      <StatusIcon icon='search_off' />
      <StatusTitle>{t('gameStats.missingTitle', 'No stats were saved for this game')}</StatusTitle>
      <StatusBody>
        {t('gameStats.missingBody', 'They may have been cleared out to make room for newer games.')}
      </StatusBody>
      <StatusActions>
        <BackButton />
      </StatusActions>
    </StatusPanel>
  )
}

const Header = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const headerButton = css`
  ${buttonReset};
  ${labelLarge};
  height: 36px;

  display: inline-flex;
  align-items: center;
  gap: 6px;

  border-radius: 10px;
  color: var(--theme-on-surface);
  font-weight: 600;
  cursor: pointer;

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const QuietButton = styled.button`
  ${headerButton};
  padding: 0 12px;

  &:hover {
    background: rgb(from var(--theme-on-surface) r g b / 0.06);
  }
`

const LitButton = styled.button`
  ${headerButton};
  padding: 0 14px 0 10px;
  border: 1px solid var(--theme-outline-strong);
  background: linear-gradient(180deg, var(--theme-panel-sheen), var(--theme-container-low));
  box-shadow: inset 0 1px 0 var(--theme-panel-highlight);

  &:hover {
    background: var(--theme-container-high);
  }
`

const TitleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 14px;
`

const MapName = styled.h1`
  ${bahnschrift};
  margin: 0;
  font-size: 36px;
  font-weight: 700;
  line-height: 1;
`

const Meta = styled.span`
  ${bodyLarge};
  font-size: 15px;
  color: var(--theme-on-surface-variant);
`

function StatsView({
  gameId,
  stats,
  source,
  playedAtMs,
}: {
  gameId: string
  stats: GameStats
  source: GameStatsSource
  playedAtMs?: number
}) {
  const recentReplayPath = useAtomValue(recentReplayPathsAtom).get(gameId)
  const replayPath =
    source.kind === 'replay' ? source.path : (source.replayPath ?? recentReplayPath)
  return (
    <GameStatsView
      key={gameId}
      stats={stats}
      source={source}
      replayPath={replayPath}
      header={<StatsHeader gameId={gameId} stats={stats} source={source} playedAtMs={playedAtMs} />}
    />
  )
}

function getFileName(filePath: string) {
  return filePath.split(/[\\/]/).pop() || filePath
}

/** What kind of game it was: the matchup for a 1v1, "2v2" for teams, or a free for all. */
function getGameKind(sides: ReadonlyArray<Side>, t: TFunction) {
  if (sides.length > 2 && !sides.some(side => side.isTeam)) {
    return t('gameStats.freeForAllKind', 'FFA, {{count}} players', { count: sides.length })
  }
  if (sides.every(side => side.players.length === 1)) {
    return getMatchup(sides, t)
  }
  return sides.map(side => side.players.length).join('v')
}

function StatsHeader({
  gameId,
  stats,
  source,
  playedAtMs,
}: {
  gameId: string
  stats: GameStats
  source: GameStatsSource
  playedAtMs?: number
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const locale = useFormatLocale()
  const nowMs = useCurrentMinuteMs()
  const myNames = useMyPlayerNames()
  const recentReplayPath = useAtomValue(recentReplayPathsAtom).get(gameId)
  const playedReplayPath =
    source.kind === 'game' ? (source.replayPath ?? recentReplayPath) : undefined
  const replay =
    source.kind === 'replay'
      ? source
      : playedReplayPath && {
          name: getFileName(playedReplayPath),
          path: playedReplayPath,
          linkedGameId: gameId,
        }
  const sides = groupSides(withAssumedResults(stats.players, stats.complete, myNames))
  const mapName =
    stats.mapName ||
    (source.kind === 'replay' ? source.name : t('gameStats.unknownMap', 'Unknown map'))
  const meta = [getGameDurationString(stats.durationMs)]
  if (stats.players.length > 1) {
    meta.push(getGameKind(sides, t))
  }
  if (playedAtMs !== undefined) {
    const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(
      playedAtMs,
    )
    meta.push(
      t('gameStats.playedAt', '{{day}}, {{time}}', {
        day: getPlayedDayLabel(playedAtMs, nowMs, locale, t),
        time,
      }),
    )
  }

  return (
    <Header>
      <PageNav
        crumbs={[
          { label: t('gameStats.libraryCrumb', 'Library'), href: '/replays' },
          // The replay's file name, as it is on disk.
          { label: replay ? replay.name : mapName },
        ]}
        actions={
          replay ? (
            <>
              <QuietButton
                type='button'
                onClick={() => dispatch(analyzeReplay({ ...replay, reanalyze: true }))}>
                <MaterialIcon icon='refresh' size={18} />
                {t('gameStats.analyzeAgain', 'Analyze again')}
              </QuietButton>
              <LitButton
                type='button'
                onClick={() => dispatch(startReplay({ path: replay.path, name: replay.name }))}>
                <MaterialIcon icon='play_arrow' size={18} />
                {t('gameStats.watchReplay', 'Watch replay')}
              </LitButton>
            </>
          ) : undefined
        }
      />
      <TitleRow>
        <MapName>{mapName}</MapName>
        <Meta>{meta.join(' · ')}</Meta>
      </TitleRow>
    </Header>
  )
}
