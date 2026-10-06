/** Returns the local start-of-day (midnight) timestamp, in unix ms, for a given instant. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Parses a `yyyy-mm-dd` string as a local calendar date, returning `undefined` if it doesn't
 * describe a real date. Deliberately avoids `new Date('yyyy-mm-dd')`, which parses that format as
 * UTC midnight rather than local midnight.
 */
function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return undefined
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  // `Date` silently rolls over out-of-range components (e.g. month 13, or day 30 in February)
  // instead of failing, so confirm the parsed date reflects exactly the components given.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined
  }

  return date
}

/**
 * Resolves `yyyy-mm-dd` date-range bounds (as produced by `<input type='date'>` or read from URL
 * params) to inclusive unix-ms bounds in local time: `startMs` is local midnight of `startDate`,
 * `endMs` is the last millisecond of `endDate` (the instant before the following local midnight).
 * A missing, empty, or malformed bound resolves to `undefined` rather than `NaN`, so a
 * user-edited URL can't produce an invalid filter.
 */
export function resolveDateRangeMs(
  startDate?: string,
  endDate?: string,
): { startMs?: number; endMs?: number } {
  const startLocalDate = startDate ? parseLocalDate(startDate) : undefined
  const endLocalDate = endDate ? parseLocalDate(endDate) : undefined

  const startMs = startLocalDate?.getTime()
  const endMs = endLocalDate
    ? new Date(
        endLocalDate.getFullYear(),
        endLocalDate.getMonth(),
        endLocalDate.getDate() + 1,
      ).getTime() - 1
    : undefined

  return { startMs, endMs }
}
