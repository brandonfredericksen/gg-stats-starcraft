import { describe, expect, test } from 'vitest'
import { RaceChar } from '../../common/races'
import { IndexedReplay } from '../replay-library/replay-parser'
import { getArchiveName, sanitizeFilenamePart } from './archive-naming'

function makeReplay(overrides: Partial<IndexedReplay> = {}): IndexedReplay {
  return {
    path: 'LastReplay.rep',
    fileMtime: 0,
    fileSize: 1000,
    contentHash: 'hash',
    gameTime: new Date(2026, 9, 3, 21, 5).getTime(),
    mapName: 'Polypoid',
    gameType: 0,
    durationFrames: 1000,
    parseError: false,
    players: [
      { slot: 0, team: 1, name: 'Flash', race: 'p' as RaceChar, isComputer: false },
      { slot: 1, team: 2, name: 'Jaedong', race: 'z' as RaceChar, isComputer: false },
    ],
    teamSize: 1,
    matchup: 'p-z',
    ...overrides,
  }
}

describe('getArchiveName', () => {
  test('names a 1v1 by start time, matchup, map and players', () => {
    expect(getArchiveName(makeReplay())).toEqual({
      folder: '2026-10',
      fileName: '2026-10-03 21.05 PvZ Polypoid - Flash vs Jaedong.rep',
    })
  })

  test('lists team members together and leaves out computers', () => {
    const { fileName } = getArchiveName(
      makeReplay({
        matchup: 'pt-tz',
        players: [
          { slot: 0, team: 1, name: 'A', race: 'p', isComputer: false },
          { slot: 1, team: 1, name: 'B', race: 't', isComputer: false },
          { slot: 2, team: 2, name: 'Computer', race: 't', isComputer: true },
          { slot: 3, team: 2, name: 'C', race: 'z', isComputer: false },
        ],
      }),
    )
    expect(fileName).toBe('2026-10-03 21.05 PTvTZ Polypoid - A, B vs C.rep')
  })

  test('drops characters Windows does not allow and keeps names short', () => {
    const { fileName } = getArchiveName(
      makeReplay({
        mapName: 'Fighting Spirit: "1.3"',
        players: [
          { slot: 0, team: 1, name: 'a/b\\c', race: 'p', isComputer: false },
          { slot: 1, team: 2, name: 'x'.repeat(200), race: 'z', isComputer: false },
        ],
      }),
    )
    expect(fileName).toMatch(/^2026-10-03 21\.05 PvZ Fighting Spirit 1\.3 - abc vs x+\.rep$/)
    expect(fileName.length).toBeLessThanOrEqual(124)
  })

  test('works without a matchup or players', () => {
    expect(getArchiveName(makeReplay({ matchup: null, players: [] })).fileName).toBe(
      '2026-10-03 21.05 Polypoid.rep',
    )
  })
})

describe('sanitizeFilenamePart', () => {
  test('removes trailing dots and spaces Windows would drop', () => {
    expect(sanitizeFilenamePart('name. . ')).toBe('name')
  })
})
