import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  GameStatsPayload,
  ReplayStatsSource,
  SAVED_GAME_STATS_VERSION,
} from '../../common/games/game-stats'
import { GameStatsStore } from './game-stats-store'

vi.mock('../logger', () => ({
  default: { verbose: () => {}, warning: () => {}, error: () => {} },
}))

const STATS: GameStatsPayload = {
  mapName: 'Fighting Spirit',
  frames: 100,
  complete: true,
  snapshotFrames: [],
  players: [],
}

/**
 * Windows, which the app runs on, finds files whatever the case of their paths. Elsewhere, like on
 * CI, a path in another case names a different file.
 */
const CASE_INSENSITIVE_FILES = process.platform === 'win32'

describe('app/game/game-stats-store', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'game-stats-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function makeReplay(name: string, contents = 'a replay') {
    const replayPath = path.join(dir, 'Replays', name)
    await mkdir(path.dirname(replayPath), { recursive: true })
    await writeFile(replayPath, contents)
    return replayPath
  }

  function analysis(replayPath: string, linkedGameId?: string): ReplayStatsSource {
    return { kind: 'replay', name: path.basename(replayPath), path: replayPath, linkedGameId }
  }

  test('saves stats that can be read back after a restart', async () => {
    await new GameStatsStore(dir).save('game-1', { kind: 'game' }, STATS)

    const saved = await new GameStatsStore(dir).get('game-1')
    expect(saved).toMatchObject({ gameId: 'game-1', source: { kind: 'game' }, stats: STATS })
    expect(await readdir(dir)).toEqual(['game-1.json'])
  })

  test('treats missing, unreadable and outdated files as no stats', async () => {
    const store = new GameStatsStore(dir)
    await writeFile(path.join(dir, 'broken.json'), '{ not json')
    await writeFile(
      path.join(dir, 'old.json'),
      JSON.stringify({ gameId: 'old', savedAt: 1, source: { kind: 'game' }, stats: STATS }),
    )

    expect(await store.get('missing')).toBeUndefined()
    expect(await store.get('broken')).toBeUndefined()
    expect(await store.get('old')).toBeUndefined()
  })

  test('refuses game ids that could reach outside its folder', async () => {
    const store = new GameStatsStore(dir)

    await expect(store.save('../escape', { kind: 'game' }, STATS)).rejects.toThrow()
    expect(await store.get('../escape')).toBeUndefined()
  })

  test('reads what was just saved without waiting for the save', async () => {
    const store = new GameStatsStore(dir)
    const saving = store.save('game-1', { kind: 'game' }, STATS)

    expect((await store.get('game-1'))?.gameId).toBe('game-1')
    await saving
  })

  test("finds a replay's latest stats by its path, however the path is written", async () => {
    const replayPath = await makeReplay('game.rep')
    await new GameStatsStore(dir).save('first', analysis(replayPath), STATS)
    const store = new GameStatsStore(dir)
    await store.save('second', analysis(replayPath), STATS)

    expect((await store.findByReplayPath(replayPath.replaceAll('\\', '/')))?.gameId).toBe('second')
    expect(await store.findByReplayPath(await makeReplay('other.rep'))).toBeUndefined()
  })

  test.runIf(CASE_INSENSITIVE_FILES)(
    "finds a replay's stats with its path in another case",
    async () => {
      const replayPath = await makeReplay('game.rep')
      const store = new GameStatsStore(dir)
      await store.save('first', analysis(replayPath), STATS)

      expect((await store.findByReplayPath(replayPath.toUpperCase()))?.gameId).toBe('first')
    },
  )

  test('summarizes the replays that have stats, leaving out changed files', async () => {
    const analyzed = await makeReplay('analyzed.rep')
    const changed = await makeReplay('changed.rep', 'first game')
    const other = await makeReplay('other.rep')
    const store = new GameStatsStore(dir)
    await store.save('first', analysis(analyzed), STATS)
    await store.save('second', analysis(changed), STATS)
    await writeFile(changed, 'a different, longer game')

    const asListed = CASE_INSENSITIVE_FILES ? analyzed.toUpperCase() : analyzed
    const summaries = await store.summarizeReplays([asListed, changed, other])
    expect(Object.keys(summaries)).toEqual([asListed])
    expect(summaries[asListed]).toMatchObject({ gameId: 'first', complete: true })
  })

  test("doesn't match a replay file that changed or is gone", async () => {
    const replayPath = await makeReplay('LastReplay.rep', 'first game')
    const store = new GameStatsStore(dir)
    await store.save('first', analysis(replayPath), STATS)
    expect((await store.findByReplayPath(replayPath))?.gameId).toBe('first')

    await writeFile(replayPath, 'a different, longer game')
    expect(await store.findByReplayPath(replayPath)).toBeUndefined()

    await rm(replayPath)
    expect(await store.findByReplayPath(replayPath)).toBeUndefined()
  })

  test("doesn't offer a played game's partial stats for its replay", async () => {
    const replayPath = await makeReplay('game.rep')
    const store = new GameStatsStore(dir)
    await store.save('played', { kind: 'game', replayPath }, { ...STATS, complete: false })
    expect(await store.findByReplayPath(replayPath)).toBeUndefined()

    // Analyzing the replay again wouldn't cover any more than this did.
    await store.save('analysis', analysis(replayPath), { ...STATS, complete: false })
    expect((await store.findByReplayPath(replayPath))?.gameId).toBe('analysis')
  })

  test('finds an analyzed replay by the game it came from', async () => {
    const replayPath = await makeReplay('game.rep')
    await new GameStatsStore(dir).save('analysis', analysis(replayPath, 'linked-game'), STATS)

    expect((await new GameStatsStore(dir).get('linked-game'))?.gameId).toBe('analysis')
  })

  test('finds an analyzed replay saved with the old name for the game it came from', async () => {
    const replayPath = await makeReplay('game.rep')
    await mkdir(dir, { recursive: true })
    await writeFile(
      path.join(dir, 'analysis.json'),
      JSON.stringify({
        version: SAVED_GAME_STATS_VERSION,
        gameId: 'analysis',
        savedAt: 1,
        source: { kind: 'replay', name: 'game.rep', path: replayPath, sbGameId: 'linked-game' },
        stats: STATS,
      }),
    )

    const store = new GameStatsStore(dir)
    const saved = await store.get('linked-game')
    expect(saved?.gameId).toBe('analysis')
    expect(saved?.source).toEqual({
      kind: 'replay',
      name: 'game.rep',
      path: replayPath,
      linkedGameId: 'linked-game',
    })
  })

  test('prefers an analysis of the whole game to stats from leaving it early', async () => {
    const store = new GameStatsStore(dir)
    await store.save('linked-game', { kind: 'game' }, { ...STATS, complete: false })
    expect((await store.get('linked-game'))?.gameId).toBe('linked-game')

    const replayPath = await makeReplay('game.rep')
    await store.save('partial', analysis(replayPath, 'linked-game'), { ...STATS, complete: false })
    expect((await store.get('linked-game'))?.gameId).toBe('linked-game')

    await store.save('whole', analysis(replayPath, 'linked-game'), STATS)
    expect((await store.get('linked-game'))?.gameId).toBe('whole')
  })

  test('removes saved files that can no longer be read', async () => {
    await writeFile(path.join(dir, 'broken.json'), '{ not json')
    await writeFile(
      path.join(dir, 'old.json'),
      JSON.stringify({ gameId: 'old', savedAt: 1, source: { kind: 'game' }, stats: STATS }),
    )

    await new GameStatsStore(dir).save('new', { kind: 'game' }, STATS)

    expect(await readdir(dir)).toEqual(['new.json'])
  })

  test('keeps stats saved by a newer version without reading them', async () => {
    const newer = {
      version: SAVED_GAME_STATS_VERSION + 1,
      gameId: 'newer',
      savedAt: 1,
      source: { kind: 'game' },
      stats: STATS,
    }
    await writeFile(path.join(dir, 'newer.json'), JSON.stringify(newer))
    const store = new GameStatsStore(dir)

    expect(await store.get('newer')).toBeUndefined()
    await store.save('new', { kind: 'game' }, STATS)
    expect((await readdir(dir)).sort()).toEqual(['new.json', 'newer.json'])
  })

  test('keeps only the most recently saved games, including ones saved before a restart', async () => {
    for (const gameId of ['oldest', 'middle']) {
      await new GameStatsStore(dir, 2).save(gameId, { kind: 'game' }, STATS)
      // Make sure each save gets its own timestamp.
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    await new GameStatsStore(dir, 2).save('newest', { kind: 'game' }, STATS)

    expect((await readdir(dir)).toSorted()).toEqual(['middle.json', 'newest.json'])
  })

  test("adds a played game's replay once it has been saved", async () => {
    const store = new GameStatsStore(dir)
    const replayPath = await makeReplay('LastReplay.rep')
    // Not awaited, like when the replay is saved right after the stats arrive.
    const saving = store.save('played', { kind: 'game' }, STATS)
    await store.setReplayPath('played', replayPath)
    await saving

    expect((await store.get('played'))?.source).toEqual({ kind: 'game', replayPath })
    expect((await store.findByReplayPath(replayPath))?.gameId).toBe('played')
  })

  test('lists each replay once, preferring stats of the whole game', async () => {
    const replayPath = await makeReplay('game.rep')
    const store = new GameStatsStore(dir)
    await store.save('whole', analysis(replayPath), STATS)
    await store.save('played', { kind: 'game', replayPath }, { ...STATS, complete: false })
    await store.save('other', { kind: 'game' }, STATS)

    const listed = await store.listMetrics()
    expect(listed.map(l => l.metrics.gameId).toSorted()).toEqual(['other', 'whole'])
  })

  test('keeps an index of the saved stats, and reads changed files again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await new GameStatsStore(dir).save('game-1', { kind: 'game' }, STATS)
      await vi.advanceTimersByTimeAsync(5000)
      await vi.waitFor(async () => expect(await readdir(dir)).toContain('index.cache'))

      // The index is used instead of the file as long as the file hasn't changed.
      const indexed = path.join(dir, 'game-1.json')
      const { mtimeMs } = await stat(indexed)
      const saved = JSON.parse(await readFile(indexed, 'utf8'))
      const renamed = JSON.stringify({ ...saved, stats: { ...STATS, mapName: 'Python 1.3' } })
      await writeFile(indexed, renamed.padEnd(JSON.stringify(saved).length))
      await utimes(indexed, mtimeMs / 1000, mtimeMs / 1000)
      const [cached] = await new GameStatsStore(dir).listMetrics()
      expect(cached.metrics.mapName).toBe('Fighting Spirit')

      await utimes(indexed, new Date(), new Date())
      const [current] = await new GameStatsStore(dir).listMetrics()
      expect(current.metrics.mapName).toBe('Python 1.3')
    } finally {
      vi.useRealTimers()
    }
  })

  test('cleans up temporary files left behind by a write that never finished', async () => {
    await mkdir(dir, { recursive: true })
    const abandoned = path.join(dir, 'game-1.json.1-1.tmp')
    const inProgress = path.join(dir, 'game-2.json.1-2.tmp')
    await writeFile(abandoned, '{')
    await writeFile(inProgress, '{')
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await utimes(abandoned, dayAgo, dayAgo)

    await new GameStatsStore(dir).save('game-3', { kind: 'game' }, STATS)

    expect((await readdir(dir)).toSorted()).toEqual(['game-2.json.1-2.tmp', 'game-3.json'])
  })
})
