import { describe, expect, test } from 'vitest'
import { getMapBaseName, getMapDisplayName, getMapFamily, getMapKey } from './map-family'

describe('common/games/map-family', () => {
  test.each([
    ['Fastest Possible Map ver 1.4', 'fastest'],
    ['| iCCup | Fastest 2v2', 'fastest'],
    ['Big Game Hunters', 'bgh'],
    ['BGH 2.1', 'bgh'],
    ['Big Hunters미네랄2겹깔끔', 'bgh'],
    ['New Super◆빠른무한', 'fastest'],
    ['Fa§te§t Po§§ible Map Ever', 'fastest'],
    ['빅 헌터 1.0', 'bgh'],
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
    ['투혼 1.3 킹옵', 'fighting spirit'],
    ['!iCCup Fighting Spirit 1.3', 'fighting spirit'],
    ['[CPL] Fighting Spirit 1.3 OBS', 'fighting spirit'],
    ['(2)Butter 2.0c', 'butter'],
    ['N e m e s i s 1.0', 'nemesis'],
    ['Dominator SE 2.0', 'dominator'],
    ['Apocalypse_1.32', 'apocalypse'],
    ['Monty Hall_SE 2.1', 'monty hall'],
    ['울돌목(鳴梁) 1.0', 'roaring currents'],
    ['Odyssey:RE 1.90', 'odyssey re'],
    ['Deja Vu SE 1.95b', 'deja vu'],
    ['Neo Dark Origin 2.1', 'neo dark origin'],
    ['Dark Origin 1.0', 'dark origin'],
    ['New Heartbreak Ridge 2.0', 'new heartbreak ridge'],
    ['신 단장의 능선 2.1', 'new heartbreak ridge'],
    ['76', '76'],
    ['Blitz X 1.0', 'blitz x'],
    ['좀비 아포칼립스', '좀비 아포칼립스'],
  ])('keys %s as %s', (name, key) => {
    expect(getMapKey(name)).toBe(key)
  })

  test('shows a known map by its English name', () => {
    expect(getMapDisplayName('투혼 1.3')).toBe('Fighting Spirit')
    expect(getMapDisplayName('Circuit Breaker 1.0')).toBe('Circuit Breakers')
    expect(getMapDisplayName('Some Unknown Map 1.2')).toBe('Some Unknown Map')
  })

  test('keeps the case of the name it shows', () => {
    expect(getMapBaseName('| iCCup | Fighting Spirit 1.3')).toBe('Fighting Spirit')
  })
})
