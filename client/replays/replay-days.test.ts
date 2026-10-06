import { describe, expect, test } from 'vitest'
import { ReplayLibraryEntry } from '../../common/replays-library'
import { groupReplaysByDay } from './replay-days'

function entry(id: number, gameTime: number, parseError = false): ReplayLibraryEntry {
  return {
    id,
    path: `C:\\replays\\${id}.rep`,
    fileName: `${id}.rep`,
    fileSize: 1,
    gameTime,
    mapName: 'Polypoid',
    gameType: 2,
    durationFrames: 14_000,
    parseError,
    players: [],
  }
}

/** Local time on a day in October 2026. */
function at(day: number, hour: number) {
  return new Date(2026, 9, day, hour).getTime()
}

describe('client/replays/replay-days', () => {
  test('groups replays by the day they were played, newest first', () => {
    const days = groupReplaysByDay([
      entry(4, at(3, 22)),
      entry(3, at(3, 9)),
      entry(2, at(2, 23)),
      entry(1, at(1, 8)),
    ])
    expect(days.map(d => d.entries.map(e => e.id))).toEqual([[4, 3], [2], [1]])
    expect(days.map(d => d.key)).toEqual([4, 2, 1])
  })

  test('groups replays listed oldest first the same way', () => {
    const days = groupReplaysByDay([entry(1, at(1, 8)), entry(2, at(1, 20)), entry(3, at(2, 1))])
    expect(days.map(d => d.entries.map(e => e.id))).toEqual([[1, 2], [3]])
  })

  test('collects unreadable replays at the end', () => {
    const days = groupReplaysByDay([entry(2, at(3, 12)), entry(5, 0, true), entry(6, 0, true)])
    expect(days).toHaveLength(2)
    expect(days[1]).toMatchObject({ key: -1, unreadable: true })
    expect(days[1].entries.map(e => e.id)).toEqual([5, 6])
  })
})
