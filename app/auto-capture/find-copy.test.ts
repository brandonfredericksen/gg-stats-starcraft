import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { AUTOSAVE_WINDOW_MS, CopyLocation, FindCopyDeps, findReplayCopy } from './find-copy'

interface FakeEntry {
  data: string
  modifiedMs: number
}

function fakeFs(files: Record<string, FakeEntry>): FindCopyDeps {
  const normalized = new Map(Object.entries(files).map(([p, f]) => [path.normalize(p), f]))
  return {
    readdir: async folder => {
      const prefix = path.normalize(folder) + path.sep
      const names = new Map<string, boolean>()
      for (const filePath of normalized.keys()) {
        if (filePath.startsWith(prefix)) {
          const [first, ...rest] = filePath.slice(prefix.length).split(path.sep)
          names.set(first, rest.length > 0)
        }
      }
      return Array.from(names, ([name, isDirectory]) => ({ name, isDirectory }))
    },
    stat: async filePath => {
      const file = normalized.get(path.normalize(filePath))
      return file ? { size: file.data.length, modifiedMs: file.modifiedMs } : undefined
    },
    readFile: async filePath => Buffer.from(normalized.get(path.normalize(filePath))!.data),
  }
}

const AUTOSAVE: CopyLocation = {
  folder: path.join('replays', 'AutoSave'),
  includeSubfolders: true,
  nearReplayTime: true,
}
const ARCHIVE: CopyLocation = {
  folder: path.join('replays', 'GG Stats', '2026-10'),
  includeSubfolders: false,
  nearReplayTime: false,
}

const REPLAY = Buffer.from('the replay')
const SIGNATURE = { size: REPLAY.length, modifiedMs: 1_000_000 }

describe('findReplayCopy', () => {
  test('finds the AutoSave copy in its folder for the day', async () => {
    const deps = fakeFs({
      'replays/AutoSave/20261003/other.rep': { data: 'other game', modifiedMs: 1_000_000 },
      'replays/AutoSave/20261003/[SB]123.rep': { data: 'the replay', modifiedMs: 1_000_500 },
    })
    expect(await findReplayCopy(REPLAY, SIGNATURE, [AUTOSAVE], deps)).toBe(
      path.join('replays', 'AutoSave', '20261003', '[SB]123.rep'),
    )
  })

  test('skips AutoSave copies saved long before or after the game', async () => {
    const deps = fakeFs({
      'replays/AutoSave/old.rep': {
        data: 'the replay',
        modifiedMs: SIGNATURE.modifiedMs - AUTOSAVE_WINDOW_MS - 1,
      },
    })
    expect(await findReplayCopy(REPLAY, SIGNATURE, [AUTOSAVE], deps)).toBeUndefined()
  })

  test('finds an archived copy whenever it was written', async () => {
    const deps = fakeFs({
      'replays/GG Stats/2026-10/game.rep': { data: 'the replay', modifiedMs: 99_999_999 },
    })
    expect(await findReplayCopy(REPLAY, SIGNATURE, [AUTOSAVE, ARCHIVE], deps)).toBe(
      path.join('replays', 'GG Stats', '2026-10', 'game.rep'),
    )
  })

  test('needs the same contents, not just the same size', async () => {
    const deps = fakeFs({
      'replays/AutoSave/same-size.rep': { data: 'the rePlay', modifiedMs: 1_000_000 },
    })
    expect(await findReplayCopy(REPLAY, SIGNATURE, [AUTOSAVE], deps)).toBeUndefined()
  })

  test('copes with folders that do not exist', async () => {
    expect(await findReplayCopy(REPLAY, SIGNATURE, [AUTOSAVE, ARCHIVE], fakeFs({}))).toBeUndefined()
  })
})
