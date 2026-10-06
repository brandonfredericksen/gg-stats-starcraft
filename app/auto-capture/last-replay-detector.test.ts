import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  DetectorDeps,
  FileSignature,
  LastReplayDetector,
  POLL_MS,
  QUIET_MS,
  SETTLE_MS,
} from './last-replay-detector'

const FILE = 'C:\\Replays\\LastReplay.rep'

class FakeFile {
  signature: FileSignature | undefined
  data = Buffer.alloc(0)
  busyReads = 0
  onChange: ((fileName: string) => void) | undefined

  write(content: string, modifiedMs: number) {
    this.data = Buffer.from(content)
    this.signature = { size: this.data.length, modifiedMs }
  }

  deps(): DetectorDeps {
    return {
      stat: async () => this.signature,
      readFile: async () => {
        if (this.busyReads > 0) {
          this.busyReads -= 1
          throw Object.assign(new Error('busy'), { code: 'EBUSY' })
        }
        return this.data
      },
      watchFolder: (_folder, onChange) => {
        this.onChange = onChange
        return () => {
          this.onChange = undefined
        }
      },
    }
  }
}

describe('LastReplayDetector', () => {
  let file: FakeFile
  let found: string[]
  let detector: LastReplayDetector | undefined

  function start(lastSeen?: FileSignature) {
    detector = new LastReplayDetector(FILE, file.deps(), lastSeen)
    detector.on('replay', data => found.push(data.toString()))
    detector.start()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    file = new FakeFile()
    found = []
  })

  afterEach(() => {
    detector?.stop()
    vi.useRealTimers()
  })

  test('reads a replay already there at startup once it has settled', async () => {
    file.write('game 1', 1)
    start()

    await vi.advanceTimersByTimeAsync(QUIET_MS)
    expect(found).toEqual([])
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(found).toEqual(['game 1'])
  })

  test('leaves alone the version it already handled', async () => {
    file.write('game 1', 1)
    start({ size: 6, modifiedMs: 1 })

    await vi.advanceTimersByTimeAsync(POLL_MS * 2)
    expect(found).toEqual([])
  })

  test('picks up each new game once, from watching or polling', async () => {
    start()
    file.write('game 1', 1)
    file.onChange!('LastReplay.rep')
    await vi.advanceTimersByTimeAsync(QUIET_MS + SETTLE_MS)
    expect(found).toEqual(['game 1'])

    // Watching missed this one, so the poll finds it.
    file.write('game 22', 2)
    await vi.advanceTimersByTimeAsync(POLL_MS + QUIET_MS + SETTLE_MS)
    expect(found).toEqual(['game 1', 'game 22'])

    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(found).toEqual(['game 1', 'game 22'])
  })

  test('ignores other files in the folder', async () => {
    start()
    await vi.advanceTimersByTimeAsync(QUIET_MS + SETTLE_MS)
    file.write('game 1', 1)
    file.onChange!('Other.rep')
    await vi.advanceTimersByTimeAsync(QUIET_MS + SETTLE_MS)
    expect(found).toEqual([])
  })

  test('waits until the file stops changing', async () => {
    start()
    file.write('game', 1)
    file.onChange!('LastReplay.rep')
    await vi.advanceTimersByTimeAsync(QUIET_MS)
    // Still being written between the two checks.
    file.write('game 1 done', 2)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(found).toEqual([])

    await vi.advanceTimersByTimeAsync(QUIET_MS + SETTLE_MS)
    expect(found).toEqual(['game 1 done'])
  })

  test('retries a file that is busy', async () => {
    start()
    file.write('game 1', 1)
    file.busyReads = 2
    file.onChange!('LastReplay.rep')
    await vi.advanceTimersByTimeAsync(QUIET_MS + SETTLE_MS)
    expect(found).toEqual([])
    await vi.advanceTimersByTimeAsync(1000 + 2000)
    expect(found).toEqual(['game 1'])
  })
})
