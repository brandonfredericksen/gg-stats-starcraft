import { EventEmitter } from 'node:events'
import { LiveGamePlayer, LiveMatchFound } from '../../common/live-game'
import { tilesetFromEra, TilesetId } from '../../common/maps'
import { RaceChar } from '../../common/races'

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
/** The log ShieldBattery itself writes, which follows a match from when it's found. */
export const APP_LOG = 'app.0.log'
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
/** Written as a game launches. The game's setup follows on the next line, as JSON in quotes. */
const SETUP_MARKER = Buffer.from("Received message: 'setupGame':", 'latin1')
/** Written as a game ends, once the game thread has its results. */
const END_MARKER = Buffer.from('Got results from game thread', 'latin1')
const NEWLINE = 0x0a
/** A line of ShieldBattery's own log: when, how much it matters, then what happened. */
const APP_LINE = /^\[[^\]]+\]\t<\w+>\t(.*)$/
const MATCH_FOUND = /^Match found, showing accept dialog\. .*?(\d+) \/ (\d+) accepted/
const PLAYER_ACCEPTED = /^Player accepted, (\d+) players now ready/
const DRAFT_STARTED = 'Draft started'
const MATCH_READY = 'Match is now ready'
/** Written when a match falls through before its game starts, or while it loads. */
const MATCH_CANCELED = [
  'Timed out accepting match',
  'Draft canceled',
  'Match loading canceled',
  'Re-entered matchmaking queue',
]
const PLAYER =
  /JoinedPlayer \{ name: "((?:[^"\\]|\\.)*)", [^}]*?player_id: (?:Some\(BwPlayerId\((\d+)\)\)|None)[^}]*?sb_user_id: SbUserId\((\d+)\)/g

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

/** The map a game is on, as far as its setup says. */
export interface GameMap {
  mapName?: string
  tileset?: TilesetId
}

/** What a game's setup says about each player, by their ShieldBattery user id. */
export interface GameSetup {
  map: GameMap
  players: ReadonlyMap<number, Pick<LiveGamePlayer, 'team' | 'race' | 'shieldBattery'>>
}

/** Game types whose players are split into teams. In the rest, everyone is on their own. */
const TEAM_GAME_TYPES: ReadonlySet<string> = new Set(['topVBottom', 'teamMelee', 'teamFfa', 'ums'])
const RACES: ReadonlySet<string> = new Set(['p', 't', 'z', 'r'])

interface SetupJson {
  gameType?: string
  map?: { name?: string; mapData?: { tileset?: number } }
  slots?: Array<{ type?: string; race?: string; teamId?: number; userId?: number }>
  ranks?: Array<{ userId?: number; rating?: number; division?: string }>
}

/**
 * The setup line ShieldBattery's game DLL writes as a game launches: its JSON, in single quotes.
 * Undefined for a line that isn't one, or a setup with nobody's race in it, like a replay's.
 */
export function parseGameSetup(line: string): GameSetup | undefined {
  const start = line.indexOf("'{")
  const end = line.lastIndexOf("}'")
  if (start === -1 || end < start) {
    return undefined
  }
  let json: SetupJson
  try {
    json = JSON.parse(line.slice(start + 1, end + 1))
  } catch {
    return undefined
  }
  const teams = TEAM_GAME_TYPES.has(json.gameType ?? '')
  const ranks = new Map((json.ranks ?? []).map(r => [r.userId, r]))
  const players = new Map<number, Pick<LiveGamePlayer, 'team' | 'race' | 'shieldBattery'>>()
  ;(json.slots ?? []).forEach((slot, i) => {
    if (slot.userId === undefined || slot.type === 'observer' || !RACES.has(slot.race ?? '')) {
      return
    }
    const rank = ranks.get(slot.userId)
    players.set(slot.userId, {
      team: teams ? slot.teamId : i,
      race: slot.race as RaceChar,
      shieldBattery:
        rank?.rating === undefined
          ? undefined
          : { rating: Math.round(rank.rating), division: rank.division },
    })
  })
  return players.size
    ? {
        map: { mapName: json.map?.name, tileset: tilesetFromEra(json.map?.mapData?.tileset) },
        players,
      }
    : undefined
}

/**
 * The players in a line where ShieldBattery's game DLL lists who joined, as Rust's debug format
 * writes them, with their team and race from the game's setup. Players without a player id are
 * watching.
 */
