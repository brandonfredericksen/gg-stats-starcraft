/** The app's top level sections, which each keep their own back and forward. */
export type Section = 'library' | 'myStats' | 'lastGame' | 'settings' | 'other'

export function getSection(pathname: string): Section {
  if (pathname === '/replays' || pathname.startsWith('/replays/')) {
    return 'library'
  }
  if (pathname.startsWith('/my-stats')) {
    return 'myStats'
  }
  if (pathname.startsWith('/last-game')) {
    return 'lastGame'
  }
  if (pathname.startsWith('/settings')) {
    return 'settings'
  }
  return 'other'
}

/** How many pages each section remembers. */
const MAX_ENTRIES = 50

/** A single game's page, which can be opened from any section, not just the library. */
function isGamePage(pathname: string) {
  return pathname.startsWith('/replays/stats/')
}

function pathnameOf(url: string) {
  const end = url.search(/[?#]/)
  return end === -1 ? url : url.slice(0, end)
}

interface Stack {
  /** Each page's URL, with its search string. */
  entries: string[]
  index: number
}

/**
 * Back and forward kept per section, so going back in one section never leads into another.
 * Moving between sections doesn't count as a step in either. A change to only a page's search
 * string, like a filter, updates the page in place rather than adding a step. A game's page joins
 * the section it was opened from, so going back from a game opened in My stats returns there.
 */
export class SectionHistory {
  private stacks = new Map<Section, Stack>()
  private current: Section = 'other'
  private pendingMove: { section: Section; index: number } | undefined

  /** The section the app is showing now. */
  get section(): Section {
    return this.current
  }

  /** Notes that the app is now showing `url`. */
  visit(url: string) {
    const section = this.sectionOf(url)
    const stack = this.stacks.get(section) ?? { entries: [], index: -1 }
    const move = this.pendingMove
    this.pendingMove = undefined

    if (move?.section === section && stack.entries[move.index] !== undefined) {
      stack.index = move.index
      stack.entries[stack.index] = url
    } else if (stack.index >= 0 && pathnameOf(stack.entries[stack.index]) === pathnameOf(url)) {
      stack.entries[stack.index] = url
    } else {
      stack.entries = [...stack.entries.slice(0, stack.index + 1), url].slice(-MAX_ENTRIES)
      stack.index = stack.entries.length - 1
    }
    this.stacks.set(section, stack)
    this.current = section
  }

  private sectionOf(url: string): Section {
    const move = this.pendingMove
    if (move && this.stacks.get(move.section)?.entries[move.index] === url) {
      return move.section
    }
    const section = getSection(pathnameOf(url))
    if (section !== 'library' || !isGamePage(pathnameOf(url)) || this.current === 'library') {
      return section
    }
    // Coming back to the game the library was last showing, like from its tab, is the library's.
    const library = this.stacks.get('library')
    if (library && library.entries[library.index] === url) {
      return 'library'
    }
    return this.current === 'other' || this.current === 'settings' ? section : this.current
  }

  canGoBack() {
    return (this.stacks.get(this.current)?.index ?? 0) > 0
  }

  canGoForward() {
    const stack = this.stacks.get(this.current)
    return !!stack && stack.index < stack.entries.length - 1
  }

  /** The URL to show to go back, which the next {@link visit} of it lands on. */
  back(): string | undefined {
    return this.moveBy(-1)
  }

  /** The URL to show to go forward, which the next {@link visit} of it lands on. */
  forward(): string | undefined {
    return this.moveBy(1)
  }

  private moveBy(delta: number) {
    const stack = this.stacks.get(this.current)
    const index = (stack?.index ?? 0) + delta
    const url = stack?.entries[index]
    if (url !== undefined) {
      this.pendingMove = { section: this.current, index }
    }
    return url
  }
}
