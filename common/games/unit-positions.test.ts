import { describe, expect, test } from 'vitest'
import { decodeUnitPositions, MapUnitKind } from './unit-positions'

/** Encodes numbers the way the game does: LEB128 varints, with signed ones zigzagged first. */
function varint(value: number): number[] {
  const out: number[] = []
  while (value >= 0x80) {
    out.push((value % 0x80) | 0x80)
    value = Math.floor(value / 0x80)
  }
  out.push(value)
  return out
}

const signed = (value: number) => varint(value < 0 ? -value * 2 - 1 : value * 2)

describe('common/games/unit-positions', () => {
  test('reads tracks with gaps, buildings and deaths', () => {
    const bytes = Uint8Array.from([
      // Version, position shift, map size
      1,
      3,
      ...varint(128),
      ...varint(96),
      // Four scans, a second apart
      ...varint(4),
      ...varint(24),
      ...varint(24),
      ...varint(24),
      ...varint(24),
      // A Marine seen in the first and last scans, hidden in between
      ...varint(1),
      0,
      ...varint(0),
      MapUnitKind.Army,
      2,
      ...varint(0),
      ...varint(2),
      ...varint(0),
      ...varint(1),
      ...signed(10),
      ...signed(10),
      ...varint(2),
      ...varint(1),
      ...signed(10),
      ...signed(-2),
      // A Command Center, still standing
      ...varint(1),
      1,
      ...varint(106),
      ...varint(100),
      ...varint(200),
      4,
      3,
      ...varint(10),
      ...varint(0),
      // Two deaths, the second 30 frames after the first
      ...varint(2),
      ...varint(500),
      0,
      ...varint(0),
      MapUnitKind.Army,
      ...varint(20),
      ...varint(8),
      ...varint(30),
      1,
      ...varint(7),
      MapUnitKind.Worker,
      ...varint(300),
      ...varint(301),
    ])

    const positions = decodeUnitPositions(bytes)

    expect(positions.mapWidth).toBe(128)
    expect(positions.mapHeight).toBe(96)
    expect(Array.from(positions.scanFrames)).toEqual([24, 48, 72, 96])
    expect(positions.tracks).toHaveLength(1)
    const [marine] = positions.tracks
    expect(marine).toMatchObject({ player: 0, unitId: 0, kind: MapUnitKind.Army, supply: 2 })
    expect(Array.from(marine.positions)).toEqual([80, 80, NaN, NaN, NaN, NaN, 160, 64])
    expect(positions.buildings).toEqual([
      {
        player: 1,
        unitId: 106,
        x: 800,
        y: 1600,
        width: 4,
        height: 3,
        startFrame: 10,
        endFrame: undefined,
      },
    ])
    expect(positions.deaths).toEqual([
      { frame: 500, player: 0, unitId: 0, kind: MapUnitKind.Army, x: 160, y: 64 },
      { frame: 530, player: 1, unitId: 7, kind: MapUnitKind.Worker, x: 2400, y: 2408 },
    ])
  })

  test('refuses positions from a newer version, or cut short', () => {
    expect(() => decodeUnitPositions(Uint8Array.from([2, 3]))).toThrow()
    expect(() => decodeUnitPositions(Uint8Array.from([1, 3, 128]))).toThrow()
  })
})
