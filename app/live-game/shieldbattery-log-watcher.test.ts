import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LiveGamePlayer } from '../../common/live-game'
import {
  GAME_LOG,
  LogFiles,
  MAX_READ,
  parseJoinedPlayers,
  READ_DELAY_MS,
  RETRY_WATCH_MS,
  ShieldBatteryLogWatcher,
} from './shieldbattery-log-watcher'

/** A joined players line as ShieldBattery's game DLL writes it, with made up names. */
function joinedLine(names: string[], observers: string[] = []) {
  const players = [
    ...names.map(
      (name, i) =>
        `JoinedPlayer { name: ${JSON.stringify(name)}, storm_id: StormPlayerId(${i}), player_id: Some(BwPlayerId(${i})), sb_user_id: SbUserId(${100 + i}) }`,
    ),
    ...observers.map(
      (name, i) =>
        `JoinedPlayer { name: ${JSON.stringify(name)}, storm_id: StormPlayerId(${10 + i}), player_id: None, sb_user_id: SbUserId(${200 + i}) }`,
    ),
  ]
  return (
    '[2026-10-24][19:42:45.306][src\\game_state.rs:1535][DEBUG] Netcode v2 joined players: [' +
    players.join(', ') +
    ']\n'
  )
}

const NOISE =
  '[2026-10-24][19:42:45.306][src\\bw_scr.rs:7129][DEBUG] Slot 0 has id 0, player_type 2\n'
const END =
  '[2026-10-24][19:55:13.747][src\\game_state.rs:1556][DEBUG] Got results from game thread: GameThreadResults {\n'

describe('parseJoinedPlayers', () => {
  test('reads every player, and who watches', () => {
    expect(parseJoinedPlayers(joinedLine(['alpha', 'beta'], ['gamma']))).toEqual([
      { name: 'alpha', slot: 0, observer: undefined },
      { name: 'beta', slot: 1, observer: undefined },
      { name: 'gamma', slot: undefined, observer: true },
    ])
  })

  test("undoes Rust's escapes in names", () => {
    const line =
      'Netcode v2 joined players: [JoinedPlayer { name: "a\\"b\\\\c\\u{e9}", storm_id: StormPlayerId(0), player_id: Some(BwPlayerId(0)), sb_user_id: SbUserId(1) }]'
    expect(parseJoinedPlayers(line)).toEqual([{ name: 'a"b\\cé', slot: 0, observer: undefined }])
  })

  test('reads nothing from another line', () => {
    expect(parseJoinedPlayers(NOISE)).toEqual([])
  })
})

class FakeLogs implements LogFiles {
  content: Buffer | undefined = Buffer.alloc(0)
  watching = false
  folderThere = true
  onChange: ((file: string) => void) | undefined
  bytesRead = 0

  append(text: string) {
    this.content = Buffer.concat([this.content ?? Buffer.alloc(0), Buffer.from(text)])
    this.onChange?.(GAME_LOG)
  }

  /** Changes when the log rotates to a new file. */
  fileId = 'first'

  stat = async () => {
    if (this.statFails) {
      this.statFails = false
      return undefined
    }
    return this.content ? { size: this.content.length, id: this.fileId } : undefined
  }

  read = async (_file: string, position: number, length: number, into: Uint8Array) => {
    if (!this.content) {
      return undefined
    }
    const part = this.content.subarray(position, position + length)
    into.set(part)
    this.bytesRead += part.length
    return part.length
  }

  onError: (() => void) | undefined
  /** Makes the next stat fail, like when something else has the file open. */
  statFails = false

  watch = (onChange: (file: string) => void, onError: () => void) => {
    if (!this.folderThere) {
      throw new Error('ENOENT')
    }
    this.watching = true
    this.onChange = onChange
    this.onError = onError
    return () => {
      this.watching = false
      this.onChange = undefined
    }
  }
}

async function settle() {
  await vi.advanceTimersByTimeAsync(READ_DELAY_MS)
}

