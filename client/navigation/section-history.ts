/** The app's top level sections, each with its own tab. */
export type Section = 'library' | 'myStats' | 'coach' | 'lastGame' | 'settings' | 'other'

export function getSection(pathname: string): Section {
  if (pathname === '/replays' || pathname.startsWith('/replays/')) {
    return 'library'
  }
  if (pathname.startsWith('/my-stats')) {
    return 'myStats'
  }
  if (pathname.startsWith('/coach')) {
    return 'coach'
  }
  if (pathname.startsWith('/last-game')) {
    return 'lastGame'
  }
  if (pathname.startsWith('/settings')) {
    return 'settings'
  }
  return 'other'
}

/** How the app got to a history entry, as the Navigation API reports it. */
export type VisitType = 'push' | 'replace' | 'reload' | 'traverse'

/** A single game's page, which can be opened from any section, not just the library. */
function isGamePage(pathname: string) {
  return pathname.startsWith('/replays/stats/')
}

function pathnameOf(url: string) {
  const end = url.search(/[?#]/)
  return end === -1 ? url : url.slice(0, end)
}

/**
 * Which section's tab each history entry lights. A page's address says, except for a game's page,
 * which belongs to the section it was opened from, so opening a game from My stats keeps My stats
 * lit. That's remembered for each history entry, so going back or forward to a game lights the
 * same tab it did before. Back and forward themselves are the window's, across every section, like
 * a browser's.
 */
export class EntrySections {
  private sections = new Map<string, Section>()
  private current: Section = 'other'
  private pending: Section | undefined

  /** The section the app is showing now. */
  get section(): Section {
    return this.current
  }

  /**
   * Makes the next page the app goes to belong to `section`, like a game opened from the Last
   * game tab. Only the very next page, so one that never comes doesn't claim a later one.
   */
  openNextIn(section: Section) {
    this.pending = section
  }

  /** Notes that the app is now showing `url`, in the history entry `key`. */
  visit(key: string, url: string, type: VisitType) {
    const pending = this.pending
    this.pending = undefined
    const pathname = pathnameOf(url)

    let section = getSection(pathname)
    if (isGamePage(pathname)) {
      const known = this.sections.get(key)
      if (type === 'traverse' || type === 'reload') {
        section = known ?? 'library'
      } else if (type === 'replace' && known) {
        section = known
      } else if (pending) {
        section = pending
      } else if (this.current !== 'other' && this.current !== 'settings') {
        section = this.current
      }
    }
    this.sections.set(key, section)
    this.current = section
  }
}
