import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { ReplayDb } from './replay-db'
import type { IndexedReplay } from './replay-parser'

/**
 * The index loads better-sqlite3's Windows build, the one the app ships, so it can only be opened
 * on Windows. The module is imported inside the suite so nothing loads it elsewhere, like on CI.
 */
const CAN_OPEN_INDEX = process.platform === 'win32'

const AUTOSAVE = 'C:\\Users\\Иван\\Documents\\StarCraft\\Maps\\Replays\\AutoSave'

function makeReplay(fileName: string, playerNames: string[], gameTime: number): IndexedReplay {
  return {
    path: path.win32.join(AUTOSAVE, fileName),
    fileMtime: 1,
    fileSize: 1,
    contentHash: fileName,
    gameTime,
    mapName: 'Polypoid',
    gameType: 2,
    durationFrames: 20000,
    parseError: false,
    players: playerNames.map((name, i) => ({
      slot: i,
      team: i,
      name,
      race: 'p',
      isComputer: false,
    })),
    teamSize: 1,
    matchup: 'PvP',
    tileset: 4,
  }
}

describe.runIf(CAN_OPEN_INDEX)('app/replay-library/replay-db', () => {
  let dir: string
  let dbPath: string
  let opened: ReplayDb[]

  async function open(): Promise<ReplayDb> {
    const { ReplayDb } = await import('./replay-db')
    const db = new ReplayDb(dbPath)
    opened.push(db)
    return db
  }

  /** Twelve games for Ärger, each against someone new, and one game without them. */
  function addGames(db: ReplayDb) {
    for (let i = 0; i < 12; i++) {
      db.upsertReplay(makeReplay(`Game ${i}.rep`, ['Ärger', `Foe${i}`], 1000 + i))
    }
    db.upsertReplay(makeReplay('Other.rep', ['Somebody', 'Else'], 5000))
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'replay-db-'))
    dbPath = path.join(dir, 'index.sqlite')
    opened = []
  })

  afterEach(async () => {
    for (const db of opened) {
      db.close()
    }
    await rm(dir, { recursive: true, force: true })
  })

  test('matches names and paths ignoring case, past ASCII', async () => {
    const db = await open()
    addGames(db)
    const count = (filters: Parameters<ReplayDb['query']>[0]) =>
      db.query({ ...filters, includeShort: true }).total

    expect(count({ whose: { names: ['ÄRGER'], match: 'mine' } })).toBe(12)
    expect(count({ whose: { names: ['ärger'], match: 'others' } })).toBe(1)
    expect(count({ withAccounts: ['ärGER'] })).toBe(12)
    expect(count({ search: 'zzz', searchAccounts: ['ÄRGER'] })).toBe(12)
    expect(count({ playerName: 'ärg' })).toBe(12)
    expect(count({ search: 'ÄRG' })).toBe(12)

    const analyzedPath = path.win32.join(AUTOSAVE, 'Game 3.rep').toLowerCase()
    expect(count({ analysis: 'analyzed', analyzedPaths: [analyzedPath] })).toBe(1)
    expect(count({ analysis: 'notAnalyzed', analyzedPaths: [analyzedPath] })).toBe(12)
    expect(count({ excludePaths: [path.win32.join(AUTOSAVE, 'GAME 3.REP')] })).toBe(12)

    expect(db.suggestOwnNames([])).toEqual([{ name: 'Ärger', games: 12 }])
    expect(db.suggestOwnNames(['ÄRGER'])).toEqual([])
  })

  test("gives a replay without a tileset its map's, and saves its own once read", async () => {
    const db = await open()
    db.upsertReplay({ ...makeReplay('Old.rep', ['A', 'B'], 1), tileset: null })
    db.upsertReplay({ ...makeReplay('Odd map.rep', ['A', 'B'], 2), mapName: 'Odd', tileset: null })
    db.upsertReplay(makeReplay('New.rep', ['A', 'B'], 3))
    const tilesets = () =>
      Object.fromEntries(db.query({ includeShort: true }).entries.map(e => [e.fileName, e.tileset]))

    expect(tilesets()).toEqual({
      'New.rep': 'jungle',
      'Old.rep': 'jungle',
      'Odd map.rep': undefined,
    })

    const oddPath = path.win32.join(AUTOSAVE, 'Odd map.rep')
    expect(db.lacksTileset(oddPath)).toBe(true)
    db.setTileset(oddPath, 6)
    expect(db.lacksTileset(oddPath)).toBe(false)
    expect(tilesets()['Odd map.rep']).toBe('ice')
  })

  test('keeps the path key in step when a replay moves', async () => {
    const db = await open()
    addGames(db)
    const oldKey = path.win32.join(AUTOSAVE, 'Other.rep').toLowerCase()
    const newKey = path.win32.join(AUTOSAVE, 'Ünder.rep').toLowerCase()
    expect(db.getGameTimes([oldKey, newKey])).toEqual([[oldKey, 5000]])

    const id = db.getIdByPath(path.win32.join(AUTOSAVE, 'Other.rep'))!
    db.updateReplayFile(id, path.win32.join(AUTOSAVE, 'Ünder.rep'), 2)

    expect(
      db.query({ excludePaths: [path.win32.join(AUTOSAVE, 'ÜNDER.REP')], includeShort: true })
        .total,
    ).toBe(12)
    expect(db.getGameTimes([oldKey, newKey])).toEqual([[newKey, 5000]])
  })

  test('fills in the keys of an index made before they existed', async () => {
    addGames(await open())
    opened.pop()!.close()
    const { default: Database } = await import('better-sqlite3/win32-x64')
    const raw = new Database(dbPath)
    raw.exec(`
      ALTER TABLE replays DROP COLUMN path_key;
      ALTER TABLE replay_players DROP COLUMN name_key;
      DROP INDEX idx_replays_map_name_tileset;
      ALTER TABLE replays DROP COLUMN tileset;
    `)
    raw.pragma('user_version = 10')
    raw.close()

    const db = await open()
    expect(db.query({ whose: { names: ['ÄRGER'], match: 'mine' }, includeShort: true }).total).toBe(
      12,
    )
    expect(
      db.query({ excludePaths: [path.win32.join(AUTOSAVE, 'OTHER.rep')], includeShort: true })
        .total,
    ).toBe(12)
    const key = path.win32.join(AUTOSAVE, 'Game 3.rep').toLowerCase()
    expect(db.getGameTimes([key])).toEqual([[key, 1003]])
  })
})
