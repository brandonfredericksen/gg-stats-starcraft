import { describe, expect, test } from 'vitest'
import { getMapFamily } from './map-family'

describe('common/games/map-family', () => {
  test.each([
    ['Fastest Possible Map ver 1.4', 'fastest'],
    ['| iCCup | Fastest 2v2', 'fastest'],
    ['Big Game Hunters', 'bgh'],
    ['BGH 2.1', 'bgh'],
    ['Big Hunters미네랄2겹깔끔', 'bgh'],
    ['Polypoid 1.65', 'standard'],
    ['Hunters', 'standard'],
  ])('groups %s as %s', (name, family) => {
    expect(getMapFamily(name)).toBe(family)
  })
})
