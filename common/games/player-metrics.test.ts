import { describe, expect, test } from 'vitest'
import { BuildStep, GamePlayerStats, GameStats } from './game-stats'
import { getMapFamily } from './map-family'
import { CHECKPOINT_MINUTES, computeGameMetrics, getGameShape } from './player-metrics'

const SAMPLE_MS = 10_000

function samples(durationMs: number) {
  const times = []
  for (let ms = 0; ms <= durationMs; ms += SAMPLE_MS) {
    times.push(ms)
  }
  return times
}

function step(minutes: number, id: number, overrides: Partial<BuildStep> = {}): BuildStep {
  return { timeMs: minutes * 60_000, kind: 'unit', id, count: 1, cancelled: false, ...overrides }
}

function player(
  name: string,
  durationMs: number,
  overrides: Partial<GamePlayerStats> = {},
): GamePlayerStats {
  const times = samples(Math.min(durationMs, overrides.leftAtMs ?? Infinity))
  const minutes = times.map(ms => ms / 60_000)
  return {
    id: 0,
    name,
    names: [name],
    race: 'p',
    team: 0,
    result: 'win',
    apm: 200,
    eapm: 150,
    mineralsMined: 10_000,
    gasMined: 2000,
    totalScore: 0,
    armyProduced: { score: 1000, minerals: 0, gas: 0 },
    armyKilled: { score: 800, minerals: 0, gas: 0 },
    armyLost: { score: 400, minerals: 0, gas: 0 },
    deaths: [
      [64, 5],
      [65, 3],
    ],
    timeline: {
      // A worker a minute on top of the first 4.
      workers: minutes.map(m => 4 + Math.floor(m)),
      armyScore: minutes.map(m => Math.floor(m) * 100),
      // 600 a minute.
      resourcesMined: minutes.map(m => Math.round(m * 600)),
      unspent: minutes.map(m => (m < 6 ? 100 : 500)),
      // 20 supply a minute.
      supplyUsed: minutes.map(m => Math.round(m * 20)),
      supplyAvailable: minutes.map(() => 200),
      // 100 effective actions a minute.
      effectiveActions: minutes.map(m => Math.round(m * 100)),
      // Blocked for the whole of the 4th minute.
      supplyBlockedMs: times.map(ms => Math.min(Math.max(ms - 180_000, 0), 60_000)),
    },
    buildOrder: [
      step(0.5, 156),
      step(1, 160),
      step(1.5, 157),
      step(2, 164),
      step(2.2, 160, { cancelled: true }),
      step(2.5, 154),
      step(3, 65),
      step(4, 160),
      step(5, 33, { kind: 'upgrade', level: 1 }),
      step(9, 154),
    ],
    ...overrides,
  }
}

function game(players: GamePlayerStats[], durationMs = 20 * 60_000): GameStats {
  return {
    mapName: 'Polypoid',
    durationMs,
    complete: true,
    snapshotTimesMs: samples(durationMs),
    players,
  }
}

const at = (minute: number) => CHECKPOINT_MINUTES.indexOf(minute)

