import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameStatsPayload, ReplayStatsSource, SavedGameStats } from '../../common/games/game-stats'
import { jotaiStore } from '../jotai-store'
import {
  cancelReplayAnalysisAtom,
  failReplayAnalysisAtom,
  findRunningAnalysis,
  gameStatsByIdAtom,
  loadSavedGameStats,
  showGameStatsAtom,
  startReplayAnalysisAtom,
  updateRunningAnalysesAtom,
} from './game-stats-atoms'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('../../common/ipc', () => ({
  TypedIpcRenderer: class {
    invoke = invoke
  },
}))
vi.mock('../logging/logger', () => ({ default: { error: () => {} } }))

const STATS: GameStatsPayload = {
  mapName: 'Polypoid',
  frames: 100,
  complete: true,
  snapshotFrames: [],
  players: [],
}

function replay(path = 'C:\\Replays\\game.rep'): ReplayStatsSource {
  return { kind: 'replay', name: 'game.rep', path }
}

function statusOf(gameId: string) {
  return jotaiStore.get(gameStatsByIdAtom).get(gameId)?.status
}

function playedAtOf(gameId: string) {
  const state = jotaiStore.get(gameStatsByIdAtom).get(gameId)
  return state?.status === 'done' ? state.playedAtMs : undefined
}

