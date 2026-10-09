import { describe, expect, test } from 'vitest'
import { LADDER_BASELINE_VERSION, parseLadderBaseline } from './ladder-baseline'
import { GAME_METRICS_VERSION } from './player-metrics'

describe('common/games/ladder-baseline', () => {
  const baseline = {
    version: LADDER_BASELINE_VERSION,
    metricsVersion: GAME_METRICS_VERSION,
    createdMs: 1,
    games: [],
  }

  test('reads a baseline of this version', () => {
    expect(parseLadderBaseline(baseline)).toEqual(baseline)
  })

  test('leaves out a baseline built with other metrics, which has to be built again', () => {
    expect(parseLadderBaseline({ ...baseline, metricsVersion: GAME_METRICS_VERSION - 1 })).toBe(
      undefined,
    )
    expect(parseLadderBaseline({ ...baseline, version: 0 })).toBeUndefined()
    expect(parseLadderBaseline(null)).toBeUndefined()
  })
})