export function parseJoinedPlayers(line: string, setup?: GameSetup): LiveGamePlayer[] {
  const players: LiveGamePlayer[] = []
  for (const match of line.matchAll(PLAYER)) {
    const name = unescapeRust(match[1])
    if (name) {
      const slot = match[2] === undefined ? undefined : Number(match[2])
      const shieldBatteryId = Number(match[3])
      const fromSetup = slot === undefined ? undefined : setup?.players.get(shieldBatteryId)
      players.push({
        name,
        slot,
        shieldBatteryId,
        observer: slot === undefined || undefined,
        ...fromSetup,
      })
    }
  }
  return players
}

/** What a line of ShieldBattery's own log says about a match, if anything. */
export type MatchmakingLine =
  | { kind: 'found'; accepted: number; playerCount: number }
  | { kind: 'accepted'; accepted: number }
  | { kind: 'drafting' }
  | { kind: 'starting' }
  | { kind: 'canceled' }

export function parseMatchmakingLine(line: string): MatchmakingLine | undefined {
  const message = APP_LINE.exec(line.trimEnd())?.[1]
  if (message === undefined) {
    return undefined
  }
  const found = MATCH_FOUND.exec(message)
  if (found) {
    return { kind: 'found', accepted: Number(found[1]), playerCount: Number(found[2]) }
  }
  const accepted = PLAYER_ACCEPTED.exec(message)
  if (accepted) {
    return { kind: 'accepted', accepted: Number(accepted[1]) }
  }
  if (message.startsWith(DRAFT_STARTED)) {
    return { kind: 'drafting' }
  }
  if (message.startsWith(MATCH_READY)) {
    return { kind: 'starting' }
  }
  return MATCH_CANCELED.some(m => message.startsWith(m)) ? { kind: 'canceled' } : undefined
}

export type ShieldBatteryLogWatcherEvents = {
  /** A ShieldBattery match was found, which hasn't loaded yet. */
  matchFound: [match: LiveMatchFound]
  /** The match that was found got further along. */
  matchChanged: [match: LiveMatchFound]
  /** The match fell through before its game started, or while it loaded. */
  matchCanceled: []
  /** Everyone in a ShieldBattery game that's loading, and its map as far as the setup said. */
  players: [players: LiveGamePlayer[], map?: GameMap]
  /** The game that was loading ended. */
  ended: []
  error: [err: unknown]
}

/** Reads what's added to one of ShieldBattery's logs, a full line at a time. */
class LogTail {
  /** Where the next read starts, or undefined until the log's size is first known. */
  private offset: number | undefined
  /** Which file `offset` is in. */
  private fileId: string | undefined
  /** The end of the last read, after its last full line. */
  private partialLine: Buffer = Buffer.alloc(0)

  constructor(
    private readonly files: LogFiles,
    readonly file: string,
  ) {}

  /**
   * The full lines written since the last read, if there are any. What's already there on the
   * first read is about games before the app started, so it's skipped.
   */
  async readNew(): Promise<Buffer | undefined> {
    const stats = await this.files.stat(this.file)
    if (stats === undefined) {
      // Missing from the start, the log made later is all new. Missing for a moment, like while
      // something else has it open, where reading was up to still holds, unless it comes back as
      // another file.
      if (this.offset === undefined) {
        this.offset = 0
      }
      return undefined
    }
    const { size, id } = stats
    if (this.offset === undefined) {
      this.offset = size
      this.fileId = id
      return undefined
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
      return undefined
    }
    const chunk = Buffer.allocUnsafe(this.partialLine.length + length)
    this.partialLine.copy(chunk)
    const read = await this.files.read(
      this.file,
      start,
      length,
      chunk.subarray(this.partialLine.length),
    )
    if (read === undefined) {
      return undefined
    }
    this.offset = start + read
    const text = chunk.subarray(0, this.partialLine.length + read)
    const lastNewline = text.lastIndexOf(NEWLINE)
    const rest = text.subarray(lastNewline + 1)
    // Copied, so the chunk it came from can be let go.
    this.partialLine = rest.length <= MAX_PARTIAL_LINE ? Buffer.from(rest) : Buffer.alloc(0)
    return text.subarray(0, lastNewline + 1)
  }
}

/**
 * Watches ShieldBattery's logs: its own, which follows a matchmaking match from when it's found
 * without naming anyone, and its game DLL's, which lists who joined as the game loads. Only what's
 * written after it starts counts, and only new bytes are ever read.
 */
export class ShieldBatteryLogWatcher extends EventEmitter<ShieldBatteryLogWatcherEvents> {
  private stopWatching: (() => void) | undefined
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private readTimer: ReturnType<typeof setTimeout> | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private reading = false
  private changedWhileReading = false
  private appLog: LogTail
  private gameLog: LogTail
  private stopped = true
  /** The match found and not loaded yet, as far as ShieldBattery's own log says. */
  private match: LiveMatchFound | undefined
  /** The latest game's setup, until its players join. */
  private setup: GameSetup | undefined
  /** The last read ended with a setup's first line: the next starts with its JSON. */
  private setupNext = false
  /** Changes when stopped, so a read still going then lets its results go. */
  private generation = 0

