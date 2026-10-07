import { AssignedRaceChar } from '../races'

/**
 * How a typical player of one race plays one kind of game, as medians. Curves follow
 * `CHECKPOINT_MINUTES`, phases follow `PHASE_MINUTES`, and times are in minutes.
 */
export interface DemoProfile {
  workers: ReadonlyArray<number>
  income: ReadonlyArray<number>
  armyScore: ReadonlyArray<number>
  production: ReadonlyArray<number>
  bank: readonly [number, number, number]
  apm: number
  eapm: number
  supplyBlockedShare: number
  hotkeysPerMin: readonly [number, number, number]
  productionPerMin: readonly [number, number, number]
  groupsUsed: number
  firstArmyMinute: number
  /** When the second and third town halls go down, and how often they do at all. */
  townHalls: ReadonlyArray<{ minute: number; share: number }>
  /** When 100, 150 and 200 supply are reached, by players who reach them. */
  supplyMinutes: readonly [number, number, number]
  /** Builds players open with: build keys and the minute each is started. */
  builds: ReadonlyArray<ReadonlyArray<readonly [key: string, minute: number]>>
  /** How long these games last, in minutes. */
  durationMinutes: number
}

export type DemoProfileKind = '1v1' | 'team' | 'bgh' | 'fastest'

/**
 * How much players spread around each median, as the standard deviation of its logarithm, split
 * between how well they play and how one game goes.
 */
export const DEMO_SPREAD = {
  workers: 0.14,
  income: 0.14,
  armyScore: 0.45,
  production: 0.2,
  bank: 0.4,
  eapm: 0.14,
  supplyBlockedShare: 0.7,
  hotkeys: 0.6,
  productionPerMin: 0.25,
  timing: 0.1,
}

/**
 * Big Game Hunters 3v3 and 4v4, from about 150 analyzed public lobby games: the medians of every
 * human player in them.
 */
const BGH: Record<AssignedRaceChar, DemoProfile> = {
  p: {
    workers: [18, 20, 22, 25, 28, 33, 38, 48],
    income: [936, 1064, 1208, 1368, 1560, 1752, 1968, 2208],
    armyScore: [500, 600, 800, 1000, 1200, 2300, 3050, 5250],
    production: [2, 3, 3, 3, 4, 5, 7, 8],
    bank: [165, 588, 1198],
    apm: 172,
    eapm: 134,
    supplyBlockedShare: 0.06,
    hotkeysPerMin: [54, 19.5, 11],
    productionPerMin: [20.5, 14.2, 18],
    groupsUsed: 4,
    firstArmyMinute: 2.07,
    townHalls: [
      { minute: 9, share: 0.27 },
      { minute: 14.4, share: 0.08 },
    ],
    supplyMinutes: [12, 14.7, 23.7],
    builds: [
      [
        ['u156', 0.9],
        ['u160', 1.4],
        ['u160', 1.9],
        ['u160', 2.6],
        ['u166', 3.9],
        ['u157', 4.3],
        ['u162', 4.6],
        ['u164', 5],
        ['g33.1', 6.2],
        ['u163', 7.2],
        ['u155', 8.1],
        ['u165', 8.7],
      ],
      [
        ['u156', 0.9],
        ['u160', 1.4],
        ['u160', 1.9],
        ['u166', 3.2],
        ['u162', 3.8],
        ['u157', 4.4],
        ['u164', 5],
        ['g13.1', 7.1],
        ['u163', 7.4],
        ['u165', 9],
      ],
      [
        ['u156', 0.9],
        ['u160', 1.4],
        ['u160', 1.9],
        ['u157', 2.6],
        ['u164', 3.4],
        ['u160', 4.2],
        ['g34.1', 8.4],
        ['u155', 7.4],
        ['u159', 9.6],
      ],
    ],
    durationMinutes: 9,
  },
  t: {
    workers: [18, 20, 22, 24, 27, 29, 32, 38],
    income: [888, 1048, 1176, 1256, 1376, 1504, 1576, 1832],
    armyScore: [125, 350, 600, 850, 1100, 1650, 1800, 2250],
    production: [3, 3, 4, 4, 4, 5, 6, 7],
    bank: [207, 712, 1249],
    apm: 189,
    eapm: 136,
    supplyBlockedShare: 0.08,
    hotkeysPerMin: [58, 24, 14],
    productionPerMin: [20.3, 15.5, 15.8],
    groupsUsed: 5,
    firstArmyMinute: 2.42,
    townHalls: [
      { minute: 10.2, share: 0.21 },
      { minute: 15.3, share: 0.07 },
    ],
    supplyMinutes: [12.3, 17.7, 25.7],
    builds: [
      [
        ['u109', 1],
        ['u111', 1.5],
        ['u110', 1.8],
        ['u113', 2.9],
        ['u113', 3.4],
        ['u120', 4],
        ['t3', 4.4],
        ['u122', 5.9],
        ['u123', 7.5],
        ['u114', 8.4],
      ],
      [
        ['u109', 1],
        ['u111', 1.5],
        ['u111', 2],
        ['u110', 2.3],
        ['u112', 3.9],
        ['t0', 4.4],
        ['u122', 5.9],
        ['u107', 6.2],
        ['u124', 7.1],
      ],
      [
        ['u109', 1],
        ['u111', 1.5],
        ['u111', 2],
        ['u125', 2.9],
        ['u110', 3.1],
        ['u113', 3.6],
        ['u120', 4.4],
        ['u122', 6],
      ],
    ],
    durationMinutes: 9,
  },
  z: {
    workers: [8, 9, 9, 11, 13, 18, 19, 27],
    income: [544, 528, 552, 640, 784, 1088, 1168, 1688],
    armyScore: [225, 225, 325, 350, 400, 750, 1250, 2500],
    production: [2, 2, 2, 2, 2, 3, 3, 4],
    bank: [185, 389, 923],
    apm: 171,
    eapm: 129,
    supplyBlockedShare: 0.06,
    hotkeysPerMin: [45, 28, 13],
    productionPerMin: [8.9, 9.8, 10.5],
    groupsUsed: 4,
    firstArmyMinute: 2.11,
    townHalls: [
      { minute: 3.2, share: 0.88 },
      { minute: 5.5, share: 0.44 },
    ],
    supplyMinutes: [15.5, 18.5, 21.3],
    builds: [
      [
        ['u142', 1.2],
        ['u149', 1.5],
        ['g27.1', 2.5],
        ['u143', 3],
        ['u146', 3.5],
        ['u131', 3.2],
        ['u132', 6.2],
        ['u141', 6.7],
      ],
      [
        ['u142', 1.2],
        ['u149', 1.5],
        ['u131', 3.2],
        ['u143', 3.4],
        ['u132', 6.2],
        ['u139', 7.3],
      ],
      [
        ['u142', 1.2],
        ['u149', 1.5],
        ['u131', 2.8],
        ['u131', 3.6],
        ['u132', 5.8],
        ['u141', 6.7],
      ],
    ],
    durationMinutes: 9,
  },
}

