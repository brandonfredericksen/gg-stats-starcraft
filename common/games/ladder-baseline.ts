import type { DatedGameMetrics } from '../my-stats/my-stats'
import { GAME_METRICS_VERSION } from './player-metrics'

/**
 * Other players' ladder games, shipped with the app so players have someone of their race to be
 * compared with in every kind of game, which their own replays can't give them: 1v1 games from
 * StarCraft's ladder, with each player's MMR and rank, and 2v2 and 3v3 games from ShieldBattery's,
 * with each player's rating as their MMR. Nothing goes by the team ratings yet, since most players
 * never play on ShieldBattery. Built by `pnpm run ladder-baseline`.
 */
export const LADDER_BASELINE_FILE = 'ladder-baseline.json.gz'

/**
 * The baseline's games with every player's real name, so the players in it can be looked up by
 * name. Building the baseline writes it into the app data of the computer it's built on, and never
 * anywhere it would ship. An app that finds it in its app data uses it instead of the shipped one.
 */
export const NAMED_LADDER_BASELINE_FILE = 'ladder-baseline-named.json.gz'

/**
 * How each named player in the baseline's games played, read from the replays, so the other names a
 * player plays under can be found among the ladder's players too. It goes wherever
 * {@link NAMED_LADDER_BASELINE_FILE} goes, and like it never anywhere it would ship.
 */
export const NAMED_LADDER_FINGERPRINTS_FILE = 'ladder-fingerprints-named.json.gz'

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
   * Each game dated by when it started, from its replay. Every player is named by an id made up for
   * this baseline, so no name in it matches anyone's.
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
