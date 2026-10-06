import {
  BuildStepPayload,
  FASTEST_MS_PER_FRAME,
  GamePlayerStatsPayload,
  GameStatsPayload,
  TimelinePayload,
} from '../../../common/games/game-stats'

const DURATION_FRAMES = Math.round((14 * 60 + 32) * (1000 / FASTEST_MS_PER_FRAME))
const SNAPSHOT_INTERVAL = 238
const SNAPSHOT_FRAMES = Array.from(
  { length: Math.floor(DURATION_FRAMES / SNAPSHOT_INTERVAL) + 1 },
  (_, i) => i * SNAPSHOT_INTERVAL,
)

/** Stretches a few evenly spaced points into one value per snapshot. */
function curve(points: number[]): number[] {
  return SNAPSHOT_FRAMES.map((_, i) => {
    const pos = (i / (SNAPSHOT_FRAMES.length - 1)) * (points.length - 1)
    const low = Math.floor(pos)
    const high = Math.min(low + 1, points.length - 1)
    return Math.round(points[low] + (points[high] - points[low]) * (pos - low))
  })
}

function timeline(points: {
  workers: number[]
  army: number[]
  mined: number[]
  unspent: number[]
  supply: number[]
  apm: number[]
  lost: number[]
  bases: number[]
}): TimelinePayload {
  const supplyUsed = curve(points.supply)
  const actions = curve(points.apm).reduce<number[]>((sums, apm, i) => {
    sums.push(
      (sums[i - 1] ?? 0) + Math.round((apm * SNAPSHOT_INTERVAL * FASTEST_MS_PER_FRAME) / 60000),
    )
    return sums
  }, [])
  return {
    workers: curve(points.workers),
    armyScore: curve(points.army),
    resourcesMined: curve(points.mined),
    unspent: curve(points.unspent),
    supplyUsed,
    supplyAvailable: supplyUsed.map(s => Math.min(200, Math.ceil((s + 6) / 8) * 8)),
    actions,
    resourcesLost: curve(points.lost),
    bases: curve(points.bases),
    supplyBlockedFrames: curve([0, 0, 120, 300, 420, 600, 600, 600, 600, 600, 600]),
  }
}

function step(
  time: string,
  kind: BuildStepPayload['kind'],
  id: number,
  supply: number | null,
  extra: Partial<BuildStepPayload> = {},
): BuildStepPayload {
  const [min, sec] = time.split(':').map(Number)
  return {
    frame: Math.round(((min * 60 + sec) * 1000) / FASTEST_MS_PER_FRAME),
    kind,
    id,
    supply,
    count: 1,
    cancelled: false,
    ...extra,
  }
}

const PROTOSS: GamePlayerStatsPayload = {
  id: 0,
  names: ['Kestrel'],
  race: 2,
  team: 0,
  victoryState: 3,
  leftAtFrame: null,
  actions: 3082,
  effectiveActions: 2443,
  mineralsMined: 18450,
  gasMined: 6925,
  unitScore: 14200,
  killScore: 13400,
  buildingScore: 4850,
  razingScore: 3415,
  produced: [
    [64, 52],
    [65, 16],
    [66, 24],
    [83, 4],
    [84, 3],
    [156, 14],
    [160, 5],
  ],
  kills: [
    [41, 14],
    [37, 44],
    [38, 26],
    [103, 5],
    [42, 3],
  ],
  deaths: [
    [64, 6],
    [65, 9],
    [66, 11],
    [83, 2],
    [84, 1],
  ],
  armyProduced: { score: 15800, minerals: 7350, gas: 3200 },
  armyKilled: { score: 9850, minerals: 5400, gas: 1525 },
  armyLost: { score: 5400, minerals: 3150, gas: 1250 },
  resourcesDestroyed: 9850,
  resourcesLost: 5400,
  supplyBlockedFrames: 1000,
  timeline: timeline({
    workers: [4, 9, 14, 19, 24, 30, 35, 40, 44, 46, 50, 54, 56, 58, 58],
    army: [0, 0, 150, 400, 900, 1600, 2300, 3100, 3600, 2800, 3900, 5200, 6100, 7000, 7600],
    mined: [
      0, 500, 1300, 2400, 3800, 5500, 7500, 9700, 12100, 14500, 17100, 19900, 22800, 25000, 25375,
    ],
    unspent: [50, 120, 260, 180, 340, 420, 300, 520, 610, 380, 450, 520, 400, 380, 360],
    supply: [4, 9, 16, 24, 34, 46, 60, 76, 92, 96, 112, 132, 152, 172, 182],
    apm: [120, 180, 196, 204, 210, 220, 216, 224, 236, 228, 214, 210, 206, 212, 208],
    lost: [0, 0, 0, 100, 250, 600, 900, 1500, 2100, 3300, 3700, 4200, 4800, 5200, 5400],
    bases: [1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4],
  }),
  buildOrder: [
    step('0:21', 'unit', 156, 8),
    step('0:58', 'unit', 160, 10),
    step('1:10', 'unit', 157, 11),
    step('1:42', 'unit', 164, 13),
    step('2:05', 'unit', 156, 15),
    step('2:28', 'unit', 66, 16),
    step('2:40', 'upgrade', 38, null, { level: 1 }),
    step('3:02', 'unit', 154, 20),
    step('3:30', 'unit', 160, 22),
    step('4:05', 'unit', 155, 26),
  ],
}

