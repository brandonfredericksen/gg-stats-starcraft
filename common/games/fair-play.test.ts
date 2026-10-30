import { describe, expect, test } from 'vitest'
import { countHiddenClickTimes, getFairPlayFlags, HIDDEN_CLICK_GAP_MS } from './fair-play'
import { HiddenTarget } from './game-stats'

function clicksAt(...timesMs: number[]) {
  const targets = timesMs.map((timeMs): HiddenTarget => ({
    timeMs,
    kind: 'order',
    hiddenBy: 'fog',
    unitId: 0,
    x: 0,
    y: 0,
  }))
  return { count: targets.length, targets }
}

describe('countHiddenClickTimes', () => {
  test('counts clicks close together as one time', () => {
    expect(countHiddenClickTimes(clicksAt(60_000, 60_000, 61_000, 65_000))).toBe(1)
  })

  test('counts clicks further apart than the gap as separate times', () => {
    expect(
      countHiddenClickTimes(clicksAt(75_000, 60_000, 60_000 + HIDDEN_CLICK_GAP_MS + 1, 200_000)),
    ).toBe(3)
  })

  test('is 0 without any clicks', () => {
    expect(countHiddenClickTimes(undefined)).toBe(0)
    expect(countHiddenClickTimes(clicksAt())).toBe(0)
  })
})

describe('getFairPlayFlags', () => {
  test('flags a map hack from separate times, not clicks', () => {
    const oneMoment = clicksAt(...Array.from({ length: 20 }, (_, i) => 60_000 + i * 100))
    expect(getFairPlayFlags({ hiddenTargets: oneMoment }, undefined).mapHack).toBe(false)
    expect(
      getFairPlayFlags({ hiddenTargets: clicksAt(60_000, 120_000, 180_000) }, undefined).mapHack,
    ).toBe(true)
  })
})
