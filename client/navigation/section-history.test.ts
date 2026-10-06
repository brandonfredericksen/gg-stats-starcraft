import { describe, expect, test } from 'vitest'
import { SectionHistory } from './section-history'

describe('client/navigation/section-history', () => {
  test('goes back and forward within a section', () => {
    const history = new SectionHistory()
    history.visit('/replays')
    history.visit('/replays/stats/a')
    expect(history.canGoBack()).toBe(true)
    expect(history.canGoForward()).toBe(false)

    const back = history.back()
    expect(back).toBe('/replays')
    history.visit(back!)
    expect(history.canGoBack()).toBe(false)
    expect(history.canGoForward()).toBe(true)

    const forward = history.forward()
    expect(forward).toBe('/replays/stats/a')
    history.visit(forward!)
    expect(history.canGoForward()).toBe(false)
  })

  test('keeps each section to itself, and remembers where each one was', () => {
    const history = new SectionHistory()
    history.visit('/replays')
    history.visit('/replays/stats/a')
    history.visit('/my-stats')
    // My stats has just one page, so there's nowhere to go back to within it.
    expect(history.canGoBack()).toBe(false)

    history.visit('/replays/stats/a')
    expect(history.canGoBack()).toBe(true)
    expect(history.back()).toBe('/replays')
  })

  test('keeps a game opened from My stats in My stats, so going back returns there', () => {
    const history = new SectionHistory()
    history.visit('/replays')
    history.visit('/my-stats')
    history.visit('/replays/stats/b')
    expect(history.section).toBe('myStats')
    const back = history.back()
    expect(back).toBe('/my-stats')
    history.visit(back!)
    expect(history.canGoForward()).toBe(true)

    const forward = history.forward()
    expect(forward).toBe('/replays/stats/b')
    history.visit(forward!)
    expect(history.section).toBe('myStats')
  })

  test('drops the pages ahead when going somewhere new after going back', () => {
    const history = new SectionHistory()
    history.visit('/replays')
    history.visit('/replays/stats/a')
    history.visit(history.back()!)
    history.visit('/replays/stats/b')
    expect(history.canGoForward()).toBe(false)
    expect(history.back()).toBe('/replays')
  })

  test('updates a page in place when only its search changes, like a filter', () => {
    const history = new SectionHistory()
    history.visit('/replays')
    history.visit('/replays?teams=1v1')
    history.visit('/replays?teams=1v1&q=flash')
    expect(history.canGoBack()).toBe(false)

    history.visit('/replays/stats/a')
    expect(history.back()).toBe('/replays?teams=1v1&q=flash')
  })
})
