/** Returns the local start-of-day (midnight) timestamp, in unix ms, for a given instant. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * A span of time up to now that a list can be narrowed to. It's kept as the span rather than a
 * start date, so "Last 7 days" still means the last 7 days when it's remembered or linked to later.
 */
export type DatePreset = 'today' | 'week' | 'month' | 'year'

const DATE_PRESETS: ReadonlyArray<DatePreset> = ['today', 'week', 'month', 'year']

/** The `DatePreset` a URL param names, or `undefined` for any other value (any time). */
export function parseDatePreset(value: string): DatePreset | undefined {
  return DATE_PRESETS.includes(value as DatePreset) ? (value as DatePreset) : undefined
}

/** When a `DatePreset` starts, in unix ms: local midnight of its first day. */
export function getDatePresetStartMs(preset: DatePreset, nowMs: number): number {
  const start = new Date(startOfLocalDay(nowMs))
  switch (preset) {
    case 'today':
      break
    case 'week':
      start.setDate(start.getDate() - 6)
      break
    case 'month':
      start.setDate(start.getDate() - 29)
      break
    case 'year':
      start.setMonth(0, 1)
      break
    default:
      preset satisfies never
  }
  return start.getTime()
}
