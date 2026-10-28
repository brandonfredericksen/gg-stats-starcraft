import { getErrorStack } from '../../common/errors'
import { FINGERPRINT_VERSION, GameFingerprint } from '../../common/games/fingerprint'
import type { ReplayLibraryLogger } from './replay-watcher'

/** How many replays are looked up at a time. */
const BATCH_SIZE = 50
/** A pause between replays, so the worker answers the app's queries in between. */
const PAUSE_MS = 20
/** How long to wait while the library is still being indexed, before looking again. */
const INDEXING_WAIT_MS = 5_000

/** What the backfill reads from and writes to the replay index. */
export interface FingerprintStore {
  listUnfingerprinted(version: number, limit: number): Array<{ id: number; path: string }>
  saveFingerprints(replayId: number, version: number, prints: ReadonlyArray<GameFingerprint>): void
}

/**
 * Reads how the players in each indexed replay played, one replay at a time, the newest first, once
 * indexing is done, so players' pages can find their other names. A replay that can't be read is
 * marked read with no fingerprints, and isn't tried again until its file changes.
 */
export class FingerprintBackfill {
  private running = false
  private again = false
  private timer: ReturnType<typeof setTimeout> | undefined
  /** Replays whose fingerprints couldn't be saved, left alone until the worker restarts. */
  private readonly failed = new Set<number>()

  constructor(
    private readonly store: FingerprintStore,
    private readonly readFingerprints: (path: string) => Promise<GameFingerprint[]>,
    /** Whether the library is being indexed, which goes first. */
    private readonly isIndexing: () => boolean,
    /** Called after each batch that saved anything. */
    private readonly onSaved: () => void,
    private readonly logger: ReplayLibraryLogger,
  ) {}

  /** Looks for replays to read soon, like after the library changed. */
  schedule(delayMs = PAUSE_MS) {
    if (this.running) {
      this.again = true
      return
    }
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.run().catch(err => {
        this.logger.error(`Error reading replay fingerprints: ${getErrorStack(err)}`)
      })
    }, delayMs)
  }

  private async run() {
    if (this.isIndexing()) {
      this.schedule(INDEXING_WAIT_MS)
      return
    }
    this.running = true
    try {
      for (;;) {
        const batch = this.store
          .listUnfingerprinted(FINGERPRINT_VERSION, BATCH_SIZE + this.failed.size)
          .filter(({ id }) => !this.failed.has(id))
          .slice(0, BATCH_SIZE)
        if (!batch.length) {
          break
        }
        for (const { id, path } of batch) {
          let prints: GameFingerprint[] = []
          try {
            prints = await this.readFingerprints(path)
          } catch (err) {
            this.logger.verbose(`Couldn't read the fingerprints of ${path}: ${getErrorStack(err)}`)
          }
          try {
            this.store.saveFingerprints(id, FINGERPRINT_VERSION, prints)
          } catch (err) {
            // Like a replay removed from the index while it was being read.
            this.failed.add(id)
            this.logger.verbose(`Couldn't save the fingerprints of ${path}: ${getErrorStack(err)}`)
          }
          await new Promise(resolve => setTimeout(resolve, PAUSE_MS))
        }
        this.onSaved()
        if (this.isIndexing()) {
          this.again = true
          break
        }
      }
    } finally {
      this.running = false
      if (this.again) {
        this.again = false
        this.schedule(this.isIndexing() ? INDEXING_WAIT_MS : PAUSE_MS)
      }
    }
  }
}
