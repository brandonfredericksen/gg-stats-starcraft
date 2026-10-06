import { describe, expect, test } from 'vitest'
import { computeMatchupString, expandMatchupFilter } from './matchups'

describe('computeMatchupString', () => {
  test('canonicalizes 1v1 matchups', () => {
    expect(computeMatchupString([['z'], ['p']])).toBe('p-z')
    expect(computeMatchupString([['p'], ['z']])).toBe('p-z')
    expect(computeMatchupString([['t'], ['t']])).toBe('t-t')
  })

  test('handles random race in selected matchup', () => {
    expect(computeMatchupString([['r'], ['z']])).toBe('r-z')
    expect(computeMatchupString([['z'], ['r']])).toBe('r-z')
  })

  test('canonicalizes 2v2 matchups', () => {
    expect(
      computeMatchupString([
        ['p', 't'],
        ['t', 'z'],
      ]),
    ).toBe('pt-tz')
    expect(
      computeMatchupString([
        ['t', 'z'],
        ['p', 't'],
      ]),
    ).toBe('pt-tz')
    // Sorts races within team
    expect(
      computeMatchupString([
        ['t', 'p'],
        ['z', 't'],
      ]),
    ).toBe('pt-tz')
  })

  test('canonicalizes 3v3 matchups', () => {
    expect(
      computeMatchupString([
        ['z', 'p', 't'],
        ['t', 'z', 'p'],
      ]),
    ).toBe('ptz-ptz')
  })

  test('returns null for invalid inputs', () => {
    expect(computeMatchupString([])).toBe(null)
    expect(computeMatchupString([['p']])).toBe(null)
    expect(computeMatchupString([[], ['p']])).toBe(null)
    expect(computeMatchupString([['p'], []])).toBe(null)
  })
})

describe('expandMatchupFilter', () => {
  test('returns exact match for fully specified matchup', () => {
    const result = expandMatchupFilter({
      team1: ['p'],
      team2: ['z'],
    })
    expect(result).toEqual(['p-z'])
  })

  test('expands single wildcard', () => {
    const result = expandMatchupFilter({
      team1: ['p'],
      team2: [undefined],
    })
    expect(result.sort()).toEqual(['p-p', 'p-t', 'p-z'])
  })

  test('expands all wildcards for 1v1', () => {
    const result = expandMatchupFilter({
      team1: [undefined],
      team2: [undefined],
    })
    // Should have 6 unique canonical matchups: pp, pt, pz, tt, tz, zz
    expect(result.sort()).toEqual(['p-p', 'p-t', 'p-z', 't-t', 't-z', 'z-z'])
  })

  test('handles symmetry correctly', () => {
    // p vs z and z vs p should produce the same canonical string
    const result1 = expandMatchupFilter({ team1: ['p'], team2: ['z'] })
    const result2 = expandMatchupFilter({ team1: ['z'], team2: ['p'] })
    expect(result1).toEqual(result2)
  })

  test('expands 2v2 matchup with wildcards', () => {
    const result = expandMatchupFilter({
      team1: ['p', undefined],
      team2: ['z', 't'],
    })
    // Team1 could be pp, pt, pz; Team2 is tz
    // Canonicalized: pp-tz, pt-tz, pz-tz
    expect(result.sort()).toEqual(['pp-tz', 'pt-tz', 'pz-tz'])
  })

  test('deduplicates symmetric 2v2 matchups', () => {
    const result = expandMatchupFilter({
      team1: ['p', 't'],
      team2: ['p', 't'],
    })
    expect(result).toEqual(['pt-pt'])
  })
})
