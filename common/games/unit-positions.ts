/**
 * Where each player's units were over a game, as the game DLL records them for the minimap: a
 * position for every unit each scan, where each building stood, where units died, and where the
 * mineral fields and geysers were when it started. See
 * `UnitPositions::encode` in `game/src/game_stats/positions.rs` for the format.
 */

/** What a unit is to the minimap. */
export enum MapUnitKind {
  Army = 0,
  Worker = 1,
  /** Overlords and Observers, which go places without fighting. */
  Support = 2,
  /**
   * Buildings. Ones on the ground are in {@link UnitPositions.buildings}, and Terran buildings
   * that lift off are tracks while they fly.
   */
  Building = 3,
}

export interface UnitTrack {
  /** The player id the unit belongs to. */
  player: number
  unitId: number
  kind: MapUnitKind
  /** In halves, since Zerglings and Scourge take half a supply each. */
  supply: number
  /** The scan the unit was first seen in. */
  firstScan: number
  /**
   * Positions in pixels, x then y, for each scan from `firstScan` on. Scans the unit wasn't seen
   * in, like while it was inside a transport, are `NaN`.
   */
  positions: Float32Array
}

export interface MapBuilding {
  player: number
  unitId: number
  /** The center, in pixels. */
  x: number
  y: number
  /** The ground it covers, in tiles. */
  width: number
  height: number
  startFrame: number
  /** Missing for buildings still standing when the game ended. */
  endFrame?: number
}

export interface MapDeath {
  frame: number
  player: number
  unitId: number
  kind: MapUnitKind
  x: number
  y: number
}

/** A mineral field or geyser, as the game started. */
export interface MapResource {
  geyser: boolean
  /** The center, in pixels. */
  x: number
  y: number
  /** The ground it covers, in tiles. */
  width: number
  height: number
}

export interface UnitPositions {
  /** The map's size, in tiles. */
  mapWidth: number
  mapHeight: number
  /** The frame each scan was taken on. */
  scanFrames: Uint32Array
  tracks: UnitTrack[]
  buildings: MapBuilding[]
  deaths: MapDeath[]
  resources: MapResource[]
}

const ENCODING_VERSION = 1

class Reader {
  private at = 0

  constructor(private bytes: Uint8Array) {}

  byte(): number {
    if (this.at >= this.bytes.length) {
      throw new Error('Unit positions ended early')
    }
    return this.bytes[this.at++]
  }

  varint(): number {
    let value = 0
    let shift = 0
    for (;;) {
      const b = this.byte()
      // Multiplying rather than shifting, which would go negative past 31 bits.
      value += (b & 0x7f) * 2 ** shift
      if (b < 0x80) {
        return value
      }
      shift += 7
    }
  }

  signed(): number {
    const v = this.varint()
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2
  }

  get done() {
    return this.at === this.bytes.length
  }
}

/** Reads unit positions the game DLL encoded. Throws if they're from a newer version or broken. */
export function decodeUnitPositions(bytes: Uint8Array): UnitPositions {
  const r = new Reader(bytes)
  const version = r.byte()
  if (version !== ENCODING_VERSION) {
    throw new Error(`Unknown unit positions version ${version}`)
  }
  const scale = 2 ** r.byte()
  const mapWidth = r.varint()
  const mapHeight = r.varint()

  const scanFrames = new Uint32Array(r.varint())
  let frame = 0
  for (let i = 0; i < scanFrames.length; i++) {
    frame += r.varint()
    scanFrames[i] = frame
  }

  const tracks: UnitTrack[] = []
  for (let count = r.varint(); count > 0; count--) {
    const player = r.byte()
    const unitId = r.varint()
    const kind = r.byte()
    const supply = r.byte()
    const firstScan = r.varint()
    const runs: Array<{ start: number; values: number[] }> = []
    let end = 0
    let x = 0
    let y = 0
    for (let runCount = r.varint(); runCount > 0; runCount--) {
      const start = end + r.varint()
      const length = r.varint()
      const values = new Array<number>(length * 2)
      for (let i = 0; i < length; i++) {
        x += r.signed()
        y += r.signed()
        values[i * 2] = x * scale
        values[i * 2 + 1] = y * scale
      }
      runs.push({ start, values })
      end = start + length
    }
    const positions = new Float32Array(end * 2).fill(NaN)
    for (const run of runs) {
      positions.set(run.values, run.start * 2)
    }
    tracks.push({ player, unitId, kind, supply, firstScan, positions })
  }

  const buildings: MapBuilding[] = []
  for (let count = r.varint(); count > 0; count--) {
    const player = r.byte()
    const unitId = r.varint()
    const x = r.varint() * scale
    const y = r.varint() * scale
    const width = r.byte()
    const height = r.byte()
    const startFrame = r.varint()
    const endFrame = r.varint()
    buildings.push({
      player,
      unitId,
      x,
      y,
      width,
      height,
      startFrame,
      endFrame: endFrame ? endFrame - 1 : undefined,
    })
  }

  const deaths: MapDeath[] = []
  frame = 0
  for (let count = r.varint(); count > 0; count--) {
    frame += r.varint()
    const player = r.byte()
    const unitId = r.varint()
    const kind = r.byte()
    const x = r.varint() * scale
    const y = r.varint() * scale
    deaths.push({ frame, player, unitId, kind, x, y })
  }

  const resources: MapResource[] = []
  for (let count = r.varint(); count > 0; count--) {
    const geyser = r.byte() === 1
    const x = r.varint() * scale
    const y = r.varint() * scale
    const width = r.byte()
    const height = r.byte()
    resources.push({ geyser, x, y, width, height })
  }

  if (!r.done) {
    throw new Error('Unit positions have more after their end')
  }
  return { mapWidth, mapHeight, scanFrames, tracks, buildings, deaths, resources }
}
