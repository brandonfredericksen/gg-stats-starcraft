import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { saveReplay } from './replay-save'

describe('saveReplay', () => {
  let folder: string

  beforeEach(async () => {
    folder = path.join(await mkdtemp(path.join(tmpdir(), 'replay-save-')), 'GG Stats', '2026-10')
  })

  afterEach(async () => {
    await rm(path.dirname(path.dirname(folder)), { recursive: true, force: true })
  })

  test('creates the folder and saves the replay, leaving no temporary file', async () => {
    const result = await saveReplay(folder, 'game', Buffer.from('replay one'))
    expect(result).toEqual({ path: path.join(folder, 'game.rep'), alreadyExists: false })
    expect((await readFile(result.path)).toString()).toBe('replay one')
    expect(await readdir(folder)).toEqual(['game.rep'])
  })

  test('reuses an identical replay and numbers a different one', async () => {
    await saveReplay(folder, 'game', Buffer.from('replay one'))

    expect(await saveReplay(folder, 'game', Buffer.from('replay one'))).toEqual({
      path: path.join(folder, 'game.rep'),
      alreadyExists: true,
    })
    expect(await saveReplay(folder, 'game', Buffer.from('replay two'))).toEqual({
      path: path.join(folder, 'game (2).rep'),
      alreadyExists: false,
    })
  })
})
