import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LiveGame } from '../../common/live-game'
import { LocalSettings } from '../../common/settings/local-settings'
import { LiveGameService } from './index'
import { ReplaySavedWatcher } from './replay-saved-watcher'
import { ScrCacheWatcher } from './scr-cache-watcher'
import { ShieldBatteryLogWatcher } from './shieldbattery-log-watcher'

vi.mock('../logger', () => ({ default: { warning: vi.fn(), error: vi.fn(), info: vi.fn() } }))

class FakeSettings extends EventEmitter<{ change: [Partial<LocalSettings>] }> {
  settings: Partial<LocalSettings> = {}
  get = async () => this.settings
}

const NO_FILES = { size: async () => undefined, read: async () => undefined }

function setup() {
  const settings = new FakeSettings()
  const games: Array<LiveGame | undefined> = []
  let cacheWatcher: ScrCacheWatcher | undefined
  let shieldBatteryWatcher: ShieldBatteryLogWatcher | undefined
  let replaySavedWatcher: ReplaySavedWatcher | undefined
  const service = new LiveGameService({
    localSettings: settings,
    browserCacheFolder: '',
    shieldBatteryLogFolder: '',
    replayFolder: '',
    onChange: game => games.push(game),
    createCacheWatcher: () => {
      cacheWatcher = new ScrCacheWatcher(NO_FILES)
      return cacheWatcher
    },
    createShieldBatteryWatcher: () => {
      shieldBatteryWatcher = new ShieldBatteryLogWatcher({
        stat: async () => undefined,
        read: async () => undefined,
        watch: () => {
          throw new Error('ENOENT')
        },
      })
      return shieldBatteryWatcher
    },
    createReplaySavedWatcher: () => {
      replaySavedWatcher = new ReplaySavedWatcher({
        modifiedMs: async () => undefined,
        watch: () => {
          throw new Error('ENOENT')
        },
      })
      return replaySavedWatcher
    },
  })
  return {
    service,
    settings,
    games,
    cache: () => cacheWatcher!,
    shieldBattery: () => shieldBatteryWatcher!,
    replaySaved: () => replaySavedWatcher!,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LiveGameService', () => {
  test('follows a ladder match the cache names', async () => {
    const t = setup()
    await t.service.start()
    t.cache().emit('sighting', {
      kind: 'matchPage',
      port: 50072,
      panelId: 2,
      createdMs: 2000,
      atMs: 2000,
    })
    expect(t.service.game?.source).toBe('ladder')
  })

  test('takes a ShieldBattery game over a ladder match', async () => {
    const t = setup()
    await t.service.start()
    t.cache().emit('sighting', {
      kind: 'matchPage',
      port: 50072,
      panelId: 2,
      createdMs: 2000,
      atMs: 2000,
    })
    t.shieldBattery().emit('players', [{ name: 'a' }, { name: 'b' }])
    expect(t.service.game?.source).toBe('shieldBattery')
  })

  test('ends a game when its replay is saved, or when ShieldBattery says it did', async () => {
    const t = setup()
    await t.service.start()
    t.shieldBattery().emit('players', [{ name: 'a' }])
    vi.advanceTimersByTime(1000)
    t.replaySaved().emit('saved', Date.now())
    expect(t.service.game).toBeUndefined()
    t.shieldBattery().emit('players', [{ name: 'b' }])
    vi.advanceTimersByTime(1000)
    t.shieldBattery().emit('ended')
    expect(t.service.game).toBeUndefined()
  })

  test('lets go of everything when turned off, and watches again when turned on', async () => {
    const t = setup()
    await t.service.start()
    const firstCache = t.cache()
    t.shieldBattery().emit('players', [{ name: 'a' }])
    t.settings.emit('change', { liveGame: false })
    expect(firstCache.listenerCount('sighting')).toBe(0)
    expect(t.games.at(-1)).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    t.settings.emit('change', { liveGame: true })
    expect(t.cache()).not.toBe(firstCache)
    t.service.stop()
  })

  test("doesn't start when the setting is off, or when stopped before it read the setting", async () => {
    const off = setup()
    off.settings.settings = { liveGame: false }
    await off.service.start()
    expect(vi.getTimerCount()).toBe(0)

    const stopped = setup()
    const starting = stopped.service.start()
    stopped.service.stop()
    await starting
    expect(vi.getTimerCount()).toBe(0)
  })
})
