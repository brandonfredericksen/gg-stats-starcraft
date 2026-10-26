import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LiveGamePlayer } from '../../common/live-game'
import {
  APP_LOG,
  GAME_LOG,
  LogFiles,
  MAX_READ,
  parseGameSetup,
  parseJoinedPlayers,
  parseMatchmakingLine,
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

/**
 * A setupGame message as ShieldBattery's game DLL logs it, cut down to the parts that are read.
 * The user ids are the ones {@link joinedLine} gives players, from 100.
 */
function setupLines(
  gameType: string,
  slots: Array<{ race: string; teamId: number }>,
  ratings: number[] = [],
) {
  const json = {
    gameType,
    map: { name: 'Big Game Hunters', mapData: { tileset: 4 } },
    slots: [
      ...slots.map((slot, i) => ({ type: 'human', playerId: 0, userId: 100 + i, ...slot })),
      { type: 'observer', race: 'r', teamId: 2, userId: 200 },
    ],
    ranks: ratings.map((rating, i) => ({ userId: 100 + i, rating, division: 'gold1' })),
  }
  return (
    "[2026-10-24][19:42:42.680][<redacted>:0][DEBUG] Received message: 'setupGame':\n" +
    `'${JSON.stringify(json)}'\n`
  )
}

/** A line of ShieldBattery's own log. */
function appLine(message: string) {
  return `[2026-10-26T06:20:00.769Z]\t<debug>\t${message}\n`
}

const MATCH_FOUND = appLine(
  'Match found, showing accept dialog. 59998.77278599143ms left, 0 / 6 accepted. Self accepted: false',
)

const NOISE =
  '[2026-10-24][19:42:45.306][src\\bw_scr.rs:7129][DEBUG] Slot 0 has id 0, player_type 2\n'
const END =
  '[2026-10-24][19:55:13.747][src\\game_state.rs:1556][DEBUG] Got results from game thread: GameThreadResults {\n'

describe('parseJoinedPlayers', () => {
  test('reads every player, and who watches', () => {
    expect(parseJoinedPlayers(joinedLine(['alpha', 'beta'], ['gamma']))).toEqual([
      { name: 'alpha', slot: 0, shieldBatteryId: 100, observer: undefined },
      { name: 'beta', slot: 1, shieldBatteryId: 101, observer: undefined },
      { name: 'gamma', slot: undefined, shieldBatteryId: 200, observer: true },
    ])
  })

  test("undoes Rust's escapes in names", () => {
    const line =
      'Netcode v2 joined players: [JoinedPlayer { name: "a\\"b\\\\c\\u{e9}", storm_id: StormPlayerId(0), player_id: Some(BwPlayerId(0)), sb_user_id: SbUserId(1) }]'
    expect(parseJoinedPlayers(line)).toEqual([
      { name: 'a"b\\cé', slot: 0, shieldBatteryId: 1, observer: undefined },
    ])
  })

  test('reads nothing from another line', () => {
    expect(parseJoinedPlayers(NOISE)).toEqual([])
  })
})

describe('parseGameSetup', () => {
  test('reads teams, races and ratings, leaving out who watches', () => {
    const setup = parseGameSetup(
      setupLines(
        'topVBottom',
        [
          { race: 'p', teamId: 0 },
          { race: 'r', teamId: 1 },
        ],
        [1500.4],
      ).split('\n')[1],
    )
    expect(setup?.map).toEqual({ mapName: 'Big Game Hunters', tileset: 'jungle' })
    expect(Object.fromEntries(setup!.players)).toEqual({
      100: { team: 0, race: 'p', shieldBattery: { rating: 1500, division: 'gold1' } },
      101: { team: 1, race: 'r', shieldBattery: undefined },
    })
  })

  test('puts everyone on their own team in a game without teams', () => {
    const setup = parseGameSetup(
      setupLines('melee', [
        { race: 'z', teamId: 0 },
        { race: 't', teamId: 0 },
      ]).split('\n')[1],
    )
    expect([...setup!.players.values()].map(p => p.team)).toEqual([0, 1])
  })

  test("reads nothing from a replay's setup, which has no races", () => {
    const line = `'${JSON.stringify({ gameType: 'melee', slots: [{ type: 'human', userId: 1 }] })}'`
    expect(parseGameSetup(line)).toBeUndefined()
    expect(parseGameSetup(NOISE)).toBeUndefined()
  })
})

describe('parseMatchmakingLine', () => {
  test('reads how far a match got', () => {
    expect(parseMatchmakingLine(MATCH_FOUND)).toEqual({
      kind: 'found',
      accepted: 0,
      playerCount: 6,
    })
    expect(parseMatchmakingLine(appLine('Player accepted, 4 players now ready'))).toEqual({
      kind: 'accepted',
      accepted: 4,
    })
    expect(parseMatchmakingLine(appLine('Draft started'))).toEqual({ kind: 'drafting' })
    expect(parseMatchmakingLine(appLine('Match is now ready, closing accept dialog'))).toEqual({
      kind: 'starting',
    })
  })

  test('reads every way a match falls through', () => {
    for (const message of [
      'Timed out accepting match, showing failure dialog',
      'Draft canceled: playerLeft',
      'Match loading canceled',
      'Re-entered matchmaking queue',
    ]) {
      expect(parseMatchmakingLine(appLine(message))).toEqual({ kind: 'canceled' })
    }
  })

  test('reads nothing from other lines, or the words anywhere but the start of one', () => {
    expect(parseMatchmakingLine(appLine('Matchmaking search started'))).toBeUndefined()
    expect(parseMatchmakingLine(appLine('Accepted match successfully'))).toBeUndefined()
    expect(parseMatchmakingLine(appLine('Error: Draft started twice'))).toBeUndefined()
    expect(parseMatchmakingLine('Draft started')).toBeUndefined()
  })
})

class FakeLogs implements LogFiles {
  content: Buffer | undefined = Buffer.alloc(0)
  watching = false
  folderThere = true
  onChange: ((file: string) => void) | undefined
  bytesRead = 0

  /** ShieldBattery's own log, missing unless a test writes to it. */
  appContent: Buffer | undefined

  append(text: string) {
    this.content = Buffer.concat([this.content ?? Buffer.alloc(0), Buffer.from(text)])
    this.onChange?.(GAME_LOG)
  }

  appendApp(text: string) {
    this.appContent = Buffer.concat([this.appContent ?? Buffer.alloc(0), Buffer.from(text)])
    this.onChange?.(APP_LOG)
  }

  /** Changes when the log rotates to a new file. */
  fileId = 'first'

  private contentOf(file: string) {
    return file === APP_LOG ? this.appContent : this.content
  }

  stat = async (file: string) => {
    if (file === GAME_LOG && this.statFails) {
      this.statFails = false
      return undefined
    }
    const content = this.contentOf(file)
    return content ? { size: content.length, id: this.fileId } : undefined
  }

  read = async (file: string, position: number, length: number, into: Uint8Array) => {
    const content = this.contentOf(file)
    if (!content) {
      return undefined
    }
    const part = content.subarray(position, position + length)
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

  test("puts the game's setup on its players", async () => {
    const { logs, watcher } = await setup()
    const maps: Array<string | undefined> = []
    watcher.on('players', (_, map) => maps.push(map?.mapName))
    const games: LiveGamePlayer[][] = []
    watcher.on('players', p => games.push(p))
    logs.append(
      setupLines('topVBottom', [
        { race: 'p', teamId: 0 },
        { race: 'z', teamId: 1 },
      ]) +
        NOISE +
        joinedLine(['alpha', 'beta'], ['gamma']),
    )
    await settle()
    expect(maps).toEqual(['Big Game Hunters'])
    expect(games[0].map(p => [p.name, p.team, p.race])).toEqual([
      ['alpha', 0, 'p'],
      ['beta', 1, 'z'],
      ['gamma', undefined, undefined],
    ])
  })

  test('reads a setup split across two reads', async () => {
    const { logs, games } = await setup()
    const [first, json] = setupLines('topVBottom', [
      { race: 't', teamId: 0 },
      { race: 'p', teamId: 1 },
    ]).split('\n')
    logs.append(first + '\n')
    await settle()
    logs.append(json + '\n' + joinedLine(['alpha', 'beta']))
    await settle()
    expect(games[0].map(p => p.race)).toEqual(['t', 'p'])
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

  test('follows a match from when it is found until its game loads', async () => {
    const { logs, watcher } = await setup()
    const events: unknown[] = []
    watcher.on('matchFound', match => events.push(['found', match]))
    watcher.on('matchChanged', match => events.push(['changed', match]))
    watcher.on('players', players => events.push(['players', players.length]))
    logs.appendApp(MATCH_FOUND + appLine('Player accepted, 3 players now ready'))
    await settle()
    logs.appendApp(appLine('Draft started'))
    await settle()
    // Ready just before its game loads, in the same read.
    logs.appendApp(appLine('Match is now ready, closing accept dialog'))
    logs.append(joinedLine(['alpha', 'beta']))
    await settle()
    expect(events).toEqual([
      ['found', { playerCount: 6, accepted: 3, phase: 'accepting' }],
      ['changed', { playerCount: 6, accepted: 6, phase: 'drafting' }],
      ['changed', { playerCount: 6, accepted: 6, phase: 'starting' }],
      ['players', 2],
    ])
  })

  test('says when a match falls through', async () => {
    const { logs, watcher } = await setup()
    const events: string[] = []
    watcher.on('matchFound', () => events.push('found'))
    watcher.on('matchCanceled', () => events.push('canceled'))
    logs.appendApp(MATCH_FOUND)
    await settle()
    logs.appendApp(appLine('Draft canceled: playerLeft'))
    await settle()
    // Found and fallen through within one read, there's nothing to tell.
    logs.appendApp(MATCH_FOUND + appLine('Timed out accepting match, showing failure dialog'))
    await settle()
    expect(events).toEqual(['found', 'canceled'])
  })

  test('ignores matches logged before it started, and updates to a match it never saw', async () => {
    const logs = new FakeLogs()
    logs.appContent = Buffer.from(MATCH_FOUND)
    const watcher = new ShieldBatteryLogWatcher(logs)
    const events: string[] = []
    watcher.on('matchFound', () => events.push('found'))
    watcher.on('matchChanged', () => events.push('changed'))
    watcher.start()
    await settle()
    logs.appendApp(appLine('Draft started'))
    await settle()
    expect(events).toEqual([])
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
