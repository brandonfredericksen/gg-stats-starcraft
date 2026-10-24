import { EventEmitter } from 'node:events'
import { LiveGamePlayer } from '../../common/live-game'

/** Reads and watches the files in ShieldBattery's log folder. */
export interface LogFiles {
  /**
   * The file's size, and something that tells it from another file of the same name, like the one
   * a log rotates to. Undefined if it isn't there.
   */
  stat: (file: string) => Promise<{ size: number; id: string } | undefined>
  /** Reads up to `length` bytes at `position` into the start of `into`, returning how many were read. */
  read: (
    file: string,
    position: number,
    length: number,
    into: Uint8Array,
  ) => Promise<number | undefined>
  /**
   * Calls `onChange` with the name of each file that changes in the folder, and `onError` if
   * watching fails later, returning a function that stops. Throws if the folder isn't there.
   */
  watch: (onChange: (file: string) => void, onError: () => void) => () => void
}

/** The log ShieldBattery's game DLL writes, the newest of its rotated files. */
export const GAME_LOG = 'game.0.log'
/** How long after a change the log is read, gathering the lines written meanwhile. */
export const READ_DELAY_MS = 1000
/** How often the log is checked anyway, in case watching missed a change. */
export const POLL_MS = 15_000
/** How often watching is tried again while ShieldBattery's log folder isn't there. */
export const RETRY_WATCH_MS = 60_000
/** At most this much new log is read at once. A bigger jump only keeps its end. */
export const MAX_READ = 1024 * 1024
/** A line this long without an end isn't one this reads. */
const MAX_PARTIAL_LINE = 64 * 1024

const MARKER = Buffer.from('Netcode v2 joined players: [', 'latin1')
/** Written as a game ends, once the game thread has its results. */
const END_MARKER = Buffer.from('Got results from game thread', 'latin1')
const NEWLINE = 0x0a
const PLAYER =
  /JoinedPlayer \{ name: "((?:[^"\\]|\\.)*)", [^}]*?player_id: (Some|None)\b[^}]*?sb_user_id: SbUserId\((\d+)\)/g

function unescapeRust(text: string) {
  return text.replace(/\\(u\{([0-9a-fA-F]{1,6})\}|.)/g, (_, escape: string, code?: string) => {
    if (code) {
      const point = parseInt(code, 16)
      return point <= 0x10ffff ? String.fromCodePoint(point) : ''
    }
    switch (escape) {
      case 'n':
        return '\n'
      case 't':
        return '\t'
      case 'r':
        return '\r'
      case '0':
        return '\0'
      default:
        return escape
    }
  })
}

/**
 * The players in a line where ShieldBattery's game DLL lists who joined, as Rust's debug format
 * writes them. Players without a player id are watching.
 */
export function parseJoinedPlayers(line: string): LiveGamePlayer[] {
  const players: LiveGamePlayer[] = []
  for (const match of line.matchAll(PLAYER)) {
    const name = unescapeRust(match[1])
    if (name) {
      players.push({ name, observer: match[2] === 'None' || undefined })
    }
  }
  return players
}

export type ShieldBatteryLogWatcherEvents = {
  /** Everyone in a ShieldBattery game that's loading. */
  players: [players: LiveGamePlayer[]]
  /** The game that was loading ended. */
  ended: []
  error: [err: unknown]
}

/**
 * Watches ShieldBattery's game log for the line its game DLL writes as a game loads, listing who
 * joined. Only what's written after it starts counts, and only new bytes are ever read.
 */
export class ShieldBatteryLogWatcher extends EventEmitter<ShieldBatteryLogWatcherEvents> {
  private stopWatching: (() => void) | undefined
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private readTimer: ReturnType<typeof setTimeout> | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private reading = false
  private changedWhileReading = false
  /** Where the next read starts, or undefined until the log's size is first known. */
  private offset: number | undefined
  /** Which file `offset` is in. */
  private fileId: string | undefined
  /** The end of the last read, after its last full line. */
  private partialLine: Buffer = Buffer.alloc(0)
  private stopped = true
  /** Changes when stopped, so a read still going then lets its results go. */
  private generation = 0

  constructor(private readonly files: LogFiles) {
    super()
  }

  start() {
    if (!this.stopped) {
      return
    }
    this.stopped = false
    this.watch()
    this.pollTimer = setInterval(() => this.noticeChange(), POLL_MS)
    this.pollTimer.unref?.()
    this.noticeChange()
  }

