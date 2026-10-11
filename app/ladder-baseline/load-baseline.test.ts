import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LADDER_BASELINE_VERSION } from '../../common/games/ladder-baseline'
import { GAME_METRICS_VERSION } from '../../common/games/player-metrics'
import { DatedGameMetrics } from '../../common/my-stats/my-stats'
import { loadLadderBaseline, withoutLibraryCopies } from './load-baseline'

vi.mock('../logger', () => ({
  default: { verbose: () => {}, info: () => {}, warning: () => {}, error: () => {} },
}))

const GAME = {
  version: GAME_METRICS_VERSION,
  gameId: 'ladder-abc',
  durationMs: 600_000,
  complete: true,
  mapName: 'Polypoid',
  mapFamily: 'standard',
  shape: '1v1',
  players: [],
  gameTimeMs: 1_790_000_000_000,
}

describe('app/ladder-baseline/load-baseline', () => {
  let dir: string
  let filePath: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ggstats-baseline-'))
    filePath = path.join(dir, 'baseline.json.gz')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const write = (value: unknown) => writeFile(filePath, gzipSync(JSON.stringify(value)))

  test("loads the baseline's games, marked as from it", async () => {
    await write({
      version: LADDER_BASELINE_VERSION,
      metricsVersion: GAME_METRICS_VERSION,
      createdMs: 1,
      games: [GAME],
    })
    expect(await loadLadderBaseline(filePath)).toEqual([{ ...GAME, ladderBaseline: true }])
  })

  test('leaves out a baseline built with other metrics', async () => {
    await write({
      version: LADDER_BASELINE_VERSION,
      metricsVersion: GAME_METRICS_VERSION - 1,
      createdMs: 1,
      games: [GAME],
    })
    expect(await loadLadderBaseline(filePath)).toEqual([])
  })

  test('has no games without a baseline, or with a broken one', async () => {
    expect(await loadLadderBaseline(filePath)).toEqual([])
    await writeFile(filePath, 'not gzip')
    expect(await loadLadderBaseline(filePath)).toEqual([])
  })

  test('leaves out the games made from a replay in the library', () => {
    const other = { ...GAME, gameId: 'ladder-def' } as DatedGameMetrics
    const games = [GAME as DatedGameMetrics, other]
    const keys = [path.join('c:', 'replays', 'ladder', 'abc.rep')]
    expect(withoutLibraryCopies(games, keys)).toEqual([other])
  })
})
