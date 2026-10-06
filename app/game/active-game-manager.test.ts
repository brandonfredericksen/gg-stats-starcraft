import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameLaunchConfig } from '../../common/games/game-launch-config'
import { GameStatus } from '../../common/games/game-status'
import { ActiveGameManager } from './active-game-manager'

// ActiveGameManager pulls in Electron (and modules that initialize against a real Electron
// process) at module scope; these are irrelevant to the behavior under test, so they're stubbed
// just far enough for the module to load. The launch path is pinned mid-flight
// (`checkStarcraftPath` never resolves) so no game process is ever spawned and no
// launch-error/exit handler can clear the active game out from under the test.
vi.mock('electron', () => ({ app: { getAppPath: () => 'C:\\fake-app' }, screen: {} }))
vi.mock('@shieldbattery/windows-registry', () => ({
  HKCU: 'HKCU',
  REG_SZ: 'REG_SZ',
  WindowsRegistry: class {},
}))
vi.mock('../logger', () => ({
  default: { verbose: () => {}, warning: () => {}, error: () => {} },
}))
vi.mock('../log-paths', () => ({ gameLogBaseName: () => 'game' }))
vi.mock('../settings', () => ({
  LocalSettingsManager: class {},
  ScrSettingsManager: class {},
}))
vi.mock('./check-starcraft-path', () => ({
  checkStarcraftPath: () => new Promise(() => {}),
}))

function makeManager(): ActiveGameManager {
  // The launch path's very first step awaits the local settings; pinning that await keeps the
  // launch permanently in flight (see the `checkStarcraftPath` mock note above), so the launch
  // outcome handlers never race the assertions.
  const neverSettings = { get: () => new Promise(() => {}) }
  return new ActiveGameManager(neverSettings as any, neverSettings as any)
}

const REPLAY_PATH = String.raw`C:\Replays\game.rep`

function replayConfigFor(gameId: string, analyze: boolean): GameLaunchConfig {
  return {
    setup: {
      gameId,
      name: 'game.rep',
      map: { isReplay: true, path: REPLAY_PATH, analyze, linkedGameId: 'linked-game' },
    },
  } as unknown as GameLaunchConfig
}

function analysisConfigFor(gameId: string): GameLaunchConfig {
  return replayConfigFor(gameId, true)
}

describe('ActiveGameManager launches', () => {
  it('refuses a config that is not a replay', () => {
    const manager = makeManager()
    const config = {
      setup: { gameId: 'live-game', map: { hash: 'abc' } },
    } as unknown as GameLaunchConfig

    expect(manager.setGameConfig(config)).toBeNull()
    expect(manager.getStatus()).toBeNull()
  })
})

describe('ActiveGameManager replay analysis', () => {
  let manager: ActiveGameManager
  let commands: Array<[string, string, ...any[]]>

  beforeEach(() => {
    manager = makeManager()
    commands = []
    manager.on('gameCommand', (gameId, command, ...args) => {
      commands.push([gameId, command, ...args])
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("won't replace a replay someone is watching to analyze another", () => {
    manager.setGameConfig(replayConfigFor('watching', false))

    expect(manager.setGameConfig(analysisConfigFor('analysis'))).toBeNull()
    expect(manager.getStatus()?.id).toBe('watching')
    expect(commands).not.toContainEqual(['watching', 'quit'])
  })

  it('lets a new analysis replace a running one', () => {
    manager.setGameConfig(analysisConfigFor('first'))

    expect(manager.setGameConfig(analysisConfigFor('second'))).toBe('second')
    expect(commands).toContainEqual(['first', 'quit'])
  })

  it('reports where analyzed stats came from, then quits', () => {
    const reported: unknown[] = []
    manager.on('gameStats', (gameId, _stats, source) => reported.push([gameId, source]))
    manager.setGameConfig(analysisConfigFor('analysis'))

    manager.handleGameStats('analysis', {
      mapName: '',
      frames: 1,
      complete: true,
      snapshotFrames: [],
      players: [],
    })

    expect(reported).toEqual([
      [
        'analysis',
        { kind: 'replay', name: 'game.rep', path: REPLAY_PATH, linkedGameId: 'linked-game' },
      ],
    ])
    expect(commands).toContainEqual(['analysis', 'quit'])
  })

  it('stops an analysis that never gets going', () => {
    vi.useFakeTimers()
    manager.setGameConfig(analysisConfigFor('analysis'))

    vi.advanceTimersByTime(90 * 1000)

    expect(commands).toContainEqual(['analysis', 'quit'])
    expect(manager.getStatus()).toBeNull()
  })

  it('gives a loaded replay longer to reach its end', () => {
    vi.useFakeTimers()
    manager.setGameConfig(analysisConfigFor('analysis'))
    vi.advanceTimersByTime(30 * 1000)
    manager.handleGameStart('analysis')

    vi.advanceTimersByTime(4 * 60 * 1000)
    expect(manager.getStatus()?.id).toBe('analysis')

    vi.advanceTimersByTime(60 * 1000)
    expect(commands).toContainEqual(['analysis', 'quit'])
    expect(manager.getStatus()).toBeNull()
  })

  it("doesn't stop an analysis that already reported", () => {
    vi.useFakeTimers()
    manager.setGameConfig(analysisConfigFor('analysis'))
    manager.handleGameStats('analysis', {
      mapName: '',
      frames: 1,
      complete: true,
      snapshotFrames: [],
      players: [],
    })

    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(commands.filter(([, command]) => command === 'quit')).toHaveLength(1)
  })

  it('quits an analysis whose setup failed, since nobody can see it waiting', () => {
    manager.setGameConfig(analysisConfigFor('analysis'))

    manager.handleSetupProgress('analysis', { state: GameStatus.Error, extra: 'Bad replay' })

    expect(commands).toContainEqual(['analysis', 'quit'])
  })
})