describe('common/games/player-metrics', () => {
  test('reads progress at each checkpoint', () => {
    const [p] = computeGameMetrics('g', game([player('Bisu', 20 * 60_000)])).players
    expect(p.workers[at(6)]).toBe(10)
    expect(p.mined[at(10)]).toBe(6000)
    expect(p.income[at(8)]).toBe(600)
    expect(p.armyScore[at(5)]).toBe(500)
    expect(p.supplyTimesMs).toEqual([300_000, 450_000, 600_000])
    // 190 supply from 9.5 minutes on, so nothing in the late game counts toward the bank.
    expect(p.bank).toEqual([100, 500, null])
  })

  test('leaves money saved while maxed out of the bank', () => {
    const durationMs = 20 * 60_000
    const times = samples(durationMs)
    const minutes = times.map(ms => ms / 60_000)
    const base = player('Maxed', durationMs)
    const maxed = player('Maxed', durationMs, {
      timeline: {
        ...base.timeline!,
        unspent: minutes.map(m => (m < 13 ? 400 : 3000)),
        supplyUsed: minutes.map(m => (m < 13 ? 120 : 200)),
      },
    })
    const [p] = computeGameMetrics('g', game([maxed])).players
    expect(p.bank[2]).toBe(400)
  })

  test('tells a player who quit from one who was defeated', () => {
    const durationMs = 20 * 60_000
    const quitter = player('Quitter', durationMs, { leftAtMs: 6 * 60_000 })
    const defeatedBase = player('Defeated', durationMs, { leftAtMs: 6 * 60_000 })
    const defeated = {
      ...defeatedBase,
      timeline: {
        ...defeatedBase.timeline!,
        // Down to their last worker when the last building fell.
        workers: defeatedBase.timeline!.workers.map((w, i, all) => (i === all.length - 1 ? 1 : w)),
      },
    }
    const [q, d, stayer] = computeGameMetrics(
      'g',
      game([quitter, defeated, player('Stayer', durationMs)]),
    ).players
    expect(q.quit).toBe(true)
    expect(d.quit).toBe(false)
    expect(stayer.quit).toBeUndefined()
  })

  test('reads bases at each checkpoint', () => {
    const base = player('Bisu', 20 * 60_000)
    const times = samples(20 * 60_000)
    const withBases = player('Bisu', 20 * 60_000, {
      timeline: { ...base.timeline!, bases: times.map(ms => (ms < 4 * 60_000 ? 1 : 2)) },
    })
    const [p] = computeGameMetrics('g', game([withBases])).players
    expect(p.bases[at(4)]).toBe(2)
    expect(p.bases[0]).toBe(2)
    expect(computeGameMetrics('g', game([base])).players[0].bases[at(6)]).toBeNull()
  })

  test("leaves checkpoints the player didn't reach empty rather than zero", () => {
    const durationMs = 7 * 60_000
    const [p] = computeGameMetrics('g', game([player('Bisu', durationMs)], durationMs)).players
    expect(p.workers[at(6)]).toBe(10)
    expect(p.workers[at(8)]).toBeNull()
    expect(p.production[at(10)]).toBeNull()
    expect(p.bank[2]).toBeNull()
  })

  test('stops at the time the player left', () => {
    const left = player('Leaver', 20 * 60_000, { leftAtMs: 5 * 60_000 })
    const [p] = computeGameMetrics('g', game([left, player('Stayer', 20 * 60_000)])).players
    expect(p.workers[at(5)]).toBe(9)
    expect(p.workers[at(6)]).toBeNull()
  })

  test('works out effective actions per minute in each phase', () => {
    const [p] = computeGameMetrics('g', game([player('Bisu', 20 * 60_000)])).players
    expect(p.eapmByPhase).toEqual([100, 100, 100])
    const [short] = computeGameMetrics(
      'g',
      game([player('Bisu', 12.5 * 60_000)], 12.5 * 60_000),
    ).players
    expect(short.eapmByPhase?.[2]).toBeNull()
  })

  test('counts supply blocks only after the first few minutes', () => {
    const [p] = computeGameMetrics('g', game([player('Bisu', 20 * 60_000)])).players
    expect(p.supplyBlockedShare).toBeCloseTo(60_000 / (17 * 60_000))
  })

  test('reads timings, production and the opening from the build order', () => {
    const [p] = computeGameMetrics('g', game([player('Bisu', 20 * 60_000)])).players
    expect(p.townHallTimesMs).toEqual([150_000, 540_000])
    expect(p.production[at(4)]).toBe(2)
    expect(p.opening).toEqual(['u160', 'u157', 'u164', 'u154'])
    expect(p.firstStartsMs).toMatchObject({ u160: 60_000, 'g33.1': 300_000 })
    expect(p.firstStartsMs.u65).toBeUndefined()
    expect(p.firstArmyMs).toBe(180_000)
    expect(p.workersLost).toBe(5)
    expect(p.overlordsLost).toBeUndefined()
  })

  test("counts a Zerg's first Hatchery as production", () => {
    const zerg = player('Jaedong', 20 * 60_000, { race: 'z', buildOrder: [step(2, 131)] })
    const [p] = computeGameMetrics('g', game([zerg])).players
    expect(p.production[at(4)]).toBe(2)
  })

  test("works out each player's share of their team and who went out first", () => {
    const ms = 20 * 60_000
    const metrics = computeGameMetrics(
      'g',
      game([
        player('A', ms, { team: 1, mineralsMined: 3000, gasMined: 0, leftAtMs: 600_000 }),
        player('B', ms, { team: 1, mineralsMined: 1000, gasMined: 0, leftAtMs: 300_000 }),
        player('C', ms, { team: 2 }),
        player('D', ms, { team: 2 }),
      ]),
    )
    expect(metrics.shape).toBe('2v2')
    const [a, b, c] = metrics.players
    expect(a.teamShare?.income).toBe(0.75)
    expect(a.outOrder).toBe(2)
    expect(b.outOrder).toBe(1)
    expect(c.outOrder).toBeUndefined()
  })
})

