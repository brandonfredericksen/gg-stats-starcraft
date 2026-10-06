import { describe, expect, test } from 'vitest'
import { getLaunchReplayPaths } from './launch-args'

describe('getLaunchReplayPaths', () => {
  test('keeps replay paths and skips flags', () => {
    expect(getLaunchReplayPaths(['--hidden', 'game.rep', 'C:\\replays\\Other.REP'])).toEqual([
      'game.rep',
      'C:\\replays\\Other.REP',
    ])
  })

  test('never treats a URI as a replay path, even with a .rep tail', () => {
    expect(
      getLaunchReplayPaths([
        'ggstats://app/replays/slug.rep',
        'https://example.org/download/thing.rep',
        'ggstats://..\\..\\traversal.rep',
      ]),
    ).toEqual([])
  })

  test('drops files that are not replays', () => {
    expect(getLaunchReplayPaths(['notes.txt', 'C:\\maps\\map.scx'])).toEqual([])
  })
})
