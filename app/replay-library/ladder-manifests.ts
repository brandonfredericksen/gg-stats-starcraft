import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { getErrorStack } from '../../common/errors'
import {
  findLadderPlayer,
  LADDER_MANIFEST_FILE,
  LadderGame,
  LadderManifest,
  parseLadderManifest,
} from '../../common/games/ladder'
import { GameMetrics } from '../../common/games/player-metrics'
import log from '../logger'

interface CachedManifest {
  modifiedMs: number
  manifest: LadderManifest | undefined
}

/**
 * Reads the ladder manifests kept next to replays, which say each player's MMR and rank going into
 * a ladder game. A folder's manifest is read again only once it changes.
 */
export class LadderManifests {
  private cache = new Map<string, CachedManifest>()

  private async read(dir: string): Promise<LadderManifest | undefined> {
    const filePath = path.join(dir, LADDER_MANIFEST_FILE)
    let modifiedMs: number
    try {
      modifiedMs = (await stat(filePath)).mtimeMs
    } catch {
      this.cache.delete(dir)
      return undefined
    }
    const cached = this.cache.get(dir)
    if (cached?.modifiedMs === modifiedMs) {
      return cached.manifest
    }
    let manifest: LadderManifest | undefined
    try {
      manifest = parseLadderManifest(JSON.parse(await readFile(filePath, 'utf8')))
    } catch (err) {
      log.warning(`Couldn't read ${filePath}: ${getErrorStack(err)}`)
    }
    this.cache.set(dir, { modifiedMs, manifest })
    return manifest
  }

  /** The ladder game of each replay that has one, keyed by the replay's lowercased path. */
  async getGames(replayPathKeys: Iterable<string>): Promise<Map<string, LadderGame>> {
    const byDir = new Map<string, string[]>()
    for (const key of replayPathKeys) {
      const dir = path.dirname(key)
      byDir.set(dir, [...(byDir.get(dir) ?? []), key])
    }
    const games = new Map<string, LadderGame>()
    await Promise.all(
      Array.from(byDir, async ([dir, keys]) => {
        const manifest = await this.read(dir)
        if (!manifest) {
          return
        }
        const byFile = new Map(
          Object.entries(manifest.games).map(([name, game]) => [name.toLowerCase(), game]),
        )
        for (const key of keys) {
          const game = byFile.get(path.basename(key))
          if (game) {
            games.set(key, game)
          }
        }
      }),
    )
    return games
  }
}

/** A game's metrics with each player's ladder MMR and rank, where the ladder game has them. */
export function withLadder<T extends GameMetrics>(metrics: T, game: LadderGame | undefined): T {
  if (!game) {
    return metrics
  }
  return {
    ...metrics,
    players: metrics.players.map(p => {
      const ladder = findLadderPlayer(game, p.names, p.race)
      return ladder ? { ...p, mmr: ladder.mmr, rank: ladder.rank } : p
    }),
  }
}
