import type { DatedGameMetrics } from '../my-stats/my-stats'
import { GAME_METRICS_VERSION } from './player-metrics'

/**
 * Other players' 1v1 ladder games, shipped with the app so 1v1 players have someone of their race
 * to be compared with in every matchup, which their own replays can't give them. Built by
 * `pnpm run ladder-baseline`.
 */
export const LADDER_BASELINE_FILE = 'ladder-baseline.json.gz'

/**
 * While this file is in the folder of ladder replays, building the baseline waits: no more calls to
 * StarCraft or downloads, and no replay started after the one being analyzed.
 */
export const LADDER_PAUSE_FILE = 'ladder-pause'
/**
 * This file in the folder of ladder replays has building the baseline stop once what it's in the
 * middle of is done, so running it again picks up from there.
 */
export const LADDER_STOP_FILE = 'ladder-stop'

export const LADDER_BASELINE_VERSION = 1

export interface LadderBaseline {
  version: typeof LADDER_BASELINE_VERSION
  /**
   * The metrics' version when the baseline was built. Metrics of another version can't be mixed
   * with the user's, so a baseline built before a change to them has to be built again.
   */
  metricsVersion: number
  createdMs: number
  /**
   * Each game dated by when the ladder matched its players. Every player is named by an id made up
   * for this baseline, so no name in it matches anyone's.
   */
  games: DatedGameMetrics[]
}

/** Reads a baseline, if it's one the app can use: of this version, with metrics of this version. */
export function parseLadderBaseline(value: unknown): LadderBaseline | undefined {
  const baseline = value as Partial<LadderBaseline> | null
  return baseline?.version === LADDER_BASELINE_VERSION &&
    baseline.metricsVersion === GAME_METRICS_VERSION &&
    typeof baseline.createdMs === 'number' &&
    Array.isArray(baseline.games)
    ? (baseline as LadderBaseline)
    : undefined
}
