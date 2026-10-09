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

/**
 * The ladder games shipped with the app, each marked as from the baseline. None if there's no
 * baseline, or it was built with other metrics than these and so can't be compared with them.
 */
export async function loadLadderBaseline(
  filePath = LADDER_BASELINE_PATH,
): Promise<DatedGameMetrics[]> {
  let data: Buffer
  try {
    data = await readFile(filePath)
  } catch {
    log.verbose(`No ladder baseline at ${filePath}`)
    return []
  }
  try {
    const baseline = parseLadderBaseline(JSON.parse((await gunzipAsync(data)).toString('utf8')))
    if (!baseline) {
      log.warning(
        `The ladder baseline at ${filePath} was built with other metrics, so it's left out. ` +
          'Build it again with `pnpm run ladder-baseline --skip-fetch`.',
      )
      return []
    }
    log.info(`Loaded ${baseline.games.length} ladder baseline games`)
    return baseline.games.map(game => ({ ...game, ladderBaseline: true }))
  } catch (err) {
    log.error(`Couldn't read the ladder baseline at ${filePath}: ${getErrorStack(err)}`)
    return []
  }
}