async function setup(existing = '') {
  const logs = new FakeLogs()
  logs.content = Buffer.from(existing)
  const watcher = new ShieldBatteryLogWatcher(logs)
  const games: LiveGamePlayer[][] = []
  watcher.on('players', p => games.push(p))
  watcher.on('error', err => {
    throw err
  })
  watcher.start()
  await settle()
  return { logs, watcher, games }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ShieldBatteryLogWatcher', () => {
  test('ignores games logged before it started', async () => {
    const { games } = await setup(joinedLine(['old', 'game']))
    expect(games).toEqual([])
  })

  test('reports a game that starts loading', async () => {
    const { logs, games } = await setup(NOISE)
    logs.append(NOISE + joinedLine(['alpha', 'beta']) + NOISE)
    await settle()
    expect(games.map(g => g.map(p => p.name))).toEqual([['alpha', 'beta']])
  })

  test('says when the game ends, but not for a game that started after the end', async () => {
    const { logs, watcher: first } = await setup()
    first.stop()
    const events: string[] = []
    const watcher = new ShieldBatteryLogWatcher(logs)
    watcher.on('players', () => events.push('players'))
    watcher.on('ended', () => events.push('ended'))
    watcher.start()
    await settle()
    logs.append(joinedLine(['a', 'b']) + END + joinedLine(['c', 'd']))
    await settle()
    expect(events).toEqual(['players'])
    logs.append(NOISE + END)
    await settle()
    expect(events).toEqual(['players', 'ended'])
    watcher.stop()
  })

  test('only reads what was added', async () => {
    const { logs } = await setup(NOISE.repeat(100))
    logs.append(NOISE)
    await settle()
    expect(logs.bytesRead).toBe(NOISE.length)
  })

  test('joins a line written over two reads', async () => {
    const { logs, games } = await setup()
    const line = joinedLine(['alpha', 'beta'])
    logs.append(line.slice(0, 100))
    await settle()
    logs.append(line.slice(100))
    await settle()
    expect(games).toHaveLength(1)
  })

  test('starts over when the log rotates, even to a file that grew past where it was', async () => {
    const { logs, games } = await setup(NOISE)
    logs.fileId = 'second'
    logs.content = Buffer.alloc(0)
    // Read from where the old file was, this would start partway into the line.
    logs.append(joinedLine(['after', 'rotation']) + NOISE.repeat(3))
    await settle()
    expect(games.map(g => g[0].name)).toEqual(['after'])
  })

  test('starts over when the log shrinks', async () => {
    const { logs, games } = await setup(NOISE.repeat(10))
    logs.content = Buffer.alloc(0)
    logs.append(joinedLine(['after', 'rotation']))
    await settle()
    expect(games.map(g => g[0].name)).toEqual(['after'])
  })

  test('keeps only the end of a big jump', async () => {
    const { logs, games } = await setup()
    logs.append(joinedLine(['too', 'old']) + NOISE.repeat(Math.ceil(MAX_READ / NOISE.length)))
    logs.append(joinedLine(['recent', 'game']))
    await settle()
    expect(games.map(g => g[0].name)).toEqual(['recent'])
    expect(logs.bytesRead).toBeLessThanOrEqual(MAX_READ)
  })

  test('reads once for many changes close together', async () => {
    const { logs } = await setup()
    const read = vi.spyOn(logs, 'read')
    for (let i = 0; i < 20; i++) {
      logs.append(NOISE)
    }
    await settle()
    expect(read).toHaveBeenCalledOnce()
  })

  test('watches once ShieldBattery makes its log folder', async () => {
    const logs = new FakeLogs()
    logs.folderThere = false
    const watcher = new ShieldBatteryLogWatcher(logs)
    watcher.start()
    await settle()
    expect(logs.watching).toBe(false)
    logs.folderThere = true
    await vi.advanceTimersByTimeAsync(RETRY_WATCH_MS)
    expect(logs.watching).toBe(true)
    watcher.stop()
  })

  test("doesn't report an old game again after a stat fails for a moment", async () => {
    const { logs, games } = await setup(joinedLine(['old', 'game']) + NOISE)
    logs.statFails = true
    logs.append(NOISE)
    await settle()
    logs.append(NOISE)
    await settle()
    expect(games).toEqual([])
  })

  test('reads a log made after it started from the beginning', async () => {
    const { logs, games, watcher: first } = await setup()
    first.stop()
    logs.content = undefined
    const watcher = new ShieldBatteryLogWatcher(logs)
    watcher.on('players', p => games.push(p))
    watcher.start()
    await settle()
    logs.content = Buffer.alloc(0)
    logs.append(joinedLine(['first', 'game']))
    await settle()
    expect(games.map(g => g[0].name)).toEqual(['first'])
    watcher.stop()
  })

  test('watches again after watching fails', async () => {
    const { logs } = await setup()
    logs.onError?.()
    expect(logs.watching).toBe(false)
    await vi.advanceTimersByTimeAsync(RETRY_WATCH_MS)
    expect(logs.watching).toBe(true)
  })

  test('lets everything go when stopped', async () => {
    const { logs, watcher, games } = await setup()
    watcher.stop()
    expect(logs.watching).toBe(false)
    logs.append(joinedLine(['after', 'stop']))
    await vi.advanceTimersByTimeAsync(RETRY_WATCH_MS)
    expect(games).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
})
