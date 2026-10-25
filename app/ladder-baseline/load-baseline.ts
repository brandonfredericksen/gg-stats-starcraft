import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import { getErrorStack } from '../../common/errors'
import { LADDER_BASELINE_FILE, parseLadderBaseline } from '../../common/games/ladder-baseline'
import { DatedGameMetrics } from '../../common/my-stats/my-stats'
import { APP_ROOT } from '../app-paths'
import log from '../logger'

const gunzipAsync = promisify(gunzip)

export const LADDER_BASELINE_PATH = path.join(APP_ROOT, 'assets', LADDER_BASELINE_FILE)

/** The id a baseline game made from this replay has, named by its file. */
export function getBaselineGameId(replayPathKey: string) {
  return `ladder-${path.basename(replayPathKey, '.rep')}`
}

/**
 * What tells one game apart: when it started, which every replay of it shares to the second since
 * it comes from the game's seed, and its map.
 */
function getGameKey(game: Pick<DatedGameMetrics, 'gameTimeMs' | 'mapName'>) {
  return `${game.gameTimeMs}|${game.mapName}`
}

/**
 * The baseline's games, leaving out the ones the user has their own copy of: made from a replay in
 * the library, or the same game in another replay, like a top player's own replay of a ladder game
 * that's in the baseline. The user's copy keeps the real names, so the user is still told apart
 * from the players they played.
 */
export function withoutLibraryCopies(
  baseline: ReadonlyArray<DatedGameMetrics>,
  replayPathKeys: ReadonlyArray<string>,
  ownGames: ReadonlyArray<DatedGameMetrics>,
): DatedGameMetrics[] {
  const inLibrary = new Set(replayPathKeys.map(getBaselineGameId))
  const owned = new Set(ownGames.map(getGameKey))
  return baseline.filter(game => !inLibrary.has(game.gameId) && !owned.has(getGameKey(game)))
}

/**
 * The ladder games of the first of `filePaths` with a baseline the app can use, each marked as from
 * the baseline. None if there's no baseline, or each was built with other metrics than these and so
 * can't be compared with them.
 */
export async function loadLadderBaseline(
  filePaths: ReadonlyArray<string> = [LADDER_BASELINE_PATH],
): Promise<DatedGameMetrics[]> {
  for (const filePath of filePaths) {
    const games = await readBaseline(filePath)
    if (games) {
      log.info(`Loaded ${games.length} ladder baseline games from ${filePath}`)
      return games.map(game => ({ ...game, ladderBaseline: true }))
    }
  }
  return []
}

async function readBaseline(filePath: string): Promise<DatedGameMetrics[] | undefined> {
  let data: Buffer
  try {
    data = await readFile(filePath)
  } catch {
    log.verbose(`No ladder baseline at ${filePath}`)
    return undefined
  }
  try {
    const baseline = parseLadderBaseline(JSON.parse((await gunzipAsync(data)).toString('utf8')))
    if (!baseline) {
      log.warning(
        `The ladder baseline at ${filePath} was built with other metrics, so it's left out. ` +
          'Build it again with `pnpm run ladder-baseline --skip-fetch`.',
      )
    }
    return baseline?.games
  } catch (err) {
    log.error(`Couldn't read the ladder baseline at ${filePath}: ${getErrorStack(err)}`)
    return undefined
  }
}
