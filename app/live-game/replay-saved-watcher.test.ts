import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  CHECK_DELAY_MS,
  LAST_REPLAY,
  ReplayFolder,
  ReplaySavedWatcher,
  RETRY_WATCH_MS,
} from './replay-saved-watcher'

class FakeFolder implements ReplayFolder {
  savedMs: number | undefined = 1000
  there = true
  onChange: ((file: string) => void) | undefined
  onError: (() => void) | undefined

  save(ms: number) {
    this.savedMs = ms
    this.onChange?.('LastReplay.rep')
  }

  modifiedMs = async (file: string) => (file === LAST_REPLAY ? this.savedMs : undefined)

  watch = (onChange: (file: string) => void, onError: () => void) => {
    if (!this.there) {
      throw new Error('ENOENT')
    }
    this.onChange = onChange
    this.onError = onError
    return () => {
      this.onChange = undefined
    }
  }
}

async function settle() {
  await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS)
}

async function setup(folder = new FakeFolder()) {
  const watcher = new ReplaySavedWatcher(folder)
  const saved: number[] = []
  watcher.on('saved', ms => saved.push(ms))
  watcher.start()
  await settle()
  return { folder, watcher, saved }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ReplaySavedWatcher', () => {
  test('says when a replay is saved, but not the one that was there', async () => {
    const { folder, saved } = await setup()
    expect(saved).toEqual([])
    folder.save(2000)
    await settle()
    expect(saved).toEqual([2000])
  })

  test('checks once for many changes while a replay is written', async () => {
    const { folder, saved } = await setup()
    const check = vi.spyOn(folder, 'modifiedMs')
    folder.save(2000)
    folder.save(2000)
    folder.onChange?.('LastReplay.rep')
    await settle()
    expect(check).toHaveBeenCalledOnce()
    expect(saved).toEqual([2000])
  })

  test('ignores other files and a replay that is no newer', async () => {
    const { folder, saved } = await setup()
    folder.onChange?.('[SB]110856-Big Game Hunters.rep')
    folder.save(1000)
    await settle()
    expect(saved).toEqual([])
  })

  test('counts the first replay ever saved', async () => {
    const folder = new FakeFolder()
    folder.savedMs = undefined
    const { saved } = await setup(folder)
    folder.save(5000)
    await settle()
    expect(saved).toEqual([5000])
  })

  test('watches once StarCraft makes its replay folder, or after watching fails', async () => {
    const folder = new FakeFolder()
    folder.there = false
    const { saved } = await setup(folder)
    folder.there = true
    await vi.advanceTimersByTimeAsync(RETRY_WATCH_MS + CHECK_DELAY_MS)
    folder.save(3000)
    await settle()
    expect(saved).toEqual([3000])
    folder.onError?.()
    expect(folder.onChange).toBeUndefined()
    await vi.advanceTimersByTimeAsync(RETRY_WATCH_MS)
    expect(folder.onChange).toBeDefined()
  })

  test('lets everything go when stopped', async () => {
    const { folder, watcher, saved } = await setup()
    folder.onChange?.('LastReplay.rep')
    watcher.stop()
    folder.savedMs = 9000
    await settle()
    expect(saved).toEqual([])
    expect(folder.onChange).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })
})
