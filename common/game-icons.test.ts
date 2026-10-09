import { describe, expect, test } from 'vitest'
import { GameIconsManifest, getGameIconIndex } from './game-icons'

const manifest: GameIconsManifest = {
  version: 3,
  hd: true,
  cellSize: 64,
  columns: 16,
  count: 390,
  units: [0, 1, 2],
  upgrades: [292, 293],
  techs: [400, 330],
}

describe('common/game-icons', () => {
  test('finds the icon of a unit, upgrade or tech by its build key', () => {
    expect(getGameIconIndex(manifest, 'u2')).toBe(2)
    expect(getGameIconIndex(manifest, 'g1.2')).toBe(293)
    expect(getGameIconIndex(manifest, 't1')).toBe(330)
  })

  test('finds nothing for an icon past the sheet or a key it has no list for', () => {
    expect(getGameIconIndex(manifest, 't0')).toBeUndefined()
    expect(getGameIconIndex(manifest, 'u99')).toBeUndefined()
    expect(getGameIconIndex(manifest, 'x1')).toBeUndefined()
  })
})