  stop() {
    this.stopped = true
    this.generation += 1
    this.stopWatching?.()
    this.stopWatching = undefined
    clearInterval(this.pollTimer)
    clearTimeout(this.readTimer)
    clearTimeout(this.retryTimer)
    this.pollTimer = undefined
    this.readTimer = undefined
    this.retryTimer = undefined
    this.offset = undefined
    this.fileId = undefined
    this.partialLine = Buffer.alloc(0)
  }

  private watch() {
    try {
      this.stopWatching = this.files.watch(
        file => {
          if (file.toLowerCase() === GAME_LOG) {
            this.noticeChange()
          }
        },
        () => {
          // Like the folder being deleted. Polling notices changes meanwhile.
          this.stopWatching?.()
          this.stopWatching = undefined
          this.retryWatch()
        },
      )
    } catch {
      // ShieldBattery isn't installed, or hasn't logged anything yet.
      this.retryWatch()
    }
  }

  private retryWatch() {
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      if (!this.stopped) {
        this.watch()
      }
    }, RETRY_WATCH_MS)
    this.retryTimer.unref?.()
  }

  private noticeChange() {
    if (this.stopped) {
      return
    }
    if (this.reading) {
      this.changedWhileReading = true
      return
    }
    // Not a debounce: the log is written to constantly during a game, and a debounce would wait
    // for it to stop.
    if (!this.readTimer) {
      this.readTimer = setTimeout(() => {
        this.readTimer = undefined
        const generation = this.generation
        this.read(generation).catch(err => {
          // Nothing listens once stopped, and an `error` nobody listens to would throw.
          if (generation === this.generation && this.listenerCount('error')) {
            this.emit('error', err)
          }
        })
      }, READ_DELAY_MS)
      this.readTimer.unref?.()
    }
  }

  private async read(generation: number) {
    this.reading = true
    try {
      await this.readNew(generation)
    } finally {
      this.reading = false
      if (this.changedWhileReading) {
        this.changedWhileReading = false
        this.noticeChange()
      }
    }
  }

  private async readNew(generation: number) {
    const stats = await this.files.stat(GAME_LOG)
    if (generation !== this.generation) {
      return
    }
    if (stats === undefined) {
      // Missing from the start, the log made later is all new. Missing for a moment, like while
      // something else has it open, where reading was up to still holds, unless it comes back as
      // another file.
      if (this.offset === undefined) {
        this.offset = 0
      }
      return
    }
    const { size, id } = stats
    if (this.offset === undefined) {
      // What's already there is about games before the app started.
      this.offset = size
      this.fileId = id
      return
    }
    if (size < this.offset || (this.fileId !== undefined && id !== this.fileId)) {
      // A new file after the log rotated.
      this.offset = 0
      this.partialLine = Buffer.alloc(0)
    }
    this.fileId = id
    let start = this.offset
    if (size - start > MAX_READ) {
      start = size - MAX_READ
      this.partialLine = Buffer.alloc(0)
    }
    const length = size - start
    if (!length) {
      return
    }
    const chunk = Buffer.allocUnsafe(this.partialLine.length + length)
    this.partialLine.copy(chunk)
    const read = await this.files.read(
      GAME_LOG,
      start,
      length,
      chunk.subarray(this.partialLine.length),
    )
    if (generation !== this.generation || read === undefined) {
      return
    }
    this.offset = start + read
    const text = chunk.subarray(0, this.partialLine.length + read)
    const lastNewline = text.lastIndexOf(NEWLINE)
    const rest = text.subarray(lastNewline + 1)
    // Copied, so the chunk it came from can be let go.
    this.partialLine = rest.length <= MAX_PARTIAL_LINE ? Buffer.from(rest) : Buffer.alloc(0)
    this.findGames(text.subarray(0, lastNewline + 1))
  }

  /** Reports the latest game in `lines` to start loading, and whether a game ended after it. */
  private findGames(lines: Buffer) {
    let latest: LiveGamePlayer[] | undefined
    let latestAt = -1
    let at = lines.indexOf(MARKER)
    while (at !== -1) {
      const end = lines.indexOf(NEWLINE, at)
      const players = parseJoinedPlayers(
        lines.toString('utf8', at, end === -1 ? lines.length : end),
      )
      if (players.length) {
        latest = players
        latestAt = at
      }
      at = end === -1 ? -1 : lines.indexOf(MARKER, end)
    }
    if (latest) {
      this.emit('players', latest)
    }
    if (lines.lastIndexOf(END_MARKER) > latestAt) {
      this.emit('ended')
    }
  }
}
