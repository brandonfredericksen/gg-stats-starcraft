import { EventEmitter } from 'node:events'
import { AutoCaptureSummary } from '../../common/ipc'

/** A replay waiting to be analyzed automatically. */
export interface QueuedReplay {
  path: string
  /** What the stats page calls it until the replay's own details load. */
  name: string
  linkedGameId?: string
  /** The replay's recorded start time, which seeds the game. */
  seed: number
  summary: AutoCaptureSummary
  /** Failed analyses so far. */
  attempts: number
  /** When it may be tried again after a failure, in unix ms. */
  notBefore?: number
  /** Asked for by the user, so it's analyzed even while automatic capture is off. */
  manual?: boolean
}

export interface AnalysisQueueDeps {
  /** Starts analyzing a replay, returning its game id, or null if StarCraft is busy. */
  launch: (replay: QueuedReplay) => string | null
  /** Whether StarCraft is free for an analysis. */
  isIdle: () => boolean
  /** Saves the queue, so it survives the app restarting. */
  save: (replays: ReadonlyArray<QueuedReplay>) => void
}

/** How many times a replay is analyzed before it's left for the user to retry. */
export const MAX_ATTEMPTS = 2
/** How long a replay waits before it's analyzed again after a failure. */
export const RETRY_DELAY_MS = 30_000
/**
 * How many analyses in a row may fail before the queue stops trying. That many failures usually
 * means something is wrong with StarCraft itself, like an update the app doesn't support yet.
 */
export const MAX_CONSECUTIVE_FAILURES = 3

export type AnalysisOutcome = 'analyzed' | 'failed' | 'replaced'

export type AnalysisQueueEvents = {
  started: [gameId: string, replay: QueuedReplay]
  analyzed: [gameId: string, replay: QueuedReplay]
  /** Every attempt failed, so the replay is left for the user to retry. */
  gaveUp: [replay: QueuedReplay]
  /** Too many analyses failed in a row, so the queue stopped until it's resumed. */
  paused: []
}

/** Analyzes captured replays one at a time, whenever StarCraft is free. */
export class AnalysisQueue extends EventEmitter<AnalysisQueueEvents> {
  private replays: QueuedReplay[]
  private running: { gameId: string; replay: QueuedReplay } | undefined
  private consecutiveFailures = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private enabled = true
  private _paused = false
  private _held = false

  constructor(
    private readonly deps: AnalysisQueueDeps,
    saved: ReadonlyArray<QueuedReplay> = [],
  ) {
    super()
    this.replays = [...saved]
  }

  get paused() {
    return this._paused
  }

  /** Whether the user paused analyzing. Replays still wait, and the one running still finishes. */
  get held() {
    return this._held
  }

  get pending(): ReadonlyArray<QueuedReplay> {
    return this.replays
  }

  get runningGameId() {
    return this.running?.gameId
  }

  get runningReplay(): QueuedReplay | undefined {
    return this.running?.replay
  }

  /** Adds a replay to analyze, unless it's already waiting. */
  add(replay: Omit<QueuedReplay, 'attempts'>) {
    if (this.replays.some(r => r.path === replay.path)) {
      return
    }
    this.replays.push({ ...replay, attempts: 0 })
    this.save()
    this.tryStart()
  }

  /** Drops every replay that's waiting. The one being analyzed now still finishes. */
  clearWaiting() {
    const running = this.running?.replay
    this.replays = this.replays.filter(r => r === running)
    clearTimeout(this.retryTimer)
    this.save()
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled
    this.tryStart()
  }

  /** Stops starting new analyses until it's let go, without dropping any replay. */
  hold(held: boolean) {
    this._held = held
    if (held) {
      clearTimeout(this.retryTimer)
    } else {
      this.tryStart()
    }
  }

  /** Starts analyzing again after too many failures. */
  resume() {
    this._paused = false
    this.consecutiveFailures = 0
    this.tryStart()
  }

  /** Called whenever StarCraft may have become free. */
  tryStart() {
    if (this._held || this._paused || this.running || !this.deps.isIdle()) {
      return
    }
    const now = Date.now()
    const replay = this.replays.find(r => (this.enabled || r.manual) && (r.notBefore ?? 0) <= now)
    if (!replay) {
      this.scheduleRetry()
      return
    }
    const gameId = this.deps.launch(replay)
    if (gameId) {
      this.running = { gameId, replay }
      this.emit('started', gameId, replay)
    }
  }

  /** Reports how the analysis of `gameId` ended. Ignores games the queue didn't start. */
  finish(gameId: string, outcome: AnalysisOutcome) {
    if (this.running?.gameId !== gameId) {
      return
    }
    const { replay } = this.running
    this.running = undefined

    if (outcome === 'analyzed') {
      this.consecutiveFailures = 0
      this.remove(replay)
      this.emit('analyzed', gameId, replay)
    } else if (outcome === 'failed') {
      this.consecutiveFailures += 1
      replay.attempts += 1
      if (replay.attempts >= MAX_ATTEMPTS) {
        this.remove(replay)
        this.emit('gaveUp', replay)
      } else {
        replay.notBefore = Date.now() + RETRY_DELAY_MS
        this.save()
      }
      if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._paused = true
        this.emit('paused')
      }
    }
    // A replaced analysis just waits for StarCraft to be free again.
    this.tryStart()
  }

  stop() {
    clearTimeout(this.retryTimer)
  }

  private remove(replay: QueuedReplay) {
    this.replays = this.replays.filter(r => r !== replay)
    this.save()
  }

  private scheduleRetry() {
    clearTimeout(this.retryTimer)
    const next = Math.min(
      ...this.replays.filter(r => this.enabled || r.manual).map(r => r.notBefore ?? Infinity),
    )
    if (next !== Infinity) {
      this.retryTimer = setTimeout(() => this.tryStart(), Math.max(0, next - Date.now()))
    }
  }

  private save() {
    this.deps.save(this.replays)
  }
}
