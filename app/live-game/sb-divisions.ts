/**
 * ShieldBattery's divisions, worked out from a season's points the way ShieldBattery does, since its
 * profiles send points and not divisions. Each division starts at a number of points that rises with
 * the season's bonus pool, by a factor that grows toward the top divisions.
 */

/** [division, lowest points, points it ends at, bonus pool factor low, bonus pool factor high] */
type DivisionBounds = readonly [string, number, number, number, number]

const SOLO_DIVISIONS: ReadonlyArray<DivisionBounds> = [
  ['bronze1', -Infinity, 800, 0, 0],
  ['bronze2', 800, 1520, 0, 0],
  ['bronze3', 1520, 2240, 0, 0],
  ['silver1', 2240, 2960, 0, 0.3],
  ['silver2', 2960, 3680, 0.3, 0.3],
  ['silver3', 3680, 4400, 0.3, 0.3],
  ['gold1', 4400, 5120, 0.3, 0.6],
  ['gold2', 5120, 5840, 0.6, 0.6],
  ['gold3', 5840, 6560, 0.6, 0.6],
  ['platinum1', 6560, 6800, 0.6, 1],
  ['platinum2', 6800, 7040, 1, 1],
  ['platinum3', 7040, 7280, 1, 1],
  ['diamond1', 7280, 7520, 1, 1],
  ['diamond2', 7520, 7760, 1, 1],
  ['diamond3', 7760, 8000, 1, 1],
  ['champion', 8000, Infinity, 1, 1],
]

const TEAM_DIVISIONS: ReadonlyArray<DivisionBounds> = [
  ['bronze1', -Infinity, 700, 0, 0],
  ['bronze2', 700, 1400, 0, 0],
  ['bronze3', 1400, 2100, 0, 0],
  ['silver1', 2100, 2800, 0, 0.3],
  ['silver2', 2800, 3500, 0.3, 0.3],
  ['silver3', 3500, 4200, 0.3, 0.3],
  ['gold1', 4200, 4900, 0.3, 0.6],
  ['gold2', 4900, 5600, 0.6, 0.6],
  ['gold3', 5600, 6300, 0.6, 0.6],
  ['platinum1', 6300, 6500, 0.6, 1],
  ['platinum2', 6500, 6700, 1, 1],
  ['platinum3', 6700, 6900, 1, 1],
  ['diamond1', 6900, 7100, 1, 1],
  ['diamond2', 7100, 7300, 1, 1],
  ['diamond3', 7300, 7500, 1, 1],
  ['champion', 7500, Infinity, 1, 1],
]

const WEEK_MS = 7 * 24 * 60 * 60_000
/** Bonus points the pool gains each ms of a season: 200 a week. */
const BONUS_PER_MS = 200 / WEEK_MS
/** The pool stops growing this long before a season ends. */
const BONUS_FREEZE_MS = WEEK_MS

/** The season's bonus pool at `atMs`, for a season that started at `startMs`. */
export function getBonusPool(atMs: number, startMs: number, endMs?: number) {
  const until = endMs === undefined ? atMs : Math.min(atMs, endMs - BONUS_FREEZE_MS)
  return Math.max(0, Math.floor((until - startMs) * BONUS_PER_MS))
}

/**
 * The division a season of `mode`, like `1v1` or `3v3bgh`, is in, with `points` when the bonus pool
 * is `bonusPool`: `unrated` before the first game.
 */
export function getShieldBatteryDivision(
  mode: string,
  season: { points: number; wins: number; losses: number },
  bonusPool: number,
) {
  if (!season.points && season.wins + season.losses === 0) {
    return 'unrated'
  }
  const divisions = mode.startsWith('1v1') ? SOLO_DIVISIONS : TEAM_DIVISIONS
  const found = divisions.find(
    ([, low, high, factorLow, factorHigh]) =>
      season.points >= low + bonusPool * factorLow && season.points < high + bonusPool * factorHigh,
  )
  return found?.[0] ?? 'unrated'
}