describe('common/games/player-metrics/getGameShape', () => {
  const p = (team: number) => player('x', 60_000, { team })
  test('finds the moments worth watching again', () => {
    const [p] = computeGameMetrics('g', game([player('Bisu', 20 * 60_000)])).players
    expect(p.moments?.supplyBlock).toEqual({ startMs: 180_000, endMs: 240_000 })
    expect(p.moments?.bankPeak).toEqual({ atMs: 360_000, amount: 500 })
    expect(p.moments?.workerLoss).toBeUndefined()

    const durationMs = 20 * 60_000
    const minutes = samples(durationMs).map(ms => ms / 60_000)
    const base = player('Harassed', durationMs)
    // 20 workers, down to 12 within half a minute at 7 minutes.
    const workers = minutes.map(m => {
      if (m < 7) {
        return 20
      }
      return m < 7.2 ? 16 : 12
    })
    const harassed = player('Harassed', durationMs, {
      timeline: { ...base.timeline!, workers },
    })
    const [h] = computeGameMetrics('g', game([harassed])).players
    expect(h.moments?.workerLoss).toEqual({ startMs: 410_000, endMs: 440_000, count: 8 })
  })

  test("measures how steadily a Terran or Protoss made workers, but not a Zerg's", () => {
    const durationMs = 20 * 60_000
    // A Probe every 25.2 seconds from one Nexus: busy half the time and a bit.
    const probes = Array.from({ length: 20 }, (_, i) => step((i * 25.2) / 60, 64))
    const [p] = computeGameMetrics(
      'g',
      game([player('Bisu', durationMs, { buildOrder: probes })]),
    ).players
    expect(p.workerProduction8).toBeCloseTo(0.525)

    const [z] = computeGameMetrics(
      'g',
      game([player('Jaedong', durationMs, { race: 'z', buildOrder: probes })]),
    ).players
    expect(z.workerProduction8).toBeUndefined()
  })

  test('tells when a player stopped making workers, apart from supply blocks and the game ending', () => {
    const durationMs = 20 * 60_000
    // A Probe every 20 seconds until 4:40.
    const probes = Array.from({ length: 15 }, (_, i) => step(i / 3, 64))
    const stopOf = (overrides: Partial<GamePlayerStats>) =>
      computeGameMetrics('g', game([player('Bisu', durationMs, overrides)])).players[0].workerStop

    // The timeline has 8 workers at 4:40.
    expect(stopOf({ buildOrder: probes })).toEqual({ workers: 8, atMs: 280_000 })
    expect(stopOf({ buildOrder: probes, leftAtMs: 330_000 })).toBeUndefined()

    // Out of supply for most of a pause from 3:00 to 4:30, then a Probe every 20 seconds.
    const blocked = [
      ...Array.from({ length: 10 }, (_, i) => step(i / 3, 64)),
      ...Array.from({ length: 30 }, (_, i) => step(4.5 + i / 3, 64)),
    ]
    expect(stopOf({ buildOrder: blocked })).toBeNull()
  })

  test('keeps the steps of a build and the army it made', () => {
    const [z] = computeGameMetrics(
      'g',
      game([
        player('Jaedong', 20 * 60_000, {
          race: 'z',
          buildOrder: [
            step(0.5, 42),
            step(1, 142),
            step(2, 42),
            step(2.5, 42),
            step(3, 143),
            step(3.5, 146),
            step(4, 37, { count: 2 }),
            step(4.5, 37, { count: 2 }),
            step(5, 38, { count: 4 }),
            step(5.5, 103, { count: 2 }),
          ],
        }),
      ]),
    ).players
    expect(z.buildSteps?.map(s => [s.key, s.timeMs / 60_000])).toEqual([
      ['u42', 0.5],
      ['u142', 1],
      ['u42', 2],
      ['u146', 3],
      ['u37', 4],
      ['u38', 5],
      ['u103', 5.5],
    ])
    expect(z.armyMix).toEqual({ 37: [2, 4, 4, 4], 38: [0, 2, 2, 2], 103: [0, 2, 2, 2] })
  })

  test('reads scouting, detection and full Hatcheries', () => {
    const durationMs = 20 * 60_000
    const minutes = samples(durationMs).map(ms => ms / 60_000)
    const base = player('Jaedong', durationMs)
    const zerg = player('Jaedong', durationMs, {
      race: 'z',
      firstScoutMs: 95_000,
      timeline: {
        ...base.timeline!,
        // Two Hatcheries the whole time, one of them always full.
        hatcheryMs: minutes.map(m => m * 2 * 60_000),
        larvaCappedMs: minutes.map(m => m * 60_000),
      },
    })
    const [z] = computeGameMetrics('g', game([zerg])).players
    expect(z.firstScoutMs).toBe(95_000)
    expect(z.larvaeFull10).toBeCloseTo(0.5)
    expect(z.detectionMs).toBeUndefined()

    const toss = player('Bisu', durationMs, {
      buildOrder: [step(1, 160), step(4, 162), step(7, 84)],
    })
    const [p] = computeGameMetrics('g', game([toss])).players
    expect(p.detectionMs).toBe(4 * 60_000)
    expect(p.larvaeFull10).toBeUndefined()
  })

  test('tells game types apart', () => {
    expect(getGameShape([p(0), p(0)])).toBe('1v1')
    expect(getGameShape([p(0), p(0), p(0)])).toBe('ffa')
    expect(getGameShape([p(1), p(1), p(1), p(2), p(2), p(2)])).toBe('3v3')
    expect(getGameShape([p(1), p(1), p(2)])).toBe('other')
  })
})

describe('common/games/map-family', () => {
  test('groups money maps however they were named', () => {
    expect(getMapFamily('Fastest Possible Map ver 1.4')).toBe('fastest')
    expect(getMapFamily('4v4 Fastest')).toBe('fastest')
    expect(getMapFamily('Big Game Hunters')).toBe('bgh')
    expect(getMapFamily('BGH 2v2v2v2')).toBe('bgh')
    expect(getMapFamily('Fastest3v3 ver2')).toBe('fastest')
    expect(getMapFamily('BGH3v3')).toBe('bgh')
    expect(getMapFamily('Polypoid 1.65')).toBe('standard')
  })
})