const ZERG: GamePlayerStatsPayload = {
  id: 1,
  names: ['Mordant'],
  race: 0,
  team: 1,
  victoryState: 2,
  leftAtFrame: null,
  actions: 4158,
  effectiveActions: 2822,
  mineralsMined: 17980,
  gasMined: 5210,
  unitScore: 15600,
  killScore: 9400,
  buildingScore: 5200,
  razingScore: 1490,
  produced: [
    [41, 61],
    [37, 58],
    [38, 34],
    [42, 19],
    [103, 6],
  ],
  kills: [
    [64, 6],
    [65, 9],
    [66, 11],
    [83, 2],
    [84, 1],
  ],
  deaths: [
    [41, 14],
    [37, 44],
    [38, 26],
    [42, 3],
    [103, 5],
  ],
  armyProduced: { score: 16200, minerals: 8100, gas: 2700 },
  armyKilled: { score: 5400, minerals: 3150, gas: 1250 },
  armyLost: { score: 9850, minerals: 5400, gas: 1525 },
  resourcesDestroyed: 5400,
  resourcesLost: 9850,
  supplyBlockedFrames: 1857,
  timeline: timeline({
    workers: [4, 10, 16, 22, 28, 34, 41, 47, 50, 48, 51, 49, 44, 38, 31],
    army: [0, 0, 300, 800, 1400, 2100, 2900, 3700, 3100, 3500, 4200, 4600, 3800, 2600, 1500],
    mined: [
      0, 520, 1400, 2650, 4300, 6300, 8600, 11100, 13700, 16000, 18300, 20500, 22200, 23000, 23190,
    ],
    unspent: [50, 180, 420, 300, 560, 700, 620, 880, 940, 610, 700, 760, 650, 690, 655],
    supply: [4, 10, 18, 28, 40, 54, 70, 88, 90, 98, 110, 118, 100, 82, 64],
    apm: [160, 240, 268, 282, 290, 300, 296, 304, 318, 298, 286, 276, 270, 262, 250],
    lost: [0, 0, 50, 200, 500, 900, 1600, 2400, 3900, 4600, 5600, 6800, 8200, 9300, 9850],
    bases: [1, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 3, 3, 2, 2],
  }),
  buildOrder: [
    step('0:40', 'unit', 42, 9),
    step('0:58', 'unit', 131, 12),
    step('1:20', 'unit', 142, 11),
    step('1:28', 'unit', 149, 10),
    step('2:05', 'unit', 37, 13, { count: 2 }),
    step('2:18', 'unit', 131, 14, { cancelled: true }),
    step('2:30', 'unit', 132, 15),
    step('2:44', 'unit', 42, 16),
    step('3:10', 'unit', 131, 19),
    step('3:40', 'unit', 135, 24),
  ],
}

/** A made up PvZ, for looking at the stats pages without analyzing a replay. */
export const SAMPLE_GAME_STATS: GameStatsPayload = {
  mapName: 'Polypoid',
  frames: DURATION_FRAMES,
  snapshotFrames: SNAPSHOT_FRAMES,
  complete: true,
  players: [PROTOSS, ZERG],
}
