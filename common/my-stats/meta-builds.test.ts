import { beforeEach, describe, expect, test } from 'vitest'
import { LadderRank } from '../games/ladder'
import { MapFamily } from '../games/map-family'
import {
  CHECKPOINT_MINUTES,
  GAME_METRICS_VERSION,
  GameShape,
  PlayerMetrics,
} from '../games/player-metrics'
import { computeMetaBuilds } from './meta-builds'
import { DatedGameMetrics } from './my-stats'

const empty = CHECKPOINT_MINUTES.map(() => null)
const DAY_MS = 24 * 60 * 60_000

/** Gateway, Core, then a Nexus. */
const GATE_EXPAND: Array<[string, number]> = [
  ['u160', 1.2],
  ['u164', 2],
  ['u154', 3],
]
/** Forge, Nexus, Cannon, Gateway. */
const FORGE_EXPAND: Array<[string, number]> = [
  ['u166', 1.2],
  ['u154', 1.9],
  ['u162', 2.2],
  ['u160', 2.6],
]

let nextGame = 0
let nextPlayer = 0

beforeEach(() => {
  nextGame = 0
  nextPlayer = 0
})

interface PlayerOptions {
  name?: string
  race?: 'p' | 't' | 'z'
  steps?: Array<[string, number]>
  result?: 'win' | 'loss'
  rank?: LadderRank
  mmr?: number
  eapm?: number
  team?: number
  /** When each Probe past the first four started, in minutes. */
  probes?: number[]
}

function player({
  name = `player${nextPlayer++}`,
  race = 'p',
  steps = GATE_EXPAND,
  result = 'win',
  rank,
  mmr,
  eapm = 200,
  team = 0,
  probes,
}: PlayerOptions): PlayerMetrics {
  return {
    names: [name],
    race,
    team,
    result,
    human: true,
    eapm,
    eapmByPhase: [eapm, eapm, eapm],
    rank,
    mmr,
    workers: CHECKPOINT_MINUTES.map(() => 30),
    mined: empty,
    income: empty,
    armyScore: empty,
    bases: empty,
    production: empty,
    supplyTimesMs: [null, null, null],
    bank: [null, null, null],
    supplyBlockedShare: null,
    townHallTimesMs: [null, null],
    firstStartsMs: {},
    opening: [],
    firstArmyMs: null,
    buildSteps: steps.map(([key, minutes]) => ({ key, timeMs: minutes * 60_000, supply: 10 })),
    unitTimes: probes ? { 64: probes.map(minutes => minutes * 60_000) } : undefined,
  }
}

function game(
  players: PlayerMetrics[],
  {
    shape = '1v1',
    daysAgo = 0,
    durationMs = 15 * 60_000,
    mapFamily = 'standard',
  }: { shape?: GameShape; daysAgo?: number; durationMs?: number; mapFamily?: MapFamily } = {},
): DatedGameMetrics {
  return {
    version: GAME_METRICS_VERSION,
    gameId: String(nextGame++),
    durationMs,
    complete: true,
    mapName: 'Polypoid',
    mapFamily,
    shape,
    players,
    gameTimeMs: 1_000 * DAY_MS - daysAgo * DAY_MS,
  }
}

/** A 1v1 PvT where the Protoss player is as given, against a Terran. */
function pvt(
  options: PlayerOptions,
  {
    opponentMmr = options.mmr,
    opponentSteps = [],
    ...gameOptions
  }: { opponentMmr?: number; opponentSteps?: Array<[string, number]>; durationMs?: number } = {},
) {
  return game(
    [
      player(options),
      player({
        race: 't',
        team: 1,
        steps: opponentSteps,
        result: options.result === 'loss' ? 'win' : 'loss',
        mmr: opponentMmr,
      }),
    ],
    gameOptions,
  )
}

function times<T>(count: number, make: (i: number) => T): T[] {
  return Array.from({ length: count }, (_, i) => make(i))
}

const PVT = { shape: '1v1', race: 'p', opponentRace: 't' } as const

