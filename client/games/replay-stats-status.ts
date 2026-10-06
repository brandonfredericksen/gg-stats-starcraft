import { atom, useAtomValue } from 'jotai'
import { atomWithImmer } from 'jotai-immer'
import { useEffect } from 'react'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { GameStatsSummary } from '../../common/games/game-stats'
import { AutoCaptureStatus, TypedIpcRenderer } from '../../common/ipc'
import { jotaiStore } from '../jotai-store'
import { gameStatsByIdAtom } from './game-stats-atoms'

const ipcRenderer = new TypedIpcRenderer()

/** Replay paths as Windows compares them, so two spellings of one file match. */
export function normalizeReplayPath(replayPath: string) {
  return replayPath.replace(/\//g, '\\').toLowerCase()
}

/** Saved stats summaries by normalized replay path, or null for a replay known to have none. */
const replaySummariesAtom = atomWithImmer<ReadonlyMap<string, GameStatsSummary | null>>(new Map())

export const autoCaptureStatusAtom = atom<AutoCaptureStatus>({
  enabled: false,
  paused: false,
  pausedByUser: false,
  queued: [],
  failed: [],
})

/** Looks up the saved stats of the replays at `paths`, skipping ones already looked up. */
export async function loadReplaySummaries(paths: ReadonlyArray<string>, force = false) {
  const known = jotaiStore.get(replaySummariesAtom)
  const wanted = force ? paths : paths.filter(p => !known.has(normalizeReplayPath(p)))
  if (!wanted.length) {
    return
  }
  const found = (await ipcRenderer.invoke('gameStatsSummarizeReplays', [...wanted])) ?? {}
  jotaiStore.set(replaySummariesAtom, draft => {
    for (const p of wanted) {
      draft.set(normalizeReplayPath(p), found[p] ?? null)
    }
  })
}

/** Keeps the summaries of `paths` loaded. */
export function useReplaySummaries(paths: ReadonlyArray<string>) {
  const key = paths.join('|')
  useEffect(() => {
    loadReplaySummaries(key ? key.split('|') : []).catch(swallowNonBuiltins)
  }, [key])
}

export type ReplayStatsStatus =
  | { kind: 'ready'; summary: GameStatsSummary }
  | { kind: 'analyzing'; gameId?: string }
  | { kind: 'queued' }
  | { kind: 'failed' }
  | { kind: 'none' }

const replayStatsStatusAtom = atom(get => {
  const summaries = get(replaySummariesAtom)
  const capture = get(autoCaptureStatusAtom)
  const analyses = get(gameStatsByIdAtom)

  const analyzing = new Map<string, string>()
  const failed = new Set(capture.failed.map(normalizeReplayPath))
  for (const [gameId, state] of analyses) {
    if (state.status === 'analyzing') {
      analyzing.set(normalizeReplayPath(state.source.path), gameId)
    } else if (state.status === 'failed') {
      failed.add(normalizeReplayPath(state.source.path))
    }
  }
  const running = capture.running ? normalizeReplayPath(capture.running) : undefined
  const queued = new Set(capture.queued.map(normalizeReplayPath))

  return (replayPath: string): ReplayStatsStatus => {
    const key = normalizeReplayPath(replayPath)
    const gameId = analyzing.get(key)
    if (gameId || key === running) {
      return { kind: 'analyzing', gameId }
    }
    const summary = summaries.get(key)
    if (summary) {
      return { kind: 'ready', summary }
    }
    if (queued.has(key)) {
      return { kind: 'queued' }
    }
    if (failed.has(key)) {
      return { kind: 'failed' }
    }
    return { kind: 'none' }
  }
})

export function useReplayStatsStatus(replayPath: string | undefined): ReplayStatsStatus {
  const getStatus = useAtomValue(replayStatsStatusAtom)
  return replayPath ? getStatus(replayPath) : { kind: 'none' }
}

export function registerReplayStatsStatusHandlers() {
  ipcRenderer.on('autoCaptureStatusChanged', (_, status) => {
    jotaiStore.set(autoCaptureStatusAtom, status)
  })
  ipcRenderer.on('activeGameStats', (_, _gameId, _stats, source) => {
    const replayPath = source.kind === 'replay' ? source.path : source.replayPath
    if (replayPath) {
      loadReplaySummaries([replayPath], true).catch(swallowNonBuiltins)
    }
  })
  ipcRenderer.on('activeGameReplaySaved', (_, _gameId, replayPath) => {
    loadReplaySummaries([replayPath], true).catch(swallowNonBuiltins)
  })
  ipcRenderer
    .invoke('autoCaptureGetStatus')
    ?.then(status => jotaiStore.set(autoCaptureStatusAtom, status))
    .catch(swallowNonBuiltins)
}
