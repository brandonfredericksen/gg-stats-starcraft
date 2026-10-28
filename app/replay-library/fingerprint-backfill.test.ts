import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FINGERPRINT_VERSION, GameFingerprint } from '../../common/games/fingerprint'
import { FingerprintBackfill, FingerprintStore } from './fingerprint-backfill'

const logger = { error: vi.fn(), warning: vi.fn(), verbose: vi.fn() }

function print(name: string): GameFingerprint {
  return { name, race: 'p', features: [1, 2], actions: 300 }
}

/** A store of `count` replays, keeping what's saved for each. */
function makeStore(count: number) {
  const saved = new Map<number, ReadonlyArray<GameFingerprint>>()
  const store: FingerprintStore = {
    listUnfingerprinted: (version, limit) => {
      expect(version).toBe(FINGERPRINT_VERSION)
      return Array.from({ length: count }, (_, id) => ({ id, path: `${id}.rep` }))
        .filter(({ id }) => !saved.has(id))
        .slice(0, limit)
    },
    saveFingerprints: (id, version, prints) => {
      expect(version).toBe(FINGERPRINT_VERSION)
      saved.set(id, prints)
    },
  }
  return { store, saved }
}

describe('app/replay-library/fingerprint-backfill', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('reads every replay, and marks the ones it fails to read', async () => {
    const { store, saved } = makeStore(120)
    const onSaved = vi.fn()
    const backfill = new FingerprintBackfill(
      store,
      async path => {
        if (path === '5.rep') {
          throw new Error('broken')
        }
        return [print(path)]
      },
      () => false,
      onSaved,
      logger,
    )
    backfill.schedule()
    await vi.runAllTimersAsync()
    expect(saved.size).toBe(120)
    expect(saved.get(5)).toEqual([])
    expect(saved.get(6)).toEqual([print('6.rep')])
    expect(onSaved).toHaveBeenCalledTimes(3)
  })

  test('waits while the library is indexed', async () => {
    const { store, saved } = makeStore(3)
    let indexing = true
    const backfill = new FingerprintBackfill(
      store,
      async path => [print(path)],
      () => indexing,
      () => {},
      logger,
    )
    backfill.schedule()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(saved.size).toBe(0)
    indexing = false
    await vi.runAllTimersAsync()
    expect(saved.size).toBe(3)
  })

  test("skips a replay it can't save rather than trying it forever", async () => {
    const { store, saved } = makeStore(3)
    const backfill = new FingerprintBackfill(
      {
        ...store,
        saveFingerprints: (id, version, prints) => {
          if (id === 1) {
            throw new Error('gone')
          }
          store.saveFingerprints(id, version, prints)
        },
      },
      async path => [print(path)],
      () => false,
      () => {},
      logger,
    )
    backfill.schedule()
    await vi.runAllTimersAsync()
    expect(Array.from(saved.keys()).sort()).toEqual([0, 2])
  })
})