/** Scales a profile's economy, army and actions, and moves its timings by the same tempo. */
function scaled(
  profile: DemoProfile,
  {
    economy,
    army,
    tempo,
    durationMinutes,
    actions = 1,
  }: Record<'economy' | 'army' | 'tempo' | 'durationMinutes', number> & { actions?: number },
): DemoProfile {
  return {
    ...profile,
    workers: profile.workers.map(w => Math.round(w * economy)),
    income: profile.income.map(i => Math.round(i * economy)),
    armyScore: profile.armyScore.map(a => Math.round(a * army)),
    apm: Math.round(profile.apm * actions),
    eapm: Math.round(profile.eapm * actions),
    supplyMinutes: [
      profile.supplyMinutes[0] / tempo,
      profile.supplyMinutes[1] / tempo,
      profile.supplyMinutes[2] / tempo,
    ],
    durationMinutes,
  }
}

/**
 * Fastest has no saved games to go by yet, so it's Big Game Hunters with more bases close by: a
 * bigger economy that maxes out sooner.
 */
const FASTEST: Record<AssignedRaceChar, DemoProfile> = {
  p: scaled(BGH.p, { economy: 1.3, army: 1.4, tempo: 1.25, durationMinutes: 14 }),
  t: scaled(BGH.t, { economy: 1.3, army: 1.4, tempo: 1.25, durationMinutes: 14 }),
  z: scaled(BGH.z, { economy: 1.5, army: 1.5, tempo: 1.25, durationMinutes: 14 }),
}

/**
 * B rank 1v1 ladder players (about 1,900 MMR, a quarter of the ladder), who mostly face B rank
 * players. APM, EAPM, build timings, game length and hotkey use are medians of 528 sampled ladder
 * games. Workers, income, supply milestones, bank and army are estimates, since replays hold
 * commands rather than game state. Income is minerals and gas a minute, about 45 a worker.
 */
