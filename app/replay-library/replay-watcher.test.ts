import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ExistingReplayInfo, ReplayDb } from './replay-db'
import { IndexedReplay } from './replay-parser'
import { ReplayWatcher } from './replay-watcher'

type WatchListener = (eventType: 'rename' | 'change', filename: string | null) => void

const watchListeners = new Map<string, WatchListener>()

vi.mock('node:fs', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  watch: vi.fn((folder: string, _options: unknown, listener: WatchListener) => {
    watchListeners.set(folder, listener)
    return { close: () => watchListeners.delete(folder) }
  }),
}))

/** The parts of `ReplayDb` the watcher uses, kept in memory. */
class FakeReplayDb {
  readonly rows = new Map<string, ExistingReplayInfo>()
  private nextId = 1

  getExistingReplays() {
    return new Map(this.rows)
  }

  getExistingReplay(filePath: string) {
    return this.rows.get(filePath)
  }

  getExistingReplaysUnder(folder: string) {
    return new Map([...this.rows].filter(([p]) => p.startsWith(folder + path.sep)))
  }

  upsertReplay(record: IndexedReplay) {
    this.rows.set(record.path, {
      id: this.rows.get(record.path)?.id ?? this.nextId++,
      fileMtime: record.fileMtime,
      fileSize: record.fileSize,
      contentHash: record.contentHash,
    })
  }

  deleteByPaths(paths: string[]) {
    for (const p of paths) {
      this.rows.delete(p)
    }
  }

  updateReplayFile(id: number, newPath: string, fileMtime: number) {
    const [oldPath, info] = [...this.rows].find(([, row]) => row.id === id)!
    this.rows.delete(oldPath)
    this.rows.set(newPath, { ...info, fileMtime })
  }
}

describe('app/replay-library/replay-watcher', () => {
  let root: string
  let db: FakeReplayDb
  let watcher: ReplayWatcher
  let reconciled: () => Promise<void>

  /** Writes a replay whose contents are its own, so it can be told apart when moved. */
  async function writeReplay(relativePath: string) {
    const filePath = path.join(root, relativePath)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, `replay at ${relativePath}`)
    return filePath
  }

  /** Reports a change the way a folder watcher would, then waits for the reconcile it starts. */
  async function report(eventType: 'rename' | 'change', relativePath: string | null) {
    const done = reconciled()
    watchListeners.get(root)!(eventType, relativePath)
    await done
  }

  function indexedPaths() {
    return [...db.rows.keys()].map(p => path.relative(root, p)).sort()
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'replay-watcher-'))
    db = new FakeReplayDb()

    let onIdle: (() => void) | undefined
    reconciled = () => new Promise(resolve => (onIdle = resolve))
    watcher = new ReplayWatcher(
      [root],
      db as unknown as ReplayDb,
      { error: () => {}, warning: () => {}, verbose: () => {} },
      {
        onProgress: progress => {
          if (!progress) {
            onIdle?.()
          }
        },
        onChange: () => {},
      },
    )
  })

  afterEach(async () => {
    watcher.stop()
    await rm(root, { recursive: true, force: true })
  })

  async function startWith(...relativePaths: string[]) {
    for (const p of relativePaths) {
      await writeReplay(p)
    }
    const done = reconciled()
    watcher.start()
    await done
  }

  test('indexes every replay when it starts', async () => {
    await startWith('a.rep', path.join('AutoSave', 'b.rep'), 'notes.txt')

    expect(indexedPaths()).toEqual(['AutoSave/b.rep', 'a.rep'].map(p => path.normalize(p)).sort())
  })

  test('looks at only the replays that were reported', async () => {
    await startWith('a.rep', 'b.rep')
    await rm(path.join(root, 'b.rep'))
    await writeReplay('c.rep')
    await writeReplay('d.rep')

    await report('rename', 'c.rep')

    // b.rep is gone and d.rep is new, but neither was reported.
    expect(indexedPaths()).toEqual(['a.rep', 'b.rep', 'c.rep'])
  })

  test('drops a replay that was removed', async () => {
    await startWith('a.rep', 'b.rep')
    await rm(path.join(root, 'b.rep'))

    await report('rename', 'b.rep')

    expect(indexedPaths()).toEqual(['a.rep'])
  })

  test('keeps the index entry of a renamed replay', async () => {
    await startWith('a.rep', 'b.rep')
    const { id } = db.rows.get(path.join(root, 'b.rep'))!
    await rename(path.join(root, 'b.rep'), path.join(root, 'renamed.rep'))

    watchListeners.get(root)!('rename', 'b.rep')
    await report('rename', 'renamed.rep')

    expect(indexedPaths()).toEqual(['a.rep', 'renamed.rep'])
    expect(db.rows.get(path.join(root, 'renamed.rep'))!.id).toBe(id)
  })

  test('indexes the replays in a folder that was moved in', async () => {
    await startWith('a.rep')
    await writeReplay(path.join('moved', 'b.rep'))
    await writeReplay(path.join('moved', 'deeper', 'c.rep'))

    await report('rename', 'moved')

    expect(indexedPaths()).toEqual(
      ['a.rep', path.join('moved', 'b.rep'), path.join('moved', 'deeper', 'c.rep')].sort(),
    )
  })

  test('drops the replays in a folder that was removed', async () => {
    await startWith('a.rep', path.join('old', 'b.rep'), path.join('old', 'deeper', 'c.rep'))
    await rm(path.join(root, 'old'), { recursive: true })

    await report('rename', 'old')

    expect(indexedPaths()).toEqual(['a.rep'])
  })

  test("doesn't walk a folder that was only modified", async () => {
    await startWith(path.join('AutoSave', 'a.rep'))
    await writeReplay(path.join('AutoSave', 'b.rep'))

    await report('change', 'AutoSave')

    expect(indexedPaths()).toEqual([path.join('AutoSave', 'a.rep')])
  })

  test('ignores files that are not indexed', async () => {
    await startWith('a.rep')
    await rm(path.join(root, 'a.rep'))
    await writeReplay('LastReplay.rep')

    await report('rename', 'LastReplay.rep')

    // A full scan would have dropped a.rep.
    expect(indexedPaths()).toEqual(['a.rep'])
  })

  test("scans everything when a watcher can't say what changed", async () => {
    await startWith('a.rep', 'b.rep')
    await rm(path.join(root, 'b.rep'))
    await writeReplay('c.rep')

    await report('rename', null)

    expect(indexedPaths()).toEqual(['a.rep', 'c.rep'])
  })
})
