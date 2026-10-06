import { EventEmitter } from 'node:events'
import path from 'node:path'

/** The size and last modified time of a file, which tell different versions of it apart. */
export interface FileSignature {
  size: number
  modifiedMs: number
}

export interface DetectorDeps {
  stat: (filePath: string) => Promise<FileSignature | undefined>
  readFile: (filePath: string) => Promise<Buffer>
  /**
   * Watches a folder (not its subfolders), calling `onChange` with the name of a file that changed.
   * Returns a function that stops watching.
   */
  watchFolder: (folder: string, onChange: (fileName: string) => void) => () => void
}

/** How long the file has to go without changes before it's checked. */
export const QUIET_MS = 1500
/** How far apart the two checks that must agree are. */
export const SETTLE_MS = 1000
/** How often the file is checked when no change was noticed, in case watching missed one. */
export const POLL_MS = 15_000
/** Waits between attempts to read a file that's busy, like while StarCraft is still writing it. */
export const READ_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000]

function sameSignature(a: FileSignature | undefined, b: FileSignature | undefined) {
  return !!a && !!b && a.size === b.size && a.modifiedMs === b.modifiedMs
}

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

export type LastReplayDetectorEvents = {
  /** A new version of the file, read once it stopped changing. */
  replay: [data: Buffer, signature: FileSignature]
  error: [err: unknown]
}

/**
 * Notices each new version of the replay StarCraft saves after every game (`LastReplay.rep`) and
 * reads it once it's done being written.
 */
export class LastReplayDetector extends EventEmitter<LastReplayDetectorEvents> {
  private stopWatching: (() => void) | undefined
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private quietTimer: ReturnType<typeof setTimeout> | undefined
  private checking = false
  /** Whether a change was noticed while a check was running, so another check must follow. */
  private changedWhileChecking = false

  /** `lastSeen` is the version already handled, which is left alone if it's still there. */
  constructor(
    private readonly filePath: string,
    private readonly deps: DetectorDeps,
    private lastSeen?: FileSignature,
  ) {
    super()
  }

  start() {
    const fileName = path.basename(this.filePath).toLowerCase()
    this.stopWatching = this.deps.watchFolder(path.dirname(this.filePath), changed => {
      if (changed.toLowerCase() === fileName) {
        this.noticeChange()
      }
    })
    this.pollTimer = setInterval(() => this.noticeChange(), POLL_MS)
    this.noticeChange()
  }

  stop() {
    this.stopWatching?.()
    this.stopWatching = undefined
    clearInterval(this.pollTimer)
    clearTimeout(this.quietTimer)
  }

  private noticeChange() {
    if (this.checking) {
      this.changedWhileChecking = true
      return
    }
    clearTimeout(this.quietTimer)
    this.quietTimer = setTimeout(() => {
      this.check().catch(err => this.emit('error', err))
    }, QUIET_MS)
  }

  private async check() {
    this.checking = true
    try {
      await this.checkNow()
    } finally {
      this.checking = false
      if (this.changedWhileChecking) {
        this.changedWhileChecking = false
        this.noticeChange()
      }
    }
  }

  private async checkNow() {
    const first = await this.deps.stat(this.filePath)
    if (!first || sameSignature(first, this.lastSeen)) {
      return
    }
    await delay(SETTLE_MS)
    const second = await this.deps.stat(this.filePath)
    if (!sameSignature(first, second)) {
      // Still being written, or replaced again.
      this.changedWhileChecking = true
      return
    }

    for (let attempt = 0; ; attempt++) {
      try {
        const data = await this.deps.readFile(this.filePath)
        if (data.length !== second!.size) {
          this.changedWhileChecking = true
          return
        }
        this.lastSeen = second
        this.emit('replay', data, second!)
        return
      } catch (err) {
        if (attempt >= READ_RETRY_DELAYS_MS.length) {
          throw err
        }
        await delay(READ_RETRY_DELAYS_MS[attempt])
      }
    }
  }
}
