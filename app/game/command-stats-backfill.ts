import { getErrorStack } from '../../common/errors'
import { ReplayCommandStats } from '../../common/games/command-stats'
import log from '../logger'
import { GameStatsStore } from './game-stats-store'

/** How long to wait before starting, so reading replays doesn't slow the app down as it opens. */
const START_DELAY_MS = 30_000
/** A pause between replays, so reading them stays in the background. */
const PAUSE_MS = 250

/**
 * Reads the commands of replays whose stats were saved without them, one at a time, so hotkeys and
 * the like are known for games analyzed before they were read. Replays that can't be read are
 * left alone until the app restarts.
 */
export class CommandStatsBackfill {
  private running = false
  private again = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly failed = new Set<string>()

  constructor(
    private readonly store: GameStatsStore,
    private readonly readCommandStats: (replayPath: string) => Promise<ReplayCommandStats>,
    /** Called after a pass that saved anything, so the pages showing it can catch up. */
    private readonly onChanged: () => void,
  ) {}

  start() {
    this.schedule(START_DELAY_MS)
  }

  /** Looks for replays to read again soon, like after a game's stats were saved. */
  schedule(delayMs = PAUSE_MS) {
    if (this.running) {
      this.again = true
      return
    }
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.run().catch(err => {
        log.error(`Error reading replay commands: ${getErrorStack(err)}`)
      })
    }, delayMs)
    this.timer.unref?.()
  }

  /** Reads every replay still missing its commands, now, for a caller that waits on all of them. */
  async readAll() {
    clearTimeout(this.timer)
    this.timer = undefined
    while (this.running) {
      await new Promise(resolve => setTimeout(resolve, PAUSE_MS))
    }
    await this.run()
  }

  private async run() {
    this.running = true
    let saved = 0
    try {
      const missing = await this.store.listMissingCommandStats()
      for (const { gameId, replayPath } of missing) {
        if (this.failed.has(gameId)) {
          continue
        }
        try {
          await this.store.saveCommandStats(gameId, await this.readCommandStats(replayPath))
          saved += 1
        } catch (err) {
          this.failed.add(gameId)
          log.warning(`Couldn't read the commands of ${replayPath}: ${getErrorStack(err)}`)
        }
        await new Promise(resolve => setTimeout(resolve, PAUSE_MS))
      }
    } finally {
      this.running = false
      if (saved) {
        this.onChanged()
      }
      if (this.again) {
        this.again = false
        this.schedule()
      }
    }
  }
}
