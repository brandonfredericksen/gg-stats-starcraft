import { EventEmitter } from 'node:events'

/** Watches the folder StarCraft saves replays to. */
export interface ReplayFolder {
  /** When the file was last changed, or undefined if it isn't there. */
  modifiedMs: (file: string) => Promise<number | undefined>
  /**
   * Calls `onChange` with the name of each file that changes in the folder, and `onError` if
   * watching fails later, returning a function that stops. Throws if the folder isn't there.
   */
  watch: (onChange: (file: string) => void, onError: () => void) => () => void
}

/** The replay StarCraft saves after every game, over the one before. */
export const LAST_REPLAY = 'lastreplay.rep'
/** How long after a change the replay is checked, letting StarCraft finish writing it. */
export const CHECK_DELAY_MS = 1000
/** How often watching is tried again while the folder isn't there. */
export const RETRY_WATCH_MS = 60_000

export type ReplaySavedWatcherEvents = {
  /** A game ended: its replay was saved at `savedMs`. */
  saved: [savedMs: number]
}

/**
 * Notices each game ending by StarCraft saving its replay. It only listens for the folder changing,
 * so it costs nothing until a replay is saved.
 */
export class ReplaySavedWatcher extends EventEmitter<ReplaySavedWatcherEvents> {
  private stopWatching: (() => void) | undefined
  private checkTimer: ReturnType<typeof setTimeout> | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  /** When the replay there was saved, so only a newer one counts. */
  private lastSavedMs: number | undefined
  private generation = 0
  private stopped = true

  constructor(private readonly folder: ReplayFolder) {
    super()
  }

  start() {
    if (!this.stopped) {
      return
    }
    this.stopped = false
    this.watch()
    this.scheduleCheck()
  }

  stop() {
    this.stopped = true
    this.generation += 1
    this.stopWatching?.()
    this.stopWatching = undefined
    clearTimeout(this.checkTimer)
    clearTimeout(this.retryTimer)
    this.checkTimer = undefined
    this.retryTimer = undefined
    this.lastSavedMs = undefined
  }

  private watch() {
    try {
      this.stopWatching = this.folder.watch(
        file => {
          if (file.toLowerCase() === LAST_REPLAY) {
            this.scheduleCheck()
          }
        },
        () => {
          this.stopWatching?.()
          this.stopWatching = undefined
          this.retryWatch()
        },
      )
    } catch {
      // StarCraft hasn't made its replay folder yet.
      this.retryWatch()
    }
  }

  private retryWatch() {
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      if (!this.stopped) {
        this.watch()
        this.scheduleCheck()
      }
    }, RETRY_WATCH_MS)
    this.retryTimer.unref?.()
  }

  private scheduleCheck() {
    if (this.stopped || this.checkTimer) {
      return
    }
    this.checkTimer = setTimeout(() => {
      this.checkTimer = undefined
      const generation = this.generation
      this.folder.modifiedMs(LAST_REPLAY).then(
        savedMs => {
          if (generation !== this.generation) {
            return
          }
          if (savedMs === undefined) {
            // No replay yet: the first one saved is new.
            this.lastSavedMs ??= 0
            return
          }
          // The first look only learns which replay was there already.
          const known = this.lastSavedMs
          this.lastSavedMs = savedMs
          if (known !== undefined && savedMs > known) {
            this.emit('saved', savedMs)
          }
        },
        () => {
          // Busy being written: the change it's making brings another check.
        },
      )
    }, CHECK_DELAY_MS)
    this.checkTimer.unref?.()
  }
}
