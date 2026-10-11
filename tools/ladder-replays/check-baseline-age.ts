/**
 * Warns when the ladder baseline the app ships is old: `pnpm run check-baseline-age`. The builds
 * top players use change with patches and map pools, and the baseline only catches up when it's
 * built again with `pnpm run ladder-baseline`, which needs StarCraft and so can't run in CI. In a
 * GitHub workflow the warning is an annotation on the run. It never fails, so a fix can still ship.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { LADDER_BASELINE_FILE } from '../../common/games/ladder-baseline'

/** A baseline older than this is worth building again before a release. */
export const BASELINE_MAX_AGE_DAYS = 30

const BASELINE_PATH = path.join(
  import.meta.dirname,
  '..',
  '..',
  'app',
  'assets',
  LADDER_BASELINE_FILE,
)

/** How many whole days ago the baseline was built, or undefined without one to read. */
export function getBaselineAgeDays(now = Date.now()): number | undefined {
  try {
    const { createdMs } = JSON.parse(gunzipSync(readFileSync(BASELINE_PATH)).toString('utf8'))
    return typeof createdMs === 'number'
      ? Math.floor((now - createdMs) / (24 * 60 * 60_000))
      : undefined
  } catch {
    return undefined
  }
}

/** What to say about the baseline's age, or undefined when it's recent. */
export function getBaselineAgeWarning(now = Date.now()): string | undefined {
  const age = getBaselineAgeDays(now)
  if (age === undefined) {
    return `Couldn't read the ladder baseline at ${BASELINE_PATH}.`
  }
  return age > BASELINE_MAX_AGE_DAYS
    ? `The ladder baseline is ${age} days old. Build it again with ` +
        '`pnpm run ladder-baseline --dir <folder>` so the meta builds keep up.'
    : undefined
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const warning = getBaselineAgeWarning()
  if (warning) {
    console.log(process.env.GITHUB_ACTIONS ? `::warning::${warning}` : warning)
  } else {
    console.log(`The ladder baseline is ${getBaselineAgeDays()} days old.`)
  }
}
