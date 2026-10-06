import { describe, expect, test } from 'vitest'
import { getMapBaseName, getMapFamily, getMapKey } from './map-family'

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

  test.each([
    ['Polypoid 1.65', 'polypoid'],
    ['Polypoid 1.75', 'polypoid'],
    ['| iCCup | Fighting Spirit 1.3', 'fighting spirit'],
    ['Fighting Spirit ver 1.3', 'fighting spirit'],
    ['Big Game Hunters (Remastered)', 'big game hunters'],
    ['Big Game Hunters - Remastere', 'big game hunters'],
    ['(XB2) Big Game Hunters', 'big game hunters'],
    ['Big Game Hunters_ST', 'big game hunters st'],
    ['\u0003Eclipse \u00041.2', 'eclipse'],
    ['VGT30 Fastest Space Perfect', 'vgt30 fastest space perfect'],
    ['(2)', '(2)'],
  ])('keys %s as %s', (name, key) => {
    expect(getMapKey(name)).toBe(key)
  })

  test('keeps the case of the name it shows', () => {
    expect(getMapBaseName('| iCCup | Fighting Spirit 1.3')).toBe('Fighting Spirit')
  })
})