describe('common/my-stats/meta-builds', () => {
  test('ranks the builds top players use by share, S counting twice and lower ranks not at all', () => {
    const games = [
      ...times(10, () => pvt({ rank: 'a', steps: FORGE_EXPAND })),
      ...times(10, () => pvt({ rank: 's', steps: GATE_EXPAND })),
      ...times(30, () => pvt({ rank: 'b', steps: FORGE_EXPAND })),
    ]
    const meta = computeMetaBuilds(games, PVT)
    expect(meta.topBy).toBe('rank')
    expect(meta.games).toBe(20)
    expect(meta.builds.map(b => [b.family, b.games, b.share])).toEqual([
      ['p gates1 expand', 10, 2 / 3],
      ['p forgeExpand', 10, 1 / 3],
    ])
    expect(meta.otherShare).toBe(0)
  })

  test("counts unranked players as fast as the S and A ones, the user's own games among them", () => {
    const games = [
      ...times(20, () => pvt({ rank: 'a', eapm: 200 })),
      ...times(10, () => pvt({ name: 'me', eapm: 250, steps: FORGE_EXPAND })),
      ...times(10, () => pvt({ eapm: 120, steps: FORGE_EXPAND })),
    ]
    const meta = computeMetaBuilds(games, PVT)
    expect(meta.eapmCutoff).toBe(200)
    expect(meta.games).toBe(30)
    expect(meta.libraryGames).toBe(30)
    // One player's games alone aren't a build to list.
    expect(meta.builds.map(b => b.family)).toEqual(['p gates1 expand'])
    expect(meta.otherShare).toBeCloseTo(1 / 3)
  })

  test('counts at most the latest 10 games of a player', () => {
    const games = times(15, i =>
      game(
        [
          player({ name: 'one', rank: 's', result: i < 10 ? 'win' : 'loss' }),
          player({ race: 't', team: 1, steps: [] }),
        ],
        { daysAgo: i },
      ),
    )
    const meta = computeMetaBuilds(games, PVT)
    expect(meta.games).toBe(10)
    expect(meta.seen).toEqual([{ family: 'p gates1', games: 10, players: 1 }])
  })

  test('leaves out games from over 6 months before the latest', () => {
    const games = [
      ...times(10, () => pvt({ rank: 'a' })),
      ...times(10, () =>
        game([player({ rank: 'a', steps: FORGE_EXPAND }), player({ race: 't', team: 1 })], {
          daysAgo: 200,
        }),
      ),
    ]
    expect(computeMetaBuilds(games, PVT).builds.map(b => b.family)).toEqual(['p gates1 expand'])
  })

  test("judges results against the players' MMRs and everyone else's builds, pulled to even", () => {
    const games = [
      // Wins every game, but only against much weaker opponents.
      ...times(20, () => pvt({ rank: 'a', mmr: 2400, steps: FORGE_EXPAND }, { opponentMmr: 1600 })),
      // Wins 8 of 8 against even opponents.
      ...times(8, () => pvt({ rank: 'a', mmr: 2000 })),
    ]
    const meta = computeMetaBuilds(games, PVT)
    const forge = meta.builds.find(b => b.family === 'p forgeExpand')!
    const gate = meta.builds.find(b => b.family === 'p gates1 expand')!
    const expected = 1 / (1 + 10 ** (-800 / 400))
    const average = (20 * (1 - expected) + 8 * 0.5) / 28
    expect(forge.winScore).toBeCloseTo(0.5 + (20 * (1 - expected) - 20 * average) / 40)
    expect(forge.winScore).toBeLessThan(0.5)
    expect(gate.winScore).toBeCloseTo(0.5 + (8 * 0.5 - 8 * average) / 28)
    expect(gate.winGames).toBe(8)
  })

  test('counts a variant too rare to list as the build it varies', () => {
    const reaver: Array<[string, number]> = [...GATE_EXPAND, ['u155', 4], ['u171', 4.6]]
    const robo: Array<[string, number]> = [...GATE_EXPAND, ['u155', 4]]
    const games = [
      ...times(12, () => pvt({ rank: 'a', steps: reaver })),
      ...times(5, () => pvt({ rank: 'a', steps: robo })),
      ...times(2, () => pvt({ rank: 'a', steps: [...GATE_EXPAND, ['u163', 4]] })),
    ]
    const meta = computeMetaBuilds(games, PVT)
    expect(meta.builds.map(b => [b.family, b.games])).toEqual([['p gates1 expand u155 reaver', 12]])
    expect(meta.seen).toEqual([])
    expect(meta.otherShare).toBeCloseTo(7 / 19)
    const many = computeMetaBuilds(
      [...games, ...times(4, () => pvt({ rank: 'a', steps: robo }))],
      PVT,
    )
    expect(many.builds.map(b => [b.family, b.games])).toEqual([
      ['p gates1 expand u155 reaver', 12],
      ['p gates1 expand u155', 9],
    ])
  })

  test('calls the top build standard with a big enough share from enough players', () => {
    expect(
      computeMetaBuilds(
        times(10, () => pvt({ rank: 'a' })),
        PVT,
      ).builds[0].standard,
    ).toBe(false)
    const fewPlayers = times(20, i => pvt({ name: `p${i % 4}`, rank: 'a' }))
    expect(computeMetaBuilds(fewPlayers, PVT).builds[0].standard).toBe(false)
    const many = computeMetaBuilds(
      [
        ...times(20, () => pvt({ rank: 'a' })),
        ...times(10, () => pvt({ rank: 'a', steps: FORGE_EXPAND })),
      ],
      PVT,
    )
    expect(many.builds.map(b => b.standard)).toEqual([true, false])
  })

  test('takes the build order from the game closest to how most games play it', () => {
    const later: Array<[string, number]> = [['u155', 8]]
    const games = [
      ...times(12, () =>
        pvt({ rank: 'a', steps: [...GATE_EXPAND, ...later], probes: [0.2, 0.5, 0.8, 1.1, 2.5] }),
      ),
      ...times(4, () =>
        pvt({
          rank: 'a',
          steps: [['u160', 1.2], ['u164', 2.5], ['u154', 4], ...later],
        }),
      ),
    ]
    const [build] = computeMetaBuilds(games, PVT).builds
    expect(build.order.map(s => [s.key, s.timeMs / 60_000, s.workers])).toEqual([
      ['u160', 1.2, 8],
      ['u164', 2, 8],
      ['u154', 3, 9],
    ])
    expect(build.order[2]).toMatchObject({ earlyMs: 3 * 60_000, lateMs: 3.25 * 60_000 })
    expect(build.later.map(s => [s.key, s.timeMs / 60_000])).toEqual([['u155', 8]])
    expect(build.workersAt).toEqual([30, 30, 30, 30])
  })

  test('leaves games over too soon to name a build out of the shares', () => {
    const games = [
      ...times(10, () => pvt({ rank: 'a' })),
      ...times(10, () => pvt({ rank: 'a', steps: [['u160', 1.2]] }, { durationMs: 4 * 60_000 })),
    ]
    const meta = computeMetaBuilds(games, PVT)
    expect(meta.games).toBe(20)
    expect(meta.builds.map(b => [b.family, b.share])).toEqual([['p gates1 expand', 1]])
    expect(meta.otherShare).toBe(0)
    expect(meta.shortShare).toBe(0.5)
  })

  test("offers the opponent's openings with enough games, and shows one", () => {
    const raxCC: Array<[string, number]> = [
      ['u111', 1.3],
      ['u106', 2],
    ]
    const games = [
      ...times(25, () => pvt({ rank: 'a' }, { opponentSteps: raxCC })),
      ...times(10, () => pvt({ rank: 'a', steps: FORGE_EXPAND }, { opponentSteps: [['u111', 1]] })),
    ]
    expect(computeMetaBuilds(games, PVT).openings).toEqual([{ value: 't raxCC', games: 25 }])
    const meta = computeMetaBuilds(games, { ...PVT, opponentOpening: 't raxCC' })
    expect(meta.games).toBe(25)
    expect(meta.builds.map(b => b.family)).toEqual(['p gates1 expand'])
  })

  test('outside 1v1, counts the fastest quarter of players by their usual early game EAPM', () => {
    // 3 fast players and 9 slower ones, each in 12 games.
    const games = times(12, i =>
      game(
        [
          player({ name: `fast${i % 3}`, eapm: 300 }),
          player({ name: `slow${i % 9}`, eapm: 100 + (i % 9), team: 1 }),
        ],
        { shape: '3v3', mapFamily: 'bgh' },
      ),
    )
    const meta = computeMetaBuilds(games, { shape: '3v3', race: 'p', mapFamily: 'bgh' })
    expect(meta.topBy).toBe('eapm')
    expect(meta.games).toBe(12)
    expect(meta.players).toBe(3)
  })

  test('in 2v2, shows the most played kind of map and offers the pairs of opponents', () => {
    const twoVsTwo = (mapFamily: MapFamily, opponents: 'z' | 't', i: number) =>
      game(
        [
          player({ name: `a${i}`, eapm: 300 }),
          player({ name: `b${i}`, race: 'z', eapm: 100 }),
          player({ name: `c${i}`, race: opponents, team: 1, eapm: 100 }),
          player({ name: `d${i}`, race: opponents, team: 1, eapm: 100 }),
        ],
        { shape: '2v2', mapFamily },
      )
    const games = [
      ...times(30, i => twoVsTwo('standard', 'z', i)),
      ...times(10, i => twoVsTwo('bgh', 't', 100 + i)),
    ]
    const meta = computeMetaBuilds(games, { shape: '2v2', race: 'p', allyRace: 'z' })
    expect(meta.mapFamily).toBe('standard')
    expect(meta.mapFamilies).toEqual([{ value: 'standard', games: 30 }])
    expect(meta.opponentPairs).toEqual([{ value: 'zz', games: 30 }])
    expect(meta.anyAlly).toBe(false)
    expect(meta.games).toBe(30)
  })
})
