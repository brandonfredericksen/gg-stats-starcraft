import { mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LADDER_MANIFEST_FILE, LadderGame } from '../../common/games/ladder'
import { GAME_METRICS_VERSION, GameMetrics, PlayerMetrics } from '../../common/games/player-metrics'
import { LadderManifests, withLadder } from './ladder-manifests'

vi.mock('../logger', () => ({
  default: { verbose: () => {}, warning: () => {}, error: () => {} },
}))

const GAME: LadderGame = {
  matchId: 'MM-1',
  createdMs: 1_700_000_000_000,
  season: 20,
  players: [
    { name: 'Kestrel', race: 'p', mmr: 1850, rank: 'c' },
    { name: 'Wren', race: 'z', mmr: 1790, rank: 'd' },
  ],
}

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
  }
}

describe('app/replay-library/ladder-manifests', () => {
  // Keys are lowercased paths, so the folder's own path has to be lowercase on a case sensitive
  // file system.
  const dir = path.join(tmpdir(), `ggstats-ladder-${process.pid}`)
  const keyOf = (fileName: string) => path.join(dir, fileName).toLowerCase()

  beforeEach(async () => {
    await mkdir(dir, { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('finds the ladder game of each replay in a folder with a manifest', async () => {
    await writeFile(
      path.join(dir, LADDER_MANIFEST_FILE),
      JSON.stringify({ version: 1, games: { 'ABC.rep': GAME } }),
    )
    const games = await new LadderManifests().getGames([keyOf('abc.rep'), keyOf('other.rep')])
    expect(Array.from(games.keys())).toEqual([keyOf('abc.rep')])
  })

  test('reads a manifest again once it changes', async () => {
    const manifestPath = path.join(dir, LADDER_MANIFEST_FILE)
    await writeFile(manifestPath, JSON.stringify({ version: 1, games: {} }))
    const manifests = new LadderManifests()
    expect((await manifests.getGames([keyOf('abc.rep')])).size).toBe(0)

    await writeFile(manifestPath, JSON.stringify({ version: 1, games: { 'abc.rep': GAME } }))
    const later = new Date(Date.now() + 10_000)
    await utimes(manifestPath, later, later)
    expect((await manifests.getGames([keyOf('abc.rep')])).size).toBe(1)
  })

  test('has nothing for a folder without a manifest, or with a broken one', async () => {
    expect((await new LadderManifests().getGames([keyOf('abc.rep')])).size).toBe(0)
    await writeFile(path.join(dir, LADDER_MANIFEST_FILE), '{')
    expect((await new LadderManifests().getGames([keyOf('abc.rep')])).size).toBe(0)
  })

  test("adds each player's MMR and rank to a game's metrics", () => {
    const metrics: GameMetrics = {
      version: GAME_METRICS_VERSION,
      gameId: 'g',
      durationMs: 600_000,
      complete: true,
      mapName: 'Polypoid',
      mapFamily: 'standard',
      shape: '1v1',
      players: [player('Kestrel', 'p'), player('Somebody', 'z')],
    }
    const [kestrel, other] = withLadder(metrics, GAME).players
    expect(kestrel).toMatchObject({ mmr: 1850, rank: 'c' })
    expect(other).toMatchObject({ mmr: 1790, rank: 'd' })
    expect(withLadder(metrics, undefined)).toBe(metrics)
  })
})
