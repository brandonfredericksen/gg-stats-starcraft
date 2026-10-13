import { describe, expect, test } from 'vitest'
import { getDatePresetStartMs, parseDatePreset } from './date-range'

describe('getDatePresetStartMs', () => {
  const now = new Date(2026, 6, 21, 15, 30).getTime()

  test('starts today at local midnight', () => {
    expect(getDatePresetStartMs('today', now)).toBe(new Date(2026, 6, 21).getTime())
  })

  test('counts today as the last of 7 and 30 days', () => {
    expect(getDatePresetStartMs('week', now)).toBe(new Date(2026, 6, 15).getTime())
    expect(getDatePresetStartMs('month', now)).toBe(new Date(2026, 5, 22).getTime())
  })

  test('starts the year on January 1st', () => {
    expect(getDatePresetStartMs('year', now)).toBe(new Date(2026, 0, 1).getTime())
  })
})

describe('parseDatePreset', () => {
  test('reads the presets and nothing else', () => {
    expect(parseDatePreset('week')).toBe('week')
    expect(parseDatePreset('')).toBe(undefined)
    expect(parseDatePreset('2026-07-01')).toBe(undefined)
  })
})
