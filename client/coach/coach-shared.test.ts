import { describe, expect, test } from 'vitest'
import { getShownGap } from './coach-shared'

describe('getShownGap', () => {
  test('measures time supply blocked in the seconds shown', () => {
    // Shown as 38s and 55s per 10 min. The raw difference would round to 16s.
    const gap = getShownGap(0.0641, 0.0912, 'share')
    expect(Math.round(gap * 600)).toBe(17)
  })

  test('measures times in the whole seconds shown', () => {
    // 4:05 and 4:07.
    expect(getShownGap(245_400, 246_600, 'time')).toBe(2000)
  })

  test('measures percents in the whole percents shown', () => {
    // 45% and 51%.
    expect(getShownGap(0.454, 0.506, 'percent')).toBeCloseTo(0.06)
  })

  test('measures ratios to the two places shown', () => {
    // 0.85 and 0.72.
    expect(getShownGap(0.854, 0.716, 'ratio')).toBeCloseTo(0.13)
  })

  test('measures small numbers to the tenth shown and others in whole numbers', () => {
    // 9.6 and 12.
    expect(getShownGap(9.64, 12.3, 'count')).toBeCloseTo(2.4)
    // 10 and 9.5.
    expect(getShownGap(10.4, 9.54, 'perTenMinutes')).toBeCloseTo(0.5)
    // 3.3 and 2.1.
    expect(getShownGap(3.26, 2.14, 'perMinute')).toBeCloseTo(1.2)
  })
})
