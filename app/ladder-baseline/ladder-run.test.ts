import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LADDER_MANIFEST_FILE, LadderGame } from '../../common/games/ladder'
import { parseLadderBaseline } from '../../common/games/ladder-baseline'
import {
  GAME_METRICS_VERSION,
  GameMetrics,
  GameShape,
  PlayerMetrics,
} from '../../common/games/player-metrics'
import { GameStatsStore, MetricsListing } from '../game/game-stats-store'
import { exportLadderBaseline, getLadderRunArgs } from './ladder-run'

vi.mock('../logger', () => ({
  default: { verbose: () => {}, info: () => {}, warning: () => {}, error: () => {} },
}))

function player(name: string, race: PlayerMetrics['race']): PlayerMetrics {
  return {
    names: [name],
    race,
    team: 0,
    result: 'win',
    human: true,
    workers: [],
    mined: [],
    income: [],
    armyScore: [],
    bases: [],
    production: [],
    supplyTimesMs: [],
    bank: [],
    supplyBlockedShare: null,
    townHallTimesMs: [],
    firstStartsMs: {},
    opening: [],
    firstArmyMs: null,
    moments: { supplyBlocks: [] } as unknown as PlayerMetrics['moments'],
  }
}

function metrics(gameId: string, shape: GameShape, players: PlayerMetrics[]): GameMetrics {
  return {
    version: GAME_METRICS_VERSION,
    gameId,
    durationMs: 600_000,
    complete: true,
    mapName: 'Polypoid',
    mapFamily: 'standard',
    shape,
    players,
  }
}

const LADDER_GAME: LadderGame = {
  matchId: 'MM-1',
  createdMs: 1_790_000_000_000,
  season: 20,
  players: [
    { name: 'Kestrel', race: 'p', mmr: 1850, rank: 'c' },
    { name: 'Wren', race: 'z', mmr: 1790, rank: 'd' },
  ],
}

describe('app/ladder-baseline/ladder-run', () => {
  test('reads the folder to analyze and where to write the baseline', () => {
    expect(getLadderRunArgs(['electron', 'app', '--hidden'])).toBeUndefined()
    const run = getLadderRunArgs(['app', '--analyze-folder=reps', '--export-baseline=out.json.gz'])
    expect(run).toEqual({
      folder: path.resolve('reps'),
      exportPath: 'out.json.gz',
      retryFailed: false,
    })
    expect(getLadderRunArgs(['app', '--analyze-folder=reps', '--retry-failed'])?.retryFailed).toBe(
      true,
    )
  })

  describe('exporting', () => {
    // Keys are lowercased paths, so the folder's own path has to be lowercase on a case sensitive
    // file system.
    const dir = path.join(tmpdir(), `ggstats-baseline-${process.pid}`)
    const replays = path.join(dir, 'replays')
    const keyOf = (fileName: string) => path.join(replays, fileName).toLowerCase()

    beforeEach(async () => {
      await mkdir(replays, { recursive: true })
      await writeFile(
        path.join(replays, LADDER_MANIFEST_FILE),
        JSON.stringify({
          version: 1,
          games: {
            'abc.rep': LADDER_GAME,
            'def.rep': LADDER_GAME,
            'notime.rep': { ...LADDER_GAME, createdMs: 0 },
          },
        }),
      )
    })

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true })
    })

    test('writes the folder’s 1v1 ladder games, with ranks and made up names', async () => {
      const listings: MetricsListing[] = [
        {
          replayPathKey: keyOf('abc.rep'),
          savedAt: 0,
          metrics: metrics('g1', '1v1', [player('Kestrel', 'p'), player('Wren', 'z')]),
        },
        // Not in the manifest.
        {
          replayPathKey: keyOf('other.rep'),
          savedAt: 0,
          metrics: metrics('g2', '1v1', [player('Kestrel', 'p'), player('Wren', 'z')]),
        },
        // Not 1v1.
        {
          replayPathKey: keyOf('def.rep'),
          savedAt: 0,
          metrics: metrics('g3', '2v2', [player('Kestrel', 'p'), player('Wren', 'z')]),
        },
        // No time to date it by: neither the replay, which can't be read, nor the ladder has one.
        {
          replayPathKey: keyOf('notime.rep'),
          savedAt: 0,
          metrics: metrics('g5', '1v1', [player('Kestrel', 'p'), player('Wren', 'z')]),
        },
        // Not in the folder.
        {
          replayPathKey: path.join(dir, 'abc.rep').toLowerCase(),
          savedAt: 0,
          metrics: metrics('g4', '1v1', [player('Kestrel', 'p'), player('Wren', 'z')]),
        },
      ]
      const store = { listMetrics: async () => listings } as unknown as GameStatsStore
      const exportPath = path.join(dir, 'baseline.json.gz')
      await exportLadderBaseline({ folder: replays, exportPath, gameStatsStore: store })

      const baseline = parseLadderBaseline(
        JSON.parse(gunzipSync(await readFile(exportPath)).toString('utf8')),
      )
      expect(baseline?.games).toHaveLength(1)
      const [game] = baseline!.games
      expect(game).toMatchObject({ gameId: 'ladder-abc', gameTimeMs: LADDER_GAME.createdMs })
      const [kestrel, wren] = game.players
      expect(kestrel).toMatchObject({ race: 'p', mmr: 1850, rank: 'c' })
      expect(wren).toMatchObject({ race: 'z', mmr: 1790, rank: 'd' })
      expect(kestrel.moments).toBeUndefined()
      expect(kestrel.names[0]).toMatch(/^#[0-9a-f]{12}$/)
      expect(kestrel.names[0]).not.toBe(wren.names[0])
      expect(JSON.stringify(baseline)).not.toMatch(/kestrel|wren/i)
    })
  })
})
