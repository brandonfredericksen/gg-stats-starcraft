import { atom } from 'jotai'
import { atomWithImmer } from 'jotai-immer'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getErrorStack } from '../../common/errors'
import {
  fromGameStatsPayload,
  GameStats,
  GameStatsPayload,
  GameStatsSource,
  ReplayFileInfo,
  ReplayStatsSource,
  SavedGameStats,
} from '../../common/games/game-stats'
import { TypedIpcRenderer } from '../../common/ipc'
import { jotaiStore } from '../jotai-store'
import logger from '../logging/logger'

/**
 * Why a replay analysis didn't finish:
 * - `launch`: StarCraft couldn't start or couldn't load the replay
 * - `replaced`: another game started, which took its place
 * - `stopped`: StarCraft stopped before reaching the replay's end
 * - `noStats`: it reached the end but couldn't get any stats there
 */
export type ReplayAnalysisFailure = 'launch' | 'replaced' | 'stopped' | 'noStats'

export type GameStatsState =
  | {
      status: 'analyzing'
      source: ReplayStatsSource
      /** Whether the app has reported this analysis's game, so it's known to have started. */
      launched: boolean
      /** Whether the replay has loaded and is being played through. */
      playing: boolean
    }
  | { status: 'loading' }
  | {
      status: 'done'
      source: GameStatsSource
      stats: GameStats
      /** When the game was played, as near as is known. */
      playedAtMs?: number
    }
  | { status: 'failed'; source: ReplayStatsSource; reason: ReplayAnalysisFailure }
  | { status: 'missing' }

/**
 * How many games' stats are kept around once they've been looked at. Analyses still running and
 * stats still loading are always kept.
 */
const MAX_CACHED_GAME_STATS = 20

/** Stats for games played and replays analyzed, keyed by game id, as they're looked at. */
export const gameStatsByIdAtom = atomWithImmer<ReadonlyMap<string, GameStatsState>>(new Map())

function isSettled(state: GameStatsState) {
  return state.status !== 'analyzing' && state.status !== 'loading'
}

/** Sets a game's stats as the most recent, dropping the least recent once there are too many. */
function setGameStats(draft: Map<string, GameStatsState>, gameId: string, state: GameStatsState) {
  draft.delete(gameId)
  draft.set(gameId, state)
  let excess = draft.size - MAX_CACHED_GAME_STATS
  for (const [id, cached] of draft) {
    if (excess <= 0) {
      break
    }
    if (id !== gameId && isSettled(cached)) {
      draft.delete(id)
      excess -= 1
    }
  }
}

export const startReplayAnalysisAtom = atom(
  null,
  (_get, set, { gameId, replay }: { gameId: string; replay: ReplayStatsSource }) => {
    set(gameStatsByIdAtom, draft => {
      setGameStats(draft, gameId, {
        status: 'analyzing',
        source: replay,
        launched: false,
        playing: false,
      })
    })
  },
)

/** Forgets a replay analysis the user stopped, or one that never got started. */
export const cancelReplayAnalysisAtom = atom(null, (_get, set, gameId: string) => {
  set(gameStatsByIdAtom, draft => {
    if (draft.get(gameId)?.status === 'analyzing') {
      draft.delete(gameId)
    }
  })
})

/**
 * Shows the stats a game reported, as it reported them or as they were saved. Saved stats come with
 * the replay file they were saved for, which dates them when the replay doesn't say when its game
 * started.
 */
export const showGameStatsAtom = atom(
  null,
  (
    get,
    set,
    {
      gameId,
      source,
      stats,
      replayFile,
      savedAt,
    }: {
      gameId: string
      source: GameStatsSource
      stats: GameStatsPayload
      replayFile?: ReplayFileInfo
      savedAt?: number
    },
  ) => {
    const replayPath = getReplayPath(source)
    const done: GameStatsState = {
      status: 'done',
      source,
      stats: fromGameStatsPayload(stats),
      // Without a replay to say when the game started, it ended when its stats were saved, or just
      // now if they haven't been.
      playedAtMs: replayPath ? undefined : (savedAt ?? Date.now()),
    }
    set(gameStatsByIdAtom, draft => {
      setGameStats(draft, gameId, done)
    })
    if (replayPath) {
      getReplayGameTime(replayPath)
        .then(gameTime => {
          // Only fill in the stats this looked up, not newer ones that replaced them.
          if (get(gameStatsByIdAtom).get(gameId) === done) {
            set(gameStatsByIdAtom, draft => {
              draft.set(gameId, {
                ...done,
                playedAtMs: gameTime ?? replayFile?.modifiedMs ?? savedAt ?? Date.now(),
              })
            })
          }
        })
        .catch(swallowNonBuiltins)
    }
  },
)

