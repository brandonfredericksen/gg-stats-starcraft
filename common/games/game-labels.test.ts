import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { formatMatchup, formatTeamSizes, getRaceLetter, getShapeLabel } from './game-labels'

/** Fills in values the way the real translations do, with some keys translated. */
function makeT(translations: Record<string, string> = {}) {
  return ((key: string, defaultValue: string, values?: Record<string, unknown>) =>
    (translations[key] ?? defaultValue).replace(/{{(\w+)}}/g, (_, name: string) =>
      String(values?.[name] ?? ''),
    )) as unknown as TFunction
}

const KO = makeT({
  'game.matchup.oneOnOne': '{{race}}{{opponent}}전',
  'game.matchup.race.t': '테',
  'game.matchup.race.z': '저',
  'game.matchup.race.p': '프',
  'game.shape.sizeSeparator': ':',
})

describe('common/games/game-labels', () => {
  test('writes race letters, with ? for an unknown race', () => {
    expect(getRaceLetter('t', makeT())).toBe('T')
    expect(getRaceLetter(undefined, makeT())).toBe('?')
  })

  test('writes a 1v1 matchup with its template', () => {
    expect(formatMatchup([['t'], ['z']], makeT())).toBe('TvZ')
    expect(formatMatchup([['t'], ['z']], KO)).toBe('테저전')
  })

  test('writes team matchups with race letters', () => {
    expect(
      formatMatchup(
        [
          ['p', 'p', 'z'],
          ['t', 'z', 'p'],
        ],
        makeT(),
      ),
    ).toBe('PPZ vs TZP')
    expect(
      formatMatchup(
        [
          ['p', 'z'],
          ['t', 't'],
        ],
        makeT(),
        { compact: true },
      ),
    ).toBe('PZvTT')
    expect(
      formatMatchup(
        [
          ['p', 'z'],
          ['t', 't'],
        ],
        KO,
      ),
    ).toBe('PZ vs TT')
  })

  test('writes game types with the team size separator', () => {
    expect(getShapeLabel('3v3', makeT())).toBe('3v3')
    expect(getShapeLabel('3v3', KO)).toBe('3:3')
    expect(formatTeamSizes([2, 1], KO)).toBe('2:1')
    expect(getShapeLabel('ffa', KO)).toBe('FFA')
  })
})
