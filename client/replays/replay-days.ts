import { TFunction } from 'i18next'
import { ReplayLibraryEntry } from '../../common/replays-library'
import { startOfLocalDay } from '../games/date-range'

const DAY_MS = 24 * 60 * 60 * 1000

/** The replays played on one day, or the trailing group of unreadable replays. */
export interface ReplayDay {
  /** Stable key: the first replay's id, or -1 for unreadable replays. */
  key: number
  /** The start of the day, in local time. */
  dayMs: number
  entries: ReplayLibraryEntry[]
  unreadable?: boolean
}

/**
 * Groups replays, ordered by time (either way) with unreadable ones last as the replay query
 * returns them, by the day they were played.
 */
export function groupReplaysByDay(entries: ReadonlyArray<ReplayLibraryEntry>): ReplayDay[] {
  const days: ReplayDay[] = []
  let current: ReplayDay | undefined

  for (const entry of entries) {
    if (entry.parseError) {
      if (!current?.unreadable) {
        current = { key: -1, dayMs: 0, entries: [], unreadable: true }
        days.push(current)
      }
    } else {
      const dayMs = startOfLocalDay(entry.gameTime)
      if (!current || current.unreadable || current.dayMs !== dayMs) {
        current = { key: entry.id, dayMs, entries: [] }
        days.push(current)
      }
    }
    current.entries.push(entry)
  }

  return days
}

function daysBetween(fromMs: number, toMs: number) {
  return Math.round((startOfLocalDay(toMs) - startOfLocalDay(fromMs)) / DAY_MS)
}

/** A short date, with the year only when it isn't the current one. */
function formatDate(ms: number, nowMs: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: new Date(ms).getFullYear() === new Date(nowMs).getFullYear() ? undefined : 'numeric',
  }).format(ms)
}

/** What a day is called: "Today", "Yesterday", the weekday within the last week, then the date. */
export function getDayTitle(day: ReplayDay, nowMs: number, locale: string, t: TFunction): string {
  if (day.unreadable) {
    return t('replays.sessions.unreadable', 'Unreadable replays')
  }
  const daysAgo = daysBetween(day.dayMs, nowMs)
  if (daysAgo === 0) {
    return t('replays.sessions.today', 'Today')
  }
  if (daysAgo === 1) {
    return t('replays.sessions.yesterday', 'Yesterday')
  }
  if (daysAgo < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(day.dayMs)
  }
  return formatDate(day.dayMs, nowMs, locale)
}

/** How many games a day has, like "5 games". */
export function getDaySummary(day: ReplayDay, t: TFunction): string {
  return t('replays.sessions.games', {
    defaultValue_one: '{{count}} game',
    defaultValue_other: '{{count}} games',
    count: day.entries.length,
  })
}

/**
 * When a game was played, by day: "Tonight", "This afternoon" or "This morning" today,
 * "Yesterday", the weekday within the last week, and the date before that.
 */
export function getPlayedDayLabel(
  startMs: number,
  nowMs: number,
  locale: string,
  t: TFunction,
): string {
  const daysAgo = daysBetween(startMs, nowMs)
  if (daysAgo === 0) {
    const hour = new Date(startMs).getHours()
    if (hour >= 18) {
      return t('replays.sessions.tonight', 'Tonight')
    }
    return hour >= 12
      ? t('replays.sessions.thisAfternoon', 'This afternoon')
      : t('replays.sessions.thisMorning', 'This morning')
  }
  if (daysAgo === 1) {
    return t('replays.sessions.yesterday', 'Yesterday')
  }
  if (daysAgo < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(startMs)
  }
  return formatDate(startMs, nowMs, locale)
}