/** Marks a replay analysis as failed if it's still waiting on its stats. */
export const failReplayAnalysisAtom = atom(
  null,
  (_get, set, { gameId, reason }: { gameId: string; reason: ReplayAnalysisFailure }) => {
    set(gameStatsByIdAtom, draft => {
      const current = draft.get(gameId)
      if (current?.status === 'analyzing') {
        draft.set(gameId, {
          status: 'failed',
          source: current.source,
          // Stopping before the replay ever got going means it couldn't be loaded.
          reason: reason === 'stopped' && !current.playing ? 'launch' : reason,
        })
      }
    })
  },
)

/**
 * Notes that `activeGameId` is the game running now. Only one game runs at a time, so any other
 * analysis that had started was stopped to make room for it. An analysis that hasn't started yet
 * is left alone, since a game reported before it may be one it's about to replace.
 */
export const updateRunningAnalysesAtom = atom(
  null,
  (_get, set, { gameId: activeGameId, state: gameState }: { gameId: string; state: string }) => {
    set(gameStatsByIdAtom, draft => {
      for (const [gameId, state] of draft) {
        if (state.status !== 'analyzing') {
          continue
        }
        if (gameId === activeGameId) {
          const playing = state.playing || gameState === 'playing'
          if (!state.launched || playing !== state.playing) {
            draft.set(gameId, { ...state, launched: true, playing })
          }
        } else if (state.launched) {
          draft.set(gameId, { status: 'failed', source: state.source, reason: 'replaced' })
        }
      }
    })
  },
)

/** The game id of a running analysis of the replay at `path`, if there is one. */
export function findRunningAnalysis(path: string): string | undefined {
  for (const [gameId, state] of jotaiStore.get(gameStatsByIdAtom)) {
    if (state.status === 'analyzing' && state.source.path === path) {
      return gameId
    }
  }
  return undefined
}

const ipcRenderer = new TypedIpcRenderer()

function getReplayPath(source: GameStatsSource) {
  return source.kind === 'replay' ? source.path : source.replayPath
}

/**
 * When the game in the replay at `replayPath` started, from the replay's header. This is the time
 * the replay library shows for it. The replay file's own modified time can't stand in for it, since
 * moving or archiving the file can change that long after the game.
 */
async function getReplayGameTime(replayPath: string): Promise<number | undefined> {
  try {
    const startTime = (await ipcRenderer.invoke('replayParseMetadata', replayPath))?.headerData
      .startTime
    return startTime ? startTime * 1000 : undefined
  } catch (err) {
    logger.error(`Error reading when the game in ${replayPath} was played: ${getErrorStack(err)}`)
    return undefined
  }
}

/**
 * Shows a game's saved stats, unless they're already showing, loading or being analyzed. Stats
 * that were missing are looked for again, since they may have been saved since.
 */
export async function loadSavedGameStats(gameId: string) {
  const current = jotaiStore.get(gameStatsByIdAtom).get(gameId)
  if (current && current.status !== 'missing') {
    return
  }
  jotaiStore.set(gameStatsByIdAtom, draft => {
    setGameStats(draft, gameId, { status: 'loading' })
  })

  let saved: SavedGameStats | null = null
  try {
    saved = (await ipcRenderer.invoke('gameStatsGet', gameId)) ?? null
  } catch (err) {
    logger.error(`Error loading the saved stats for game ${gameId}: ${getErrorStack(err)}`)
  }

  const replayPath = saved && getReplayPath(saved.source)
  const gameTime = replayPath ? await getReplayGameTime(replayPath) : undefined

  if (jotaiStore.get(gameStatsByIdAtom).get(gameId)?.status !== 'loading') {
    // Newer stats arrived while these were loading.
    return
  }
  jotaiStore.set(gameStatsByIdAtom, draft => {
    setGameStats(
      draft,
      gameId,
      saved
        ? {
            status: 'done',
            source: saved.source,
            stats: fromGameStatsPayload(saved.stats),
            // A replay that's gone or can't be read is dated by when its file was last written,
            // which is as the game ended unless something moved or archived it since.
            playedAtMs: gameTime ?? saved.replayFile?.modifiedMs ?? saved.savedAt,
          }
        : { status: 'missing' },
    )
  })
}
