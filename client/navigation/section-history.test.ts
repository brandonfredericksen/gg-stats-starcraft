import { describe, expect, test } from 'vitest'
import { EntrySections } from './section-history'

describe('client/navigation/section-history', () => {
  test('lights the section a page is in', () => {
    const sections = new EntrySections()
    sections.visit('a', '/replays', 'reload')
    expect(sections.section).toBe('library')
    sections.visit('b', '/my-stats', 'push')
    expect(sections.section).toBe('myStats')
    sections.visit('c', '/last-game', 'push')
    expect(sections.section).toBe('lastGame')
  })

  test('keeps a game in the section it was opened from, going back and forward too', () => {
    const sections = new EntrySections()
    sections.visit('a', '/my-stats', 'reload')
    sections.visit('b', '/replays/stats/g1', 'push')
    expect(sections.section).toBe('myStats')

    sections.visit('c', '/coach', 'push')
    sections.visit('b', '/replays/stats/g1', 'traverse')
    expect(sections.section).toBe('myStats')
    sections.visit('a', '/my-stats', 'traverse')
    expect(sections.section).toBe('myStats')
  })

  test('puts a game in the section asked for, like the last game', () => {
    const sections = new EntrySections()
    sections.visit('a', '/coach', 'reload')
    sections.openNextIn('lastGame')
    sections.visit('b', '/replays/stats/g1', 'push')
    expect(sections.section).toBe('lastGame')

    // A new analysis replacing the page stays where the page was.
    sections.visit('b', '/replays/stats/g2', 'replace')
    expect(sections.section).toBe('lastGame')
  })

  test("only asks for the very next page, so one that never comes doesn't claim a later one", () => {
    const sections = new EntrySections()
    sections.visit('a', '/coach', 'reload')
    sections.openNextIn('lastGame')
    sections.visit('b', '/my-stats', 'push')
    sections.visit('c', '/replays/stats/g1', 'push')
    expect(sections.section).toBe('myStats')
  })

  test('puts a game opened from settings in the library', () => {
    const sections = new EntrySections()
    sections.visit('a', '/settings', 'reload')
    sections.visit('b', '/replays/stats/g1', 'push')
    expect(sections.section).toBe('library')
  })
})