const ONE_V_ONE: Record<AssignedRaceChar, DemoProfile> = {
  p: {
    workers: [19, 24, 28, 32, 36, 43, 50, 56],
    income: [865, 1090, 1275, 1455, 1640, 1955, 2275, 2550],
    armyScore: [350, 450, 600, 800, 1000, 1800, 2700, 4300],
    production: [2, 2, 3, 3, 4, 6, 8, 10],
    bank: [250, 600, 1000],
    apm: 250,
    eapm: 190,
    supplyBlockedShare: 0.06,
    hotkeysPerMin: [100, 90, 80],
    productionPerMin: [22, 16, 18],
    groupsUsed: 7,
    firstArmyMinute: 1.95,
    townHalls: [
      { minute: 3.8, share: 0.9 },
      { minute: 9.5, share: 0.45 },
    ],
    supplyMinutes: [9.5, 12.5, 16],
    builds: [
      // Gateway into Core, then Nexus and Robotics Facility, as against Terran.
      [
        ['u160', 1.25],
        ['u157', 1.6],
        ['u164', 2.03],
        ['u154', 3.75],
        ['u155', 4.6],
        ['u160', 5],
        ['u159', 6.5],
        ['u163', 7.2],
        ['u165', 9],
      ],
      // Forge first expansion, as against Zerg.
      [
        ['u166', 1.5],
        ['u154', 2.4],
        ['u162', 2.8],
        ['u160', 3.5],
        ['u164', 3.85],
        ['u157', 4],
        ['u167', 6],
        ['u163', 7],
      ],
      // One gate Reaver, as in the mirror.
      [
        ['u160', 1.25],
        ['u157', 1.6],
        ['u164', 2.02],
        ['u155', 4.6],
        ['u160', 5],
        ['u154', 5.5],
        ['u159', 7],
      ],
    ],
    durationMinutes: 12,
  },
  t: {
    workers: [19, 24, 28, 32, 36, 43, 50, 56],
    income: [885, 1115, 1300, 1485, 1670, 2000, 2325, 2600],
    armyScore: [300, 420, 600, 800, 1050, 1900, 2800, 4400],
    production: [2, 3, 3, 4, 5, 6, 8, 10],
    bank: [250, 700, 1200],
    apm: 295,
    eapm: 200,
    supplyBlockedShare: 0.07,
    hotkeysPerMin: [105, 95, 85],
    productionPerMin: [22, 16, 16],
    groupsUsed: 7,
    firstArmyMinute: 2.3,
    townHalls: [
      { minute: 3.5, share: 0.9 },
      { minute: 8.5, share: 0.5 },
    ],
    supplyMinutes: [9.75, 13, 16.5],
    builds: [
      // Barracks, Factory, then Command Center, as against Protoss.
      [
        ['u111', 1.43],
        ['u110', 1.9],
        ['u113', 2.55],
        ['u106', 3.75],
        ['u120', 3.4],
        ['u113', 4.4],
        ['u114', 6.3],
        ['u122', 6],
      ],
      // Factory first expansion with an Academy, as against Zerg.
      [
        ['u111', 1.43],
        ['u106', 2.9],
        ['u113', 3.7],
        ['u112', 4.25],
        ['u110', 4.4],
        ['u120', 4.6],
        ['u114', 6.5],
        ['u122', 7],
      ],
      [
        ['u111', 1.43],
        ['u110', 1.9],
        ['u113', 2.55],
        ['u120', 3.2],
        ['u113', 4.1],
        ['u106', 3.5],
        ['u114', 6],
      ],
    ],
    durationMinutes: 12.5,
  },
  z: {
    workers: [21, 26, 32, 36, 40, 46, 52, 58],
    income: [955, 1185, 1460, 1645, 1830, 2100, 2375, 2650],
    armyScore: [300, 400, 550, 750, 1000, 1700, 2600, 4100],
    production: [2, 2, 3, 3, 4, 5, 6, 7],
    bank: [200, 550, 900],
    apm: 270,
    eapm: 180,
    supplyBlockedShare: 0.07,
    hotkeysPerMin: [95, 85, 75],
    productionPerMin: [9, 10, 10.5],
    groupsUsed: 7,
    firstArmyMinute: 2.6,
    townHalls: [
      { minute: 1.9, share: 0.97 },
      { minute: 3.5, share: 0.85 },
    ],
    supplyMinutes: [9, 12, 15.5],
    builds: [
      // Twelve Hatchery, as against Terran.
      [
        ['u131', 1.67],
        ['u142', 1.95],
        ['u149', 2.5],
        ['u132', 3.12],
        ['u131', 4.4],
        ['u141', 4.4],
        ['u139', 5.5],
      ],
      // Overpool, as against Protoss.
      [
        ['u142', 1.23],
        ['u131', 2.03],
        ['u149', 2.4],
        ['u131', 3],
        ['u132', 4.3],
        ['u135', 6],
        ['u139', 6.4],
      ],
      [
        ['u142', 1.4],
        ['u131', 2.2],
        ['u149', 2.5],
        ['u132', 2.92],
        ['u141', 4],
      ],
    ],
    durationMinutes: 11,
  },
}

/** Team games on standard maps: slower hands and a slightly smaller economy than 1v1. */
const TEAM: Record<AssignedRaceChar, DemoProfile> = {
  p: scaled(ONE_V_ONE.p, { economy: 0.95, army: 1, tempo: 1, durationMinutes: 16, actions: 0.8 }),
  t: scaled(ONE_V_ONE.t, { economy: 0.95, army: 1, tempo: 1, durationMinutes: 16, actions: 0.8 }),
  z: scaled(ONE_V_ONE.z, { economy: 0.95, army: 1, tempo: 1, durationMinutes: 16, actions: 0.8 }),
}

export const DEMO_PROFILES: Record<DemoProfileKind, Record<AssignedRaceChar, DemoProfile>> = {
  '1v1': ONE_V_ONE,
  team: TEAM,
  bgh: BGH,
  fastest: FASTEST,
}