describe('client/games/game-stats-atoms', () => {
  beforeEach(() => {
    jotaiStore.set(gameStatsByIdAtom, new Map())
    invoke.mockReset()
  })

  test('fails an analysis that stops before reporting, but not one that reported', () => {
    jotaiStore.set(startReplayAnalysisAtom, { gameId: 'a', replay: replay() })
    jotaiStore.set(updateRunningAnalysesAtom, { gameId: 'a', state: 'playing' })
    jotaiStore.set(startReplayAnalysisAtom, { gameId: 'b', replay: replay() })
    jotaiStore.set(showGameStatsAtom, { gameId: 'b', source: replay(), stats: STATS })

    jotaiStore.set(failReplayAnalysisAtom, { gameId: 'a', reason: 'stopped' })
    jotaiStore.set(failReplayAnalysisAtom, { gameId: 'b', reason: 'stopped' })

    expect(jotaiStore.get(gameStatsByIdAtom).get('a')).toMatchObject({
      status: 'failed',
      reason: 'stopped',
    })
    expect(statusOf('b')).toBe('done')
  })

  test('fails an analysis that another game replaced once it had started', () => {
    jotaiStore.set(startReplayAnalysisAtom, { gameId: 'old', replay: replay() })
    jotaiStore.set(updateRunningAnalysesAtom, { gameId: 'old', state: 'playing' })
    jotaiStore.set(startReplayAnalysisAtom, { gameId: 'new', replay: replay() })

    jotaiStore.set(updateRunningAnalysesAtom, { gameId: 'new', state: 'launching' })

    expect(jotaiStore.get(gameStatsByIdAtom).get('old')).toMatchObject({ reason: 'replaced' })
    expect(jotaiStore.get(gameStatsByIdAtom).get('new')).toMatchObject({
      status: 'analyzing',
      launched: true,
    })
  })

  test("doesn't fail an analysis for a game that started before it did", () => {
    // Like a second click on Analyze while the first analysis is still starting.
    jotaiStore.set(startReplayAnalysisAtom, { gameId: 'first', replay: replay() })
    jotaiStore.set(startReplayAnalysisAtom, { gameId: 'second', replay: replay() })

    jotaiStore.set(updateRunningAnalysesAtom, { gameId: 'first', state: 'launching' })

    expect(statusOf('first')).toBe('analyzing')
    expect(statusOf('second')).toBe('analyzing')
  })

  test('forgets a canceled analysis and finds running ones by their replay', () => {
    jotaiStore.set(startReplayAnalysisAtom, { gameId: 'a', replay: replay('C:\\a.rep') })
    expect(findRunningAnalysis('C:\\a.rep')).toBe('a')
    expect(findRunningAnalysis('C:\\b.rep')).toBeUndefined()

    jotaiStore.set(cancelReplayAnalysisAtom, 'a')
    expect(statusOf('a')).toBeUndefined()
    expect(findRunningAnalysis('C:\\a.rep')).toBeUndefined()
  })

  test('only keeps the most recent stats, never dropping a running analysis', () => {
    jotaiStore.set(startReplayAnalysisAtom, { gameId: 'running', replay: replay() })
    for (let i = 0; i < 30; i++) {
      jotaiStore.set(showGameStatsAtom, { gameId: `game-${i}`, source: replay(), stats: STATS })
    }

    const cached = jotaiStore.get(gameStatsByIdAtom)
    expect(cached.size).toBe(20)
    expect(cached.has('running')).toBe(true)
    expect(cached.has('game-0')).toBe(false)
    expect(cached.has('game-29')).toBe(true)
  })

  test('loads saved stats, and looks again for ones that were missing', async () => {
    invoke.mockResolvedValueOnce(null)
    await loadSavedGameStats('game-1')
    expect(statusOf('game-1')).toBe('missing')

    const saved: SavedGameStats = {
      version: 1,
      gameId: 'game-1',
      savedAt: 1,
      source: { kind: 'game' },
      stats: STATS,
    }
    invoke.mockResolvedValueOnce(saved)
    await loadSavedGameStats('game-1')
    expect(statusOf('game-1')).toBe('done')

    await loadSavedGameStats('game-1')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  test('keeps stats that arrive while saved ones are loading', async () => {
    let resolve: (saved: SavedGameStats | null) => void = () => {}
    invoke.mockReturnValueOnce(new Promise(r => (resolve = r)))
    const loading = loadSavedGameStats('game-1')
    expect(statusOf('game-1')).toBe('loading')

    jotaiStore.set(showGameStatsAtom, {
      gameId: 'game-1',
      source: { kind: 'game' },
      stats: { ...STATS, mapName: 'Fresh' },
    })
    resolve(null)
    await loading

    const state = jotaiStore.get(gameStatsByIdAtom).get('game-1')
    expect(state?.status === 'done' && state.stats.mapName).toBe('Fresh')
  })

  test("dates stats by when the replay's game started, not when its file changed", async () => {
    const gameStartSeconds = 1_790_000_000
    const saved: SavedGameStats = {
      version: 1,
      gameId: 'saved',
      savedAt: 3,
      source: replay(),
      replayFile: { size: 1, modifiedMs: 2 },
      stats: STATS,
    }
    invoke.mockImplementation(async (channel: string) =>
      channel === 'gameStatsGet' ? saved : { headerData: { startTime: gameStartSeconds } },
    )

    await loadSavedGameStats('saved')
    jotaiStore.set(showGameStatsAtom, { gameId: 'analyzed', source: replay(), stats: STATS })
    await vi.waitFor(() => expect(playedAtOf('analyzed')).toBeDefined())

    expect(invoke).toHaveBeenCalledWith('replayParseMetadata', replay().path)
    expect(playedAtOf('saved')).toBe(gameStartSeconds * 1000)
    expect(playedAtOf('analyzed')).toBe(gameStartSeconds * 1000)
  })

  test("dates saved stats by the replay file when the replay can't be read", async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'gameStatsGet') {
        return {
          version: 1,
          gameId: 'saved',
          savedAt: 3,
          source: replay(),
          replayFile: { size: 1, modifiedMs: 2 },
          stats: STATS,
        } satisfies SavedGameStats
      }
      throw new Error('Replay is gone')
    })

    await loadSavedGameStats('saved')

    expect(playedAtOf('saved')).toBe(2)
  })

  test('fails an analysis that stopped before its replay loaded as not loading', () => {
    jotaiStore.set(startReplayAnalysisAtom, { gameId: 'a', replay: replay() })
    jotaiStore.set(updateRunningAnalysesAtom, { gameId: 'a', state: 'launching' })

    jotaiStore.set(failReplayAnalysisAtom, { gameId: 'a', reason: 'stopped' })

    expect(jotaiStore.get(gameStatsByIdAtom).get('a')).toMatchObject({ reason: 'launch' })
  })
})
