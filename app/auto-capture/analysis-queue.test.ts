import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AnalysisQueue,
  MAX_CONSECUTIVE_FAILURES,
  QueuedReplay,
  RETRY_DELAY_MS,
} from './analysis-queue'

function replay(path: string) {
  return { path, name: path, seed: 0, summary: { mapName: 'Polypoid' } }
}

describe('AnalysisQueue', () => {
  let idle: boolean
  let launched: string[]
  let saved: ReadonlyArray<QueuedReplay>
  let nextId: number
  let queue: AnalysisQueue

  function makeQueue(initial: QueuedReplay[] = []) {
    return new AnalysisQueue(
      {
        launch: replay => {
          if (!idle) {
            return null
          }
          launched.push(replay.path)
          nextId += 1
          return `game-${nextId}`
        },
        isIdle: () => idle,
        save: replays => {
          saved = replays.map(r => ({ ...r }))
        },
      },
      initial,
    )
  }

  beforeEach(() => {
    vi.useFakeTimers()
    idle = true
    launched = []
    saved = []
    nextId = 0
    queue = makeQueue()
  })

  afterEach(() => {
    queue.stop()
    vi.useRealTimers()
  })

  test('analyzes replays one at a time, in order', () => {
    queue.add(replay('a.rep'))
    queue.add(replay('b.rep'))
    expect(launched).toEqual(['a.rep'])

    queue.finish('game-1', 'analyzed')
    expect(launched).toEqual(['a.rep', 'b.rep'])
    queue.finish('game-2', 'analyzed')
    expect(queue.pending).toEqual([])
    expect(saved).toEqual([])
  })

  test('ignores a replay that is already waiting', () => {
    idle = false
    queue.add(replay('a.rep'))
    queue.add(replay('a.rep'))
    expect(queue.pending).toHaveLength(1)
  })

  test('drops waiting replays but lets the running one finish', () => {
    queue.add(replay('a.rep'))
    queue.add(replay('b.rep'))
    queue.add(replay('c.rep'))
    queue.clearWaiting()
    expect(saved.map(r => r.path)).toEqual(['a.rep'])

    queue.finish('game-1', 'analyzed')
    expect(launched).toEqual(['a.rep'])
    expect(saved).toEqual([])
  })

  test('holds new analyses while paused, keeping every replay, and lets the running one finish', () => {
    queue.add(replay('a.rep'))
    queue.add(replay('b.rep'))
    queue.hold(true)
    queue.finish('game-1', 'analyzed')
    queue.add(replay('c.rep'))
    expect(launched).toEqual(['a.rep'])
    expect(saved.map(r => r.path)).toEqual(['b.rep', 'c.rep'])

    queue.hold(false)
    expect(launched).toEqual(['a.rep', 'b.rep'])
  })

  test('waits for StarCraft to be free', () => {
    idle = false
    queue.add(replay('a.rep'))
    expect(launched).toEqual([])

    idle = true
    queue.tryStart()
    expect(launched).toEqual(['a.rep'])
  })

  test('tries a replaced analysis again without counting it as a failure', () => {
    queue.add(replay('a.rep'))
    idle = false
    queue.finish('game-1', 'replaced')
    expect(queue.pending[0].attempts).toBe(0)

    idle = true
    queue.tryStart()
    expect(launched).toEqual(['a.rep', 'a.rep'])
  })

  test('retries a failure once after a delay, then gives up', () => {
    const gaveUp: string[] = []
    queue.on('gaveUp', replay => gaveUp.push(replay.path))
    queue.add(replay('a.rep'))

    queue.finish('game-1', 'failed')
    expect(launched).toEqual(['a.rep'])
    vi.advanceTimersByTime(RETRY_DELAY_MS)
    expect(launched).toEqual(['a.rep', 'a.rep'])

    queue.finish('game-2', 'failed')
    expect(gaveUp).toEqual(['a.rep'])
    expect(queue.pending).toEqual([])
  })

  test('moves on to other replays while one waits to be retried', () => {
    queue.add(replay('a.rep'))
    queue.add(replay('b.rep'))
    queue.finish('game-1', 'failed')
    expect(launched).toEqual(['a.rep', 'b.rep'])
  })

  test(`pauses after ${MAX_CONSECUTIVE_FAILURES} failures in a row until resumed`, () => {
    let paused = 0
    queue.on('paused', () => paused++)
    for (const path of ['a.rep', 'b.rep', 'c.rep', 'd.rep']) {
      queue.add(replay(path))
    }
    queue.finish('game-1', 'failed')
    queue.finish('game-2', 'failed')
    queue.finish('game-3', 'failed')
    expect(paused).toBe(1)
    expect(queue.paused).toBe(true)
    expect(launched).toEqual(['a.rep', 'b.rep', 'c.rep'])

    queue.resume()
    expect(launched).toEqual(['a.rep', 'b.rep', 'c.rep', 'd.rep'])
  })

  test('picks up where it left off after a restart', () => {
    queue.add(replay('a.rep'))
    queue.stop()

    launched = []
    queue = makeQueue([...saved])
    queue.tryStart()
    expect(launched).toEqual(['a.rep'])
  })

  test('ignores outcomes of games it did not start', () => {
    queue.add(replay('a.rep'))
    queue.finish('someone-else', 'failed')
    expect(queue.runningGameId).toBe('game-1')
  })

  test('still analyzes replays the user asked for while disabled', () => {
    queue.setEnabled(false)
    queue.add(replay('a.rep'))
    queue.add({ ...replay('b.rep'), manual: true })
    expect(launched).toEqual(['b.rep'])
  })

  test('does nothing while disabled', () => {
    queue.setEnabled(false)
    queue.add(replay('a.rep'))
    expect(launched).toEqual([])
    queue.setEnabled(true)
    expect(launched).toEqual(['a.rep'])
  })
})