  constructor(private readonly files: LogFiles) {
    super()
    this.appLog = new LogTail(files, APP_LOG)
    this.gameLog = new LogTail(files, GAME_LOG)
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
    this.appLog = new LogTail(this.files, APP_LOG)
    this.gameLog = new LogTail(this.files, GAME_LOG)
    this.match = undefined
    this.setup = undefined
    this.setupNext = false
  }

  private watch() {
    try {
      this.stopWatching = this.files.watch(
        file => {
          const name = file.toLowerCase()
          if (name === GAME_LOG || name === APP_LOG) {
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
    // Not a debounce: the game log is written to constantly during a game, and a debounce would
    // wait for it to stop.
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
      // The match goes before the game it becomes: a match is ready just before its game loads,
      // and both can land in the same read.
      const { appLog, gameLog } = this
      const appLines = await appLog.readNew()
      if (generation !== this.generation) {
        return
      }
      if (appLines) {
        this.findMatches(appLines)
      }
      const gameLines = await gameLog.readNew()
      if (generation !== this.generation) {
        return
      }
      if (gameLines) {
        this.findGames(gameLines)
      }
    } finally {
      this.reading = false
      if (this.changedWhileReading) {
        this.changedWhileReading = false
        this.noticeChange()
      }
    }
  }

  /** Reports where the latest match in `lines` got to, or that it fell through. */
  private findMatches(lines: Buffer) {
    const before = this.match
    let found = false
    for (const line of lines.toString('utf8').split('\n')) {
      const parsed = parseMatchmakingLine(line)
      if (!parsed) {
        continue
      }
      if (parsed.kind === 'found') {
        this.match = {
          playerCount: parsed.playerCount,
          accepted: parsed.accepted,
          phase: 'accepting',
        }
        found = true
      } else if (parsed.kind === 'canceled') {
        this.match = undefined
        found = false
      } else if (this.match) {
        this.match =
          parsed.kind === 'accepted'
            ? { ...this.match, accepted: parsed.accepted }
            : { ...this.match, accepted: this.match.playerCount, phase: parsed.kind }
      }
    }
    if (found) {
      this.emit('matchFound', this.match!)
    } else if (this.match !== before) {
      if (this.match) {
        this.emit('matchChanged', this.match)
      } else {
        this.emit('matchCanceled')
      }
    }
  }

  /**
   * Reports the latest game in `lines` to start loading, with what its setup said, and whether a
   * game ended after it.
   */
  private findGames(lines: Buffer) {
    let latest: LiveGamePlayer[] | undefined
    let latestMap: GameMap | undefined
    let latestAt = -1
    let at = 0
    if (this.setupNext) {
      this.setupNext = false
      const end = lines.indexOf(NEWLINE)
      this.setup = parseGameSetup(lines.toString('utf8', 0, end === -1 ? lines.length : end))
    }
    for (;;) {
      const setupAt = lines.indexOf(SETUP_MARKER, at)
      const joinedAt = lines.indexOf(MARKER, at)
      if (setupAt === -1 && joinedAt === -1) {
        break
      }
      if (setupAt !== -1 && (joinedAt === -1 || setupAt < joinedAt)) {
        const lineEnd = lines.indexOf(NEWLINE, setupAt)
        if (lineEnd === -1 || lineEnd + 1 >= lines.length) {
          this.setup = undefined
          this.setupNext = lineEnd !== -1
          break
        }
        const jsonEnd = lines.indexOf(NEWLINE, lineEnd + 1)
        this.setup = parseGameSetup(
          lines.toString('utf8', lineEnd + 1, jsonEnd === -1 ? lines.length : jsonEnd),
        )
        if (jsonEnd === -1) {
          break
        }
        at = jsonEnd
        continue
      }
      const end = lines.indexOf(NEWLINE, joinedAt)
      const players = parseJoinedPlayers(
        lines.toString('utf8', joinedAt, end === -1 ? lines.length : end),
        this.setup,
      )
      if (players.length) {
        latest = players
        latestMap = this.setup?.map
        latestAt = joinedAt
        this.setup = undefined
      }
      if (end === -1) {
        break
      }
      at = end
    }
    if (latest) {
      // The match, if there was one, is this game now.
      this.match = undefined
      this.emit('players', latest, latestMap)
    }
    if (lines.lastIndexOf(END_MARKER) > latestAt) {
      this.emit('ended')
    }
  }
}
