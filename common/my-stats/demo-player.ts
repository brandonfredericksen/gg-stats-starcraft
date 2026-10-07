import { getMapFamily, MapFamily } from '../games/map-family'
import {
  CHECKPOINT_MINUTES,
  GAME_METRICS_VERSION,
  GameShape,
  PHASE_MINUTES,
  PlayerMetrics,
} from '../games/player-metrics'
import { AssignedRaceChar } from '../races'
import { DEMO_MAPS } from './demo-maps'
import { DEMO_PROFILES, DEMO_SPREAD, DemoProfile, DemoProfileKind } from './demo-profiles'
import { DatedGameMetrics } from './my-stats'

/** The name the made up player plays under. */
export const DEMO_PLAYER_NAME = 'Kestrel'

const DAY_MS = 24 * 60 * 60_000
/** How far back the made up games go. */
const HISTORY_DAYS = 2 * 365

type MyShape = Exclude<GameShape, 'other'>

/** How many games of each type the made up player played. */
const GAMES_BY_SHAPE: ReadonlyArray<[MyShape, number]> = [
  ['1v1', 1100],
  ['2v2', 360],
  ['3v3', 320],
  ['4v4', 200],
  ['ffa', 40],
]

/**
 * How well the made up player plays, in spreads of the other players: a little under the typical
 * player at first, and better than most by the end, so the trends have somewhere to go.
 */
const MY_SKILL_START = -0.3
const MY_SKILL_END = 0.4

/**
 * How often the made up player plays each race: mostly Protoss, with enough of the others that
 * other players of every race face every race.
 */
const MY_RACES: Record<AssignedRaceChar, number> = { p: 5, t: 2, z: 2.5 }

const SIDE_SIZE: Record<MyShape, number> = { '1v1': 1, '2v2': 2, '3v3': 3, '4v4': 4, ffa: 1 }

/** A small, seeded random number generator, so the made up games are the same every time. */
function createRandom(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    /** Normally spread around 0, with a spread of 1. */
    normal: () => {
      const u = Math.max(next(), 1e-9)
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
    },
    between: (min: number, max: number) => min + next() * (max - min),
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(items: ReadonlyArray<T>): T => items[Math.floor(next() * items.length)],
    weighted: <T>(items: ReadonlyArray<T>, weightOf: (item: T) => number): T => {
      const total = items.reduce((sum, item) => sum + weightOf(item), 0)
      let roll = next() * total
      for (const item of items) {
        roll -= weightOf(item)
        if (roll <= 0) {
          return item
        }
      }
      return items[items.length - 1]
    },
  }
}

type Random = ReturnType<typeof createRandom>

interface Person {
  name: string
  race: AssignedRaceChar
  /** How well they play, in spreads from the typical player: 0 is typical, 1 better than most. */
  skill: number
}

const NAME_WORDS = [
  'storm',
  'fox',
  'reaver',
  'nova',
  'arch',
  'blade',
  'ghost',
  'drift',
  'echo',
  'lancer',
  'mako',
  'onyx',
  'pike',
  'quill',
  'rook',
  'sable',
  'thorn',
  'vigil',
  'wisp',
  'zeal',
  'ember',
  'frost',
  'gale',
  'havoc',
  'iris',
  'jolt',
  'karma',
  'lumen',
  'mirage',
  'nimbus',
  'orbit',
  'prism',
]
const NAME_ROMANIZED = [
  'jaedong',
  'minsu',
  'hyunwoo',
  'sungmin',
  'jiho',
  'taeyang',
  'dohyun',
  'seojun',
  'yuna',
  'hajin',
  'kyungmo',
  'sangwon',
  'jinwoo',
  'eunho',
  'byungsoo',
  'woojin',
]
const CLANS = ['KOR', 'GG', 'BW', 'NoA', 'SC', 'DPL', 'iC']

/** A handle like the ones on a ladder: words, romanized names, numbers and clan tags. */
function makeName(random: Random) {
  const style = random.int(0, 3)
  let name
  if (style === 0) {
    name = random.pick(NAME_WORDS) + random.pick(NAME_WORDS)
  } else if (style === 1) {
    name = random.pick(NAME_ROMANIZED)
  } else if (style === 2) {
    const word = random.pick(NAME_WORDS)
    name = word[0].toUpperCase() + word.slice(1) + random.pick(['', 'X', 'z', 'GG'])
  } else {
    name = random.pick(NAME_ROMANIZED) + random.pick(['', '_', '.'])
  }
  if (random.chance(0.45)) {
    name += random.int(1, 999)
  }
  if (random.chance(0.12)) {
    name = `[${random.pick(CLANS)}]${name}`
  }
  return name
}

function makePeople(random: Random, count: number): Person[] {
  const used = new Set<string>([DEMO_PLAYER_NAME.toLowerCase()])
  const people: Person[] = []
  while (people.length < count) {
    const name = makeName(random)
    if (used.has(name.toLowerCase())) {
      continue
    }
    used.add(name.toLowerCase())
    people.push({
      name,
      race: random.weighted<AssignedRaceChar>(['p', 't', 'z'], r => (r === 'z' ? 1.1 : 1)),
      skill: random.normal(),
    })
  }
  return people
}

/** A spell each race casts, for the casts the real metrics count. */
const CASTS: Record<AssignedRaceChar, string> = {
  p: 'Psionic Storm',
  t: 'Scanner Sweep',
  z: 'Dark Swarm',
}

const TOWN_HALL_KEYS = new Set(['u106', 'u131', 'u154'])
const SUPPLY_KEYS = new Set(['u109', 'u156'])

function profileKindOf(shape: MyShape, family: MapFamily): DemoProfileKind {
  if (family !== 'standard') {
    return family
  }
  return shape === '1v1' ? '1v1' : 'team'
}

interface Played {
  person: Person
  team: number
  result: 'win' | 'loss' | 'unknown'
  /** When they went out, before the game ended. */
  leftAtMs?: number
  quit?: boolean
}

/** One player's numbers, from the typical player of their race and how well this one plays. */
function makeMetrics(
  random: Random,
  played: Played,
  profile: DemoProfile,
  durationMs: number,
  /** How well they played this game, in spreads from the typical player. */
  skill: number,
): PlayerMetrics {
  const { person } = played
  const race = person.race
  const playedMs = Math.min(played.leftAtMs ?? durationMs, durationMs)
  const isAt = (minute: number) => minute * 60_000 <= playedMs
  const losing = played.result === 'loss' ? 0.93 : 1
  /**
   * A median moved by how well the player plays, half of the spread, and by chance in this game,
   * the other half. Lower is better for things like the bank, so they move the other way.
   */
  const vary = (median: number, spread: number, lowerIsBetter = false) =>
    median * Math.exp(((lowerIsBetter ? -skill : skill) * 0.7 + random.normal() * 0.7) * spread)

  const economy = Math.exp(skill * 0.7 * DEMO_SPREAD.workers) * losing
  const workers = CHECKPOINT_MINUTES.map((minute, i) =>
    isAt(minute)
      ? Math.max(4, Math.round(profile.workers[i] * economy * (1 + random.normal() * 0.05)))
      : null,
  )
  const income = CHECKPOINT_MINUTES.map((minute, i) =>
    isAt(minute) ? Math.round(profile.income[i] * economy * (1 + random.normal() * 0.06)) : null,
  )
  let total = 0
  const mined = CHECKPOINT_MINUTES.map((minute, i) => {
    if (!isAt(minute)) {
      return null
    }
    const sinceLast = minute - (i === 0 ? 0 : CHECKPOINT_MINUTES[i - 1])
    total += (income[i] ?? 0) * sinceLast * (i === 0 ? 0.55 : 0.92)
    return Math.round(total)
  })
  const armyScale = vary(1, DEMO_SPREAD.armyScore) * losing
  const armyScore = CHECKPOINT_MINUTES.map((minute, i) =>
    isAt(minute) ? Math.round((profile.armyScore[i] * armyScale) / 25) * 25 : null,
  )
  const productionScale = vary(1, DEMO_SPREAD.production)
  const production = CHECKPOINT_MINUTES.map((minute, i) =>
    isAt(minute) ? Math.max(1, Math.round(profile.production[i] * productionScale)) : null,
  )

  const tempo = vary(1, DEMO_SPREAD.timing, true)
  const build = random.pick(profile.builds)
  const steps = build
    .map(([key, minute]) => ({ key, ms: Math.round(minute * 60_000 * vary(tempo, 0.04)) }))
    .filter(step => step.ms <= playedMs)
    .sort((a, b) => a.ms - b.ms)
  const firstStartsMs: Record<string, number> = {}
  for (const step of steps) {
    firstStartsMs[step.key] = Math.min(firstStartsMs[step.key] ?? Infinity, step.ms)
  }
  const townHallTimesMs = profile.townHalls.map(({ minute, share }) => {
    const ms = Math.round(minute * 60_000 * vary(tempo, 0.08))
    return random.chance(share * (1 + skill * 0.2)) && ms <= playedMs ? ms : null
  })
  for (const ms of townHallTimesMs) {
    const key = { p: 'u154', t: 'u106', z: 'u131' }[race]
    if (ms !== null && firstStartsMs[key] === undefined) {
      firstStartsMs[key] = ms
    }
  }
  const bases = CHECKPOINT_MINUTES.map(minute =>
    isAt(minute)
      ? 1 + townHallTimesMs.filter(ms => ms !== null && ms <= minute * 60_000).length
      : null,
  )
  const supplyTimesMs = profile.supplyMinutes.map(minute => {
    const ms = Math.round(minute * 60_000 * vary(tempo, 0.06))
    return ms <= playedMs ? ms : null
  })

  const phaseMinutes = PHASE_MINUTES.map(([start, end]) =>
    Math.max(0, Math.min(end, playedMs / 60_000) - start),
  )
  const inPhases = (values: ReadonlyArray<number>, spread: number, lowerIsBetter = false) => {
    const scale = vary(1, spread, lowerIsBetter)
    return phaseMinutes.map((minutes, i) =>
      minutes >= 1 ? Math.round(values[i] * scale * (1 + random.normal() * 0.08) * 10) / 10 : null,
    )
  }
  const bank = inPhases(profile.bank, DEMO_SPREAD.bank, true).map(b =>
    b === null ? null : Math.round(b),
  )
  const eapm = Math.round(vary(profile.eapm, DEMO_SPREAD.eapm))
  const apm = Math.round(eapm * (profile.apm / profile.eapm) * (1 + random.normal() * 0.06))
  const blockedShare = Math.min(
    0.4,
    vary(profile.supplyBlockedShare, DEMO_SPREAD.supplyBlockedShare, true),
  )
  const lastArmy = armyScore.findLast(s => s !== null) ?? 0
  const armyKilled = Math.round((lastArmy * random.between(0.4, 1.8)) / 25) * 25
  const armyLost =
    Math.round(
      (armyKilled * (played.result === 'win' ? 0.7 : 1.4) * random.between(0.7, 1.3)) / 25,
    ) * 25

  return {
    names: [person.name],
    race,
    team: played.team,
    result: played.result,
    leftAtMs: played.leftAtMs,
    quit: played.leftAtMs !== undefined ? played.quit : undefined,
    human: true,
    apm,
    eapm,
    workers,
    mined,
    income,
    armyScore,
    bases,
    production,
    supplyTimesMs,
    bank,
    supplyBlockedShare: playedMs >= 5 * 60_000 ? Math.round(blockedShare * 1000) / 1000 : null,
    supplyBlockedMs: Math.round(blockedShare * Math.max(0, playedMs - 3 * 60_000)),
    townHallTimesMs,
    firstStartsMs,
    opening: steps
      .filter(step => step.key.startsWith('u') && !SUPPLY_KEYS.has(step.key))
      .filter(step => !TOWN_HALL_KEYS.has(step.key) || race === 'z')
      .slice(0, 4)
      .map(step => step.key),
    firstArmyMs: Math.round(profile.firstArmyMinute * 60_000 * vary(tempo, 0.04)),
    armyKilled,
    armyLost,
    workersLost: Math.max(
      0,
      Math.round((playedMs / 60_000) * 0.35 * vary(1, 0.6, true) + random.normal()),
    ),
    overlordsLost: race === 'z' ? random.int(0, 3) : undefined,
    spamShare: Math.max(0, (apm - eapm) / apm),
    hotkeyRecallsPerMin: inPhases(profile.hotkeysPerMin, DEMO_SPREAD.hotkeys),
    productionPerMin: inPhases(profile.productionPerMin, DEMO_SPREAD.productionPerMin),
    apmByPhase: inPhases([apm * 0.8, apm * 1.05, apm * 1.1], 0.05),
    eapmByPhase: inPhases([eapm * 0.8, eapm * 1.05, eapm * 1.08], 0.05),
    groupsUsed: Math.max(1, Math.round(profile.groupsUsed + skill * 1.5 + random.normal())),
    casts: { [CASTS[race]]: random.int(0, 15) },
  }
}

/** Shares of the team's income and army, and who went out first, as the real metrics have them. */
function addTeamShares(players: PlayerMetrics[]) {
  for (const team of new Set(players.map(p => p.team))) {
    const side = players.filter(p => p.team === team)
    if (side.length < 2) {
      continue
    }
    const sum = (pick: (p: PlayerMetrics) => number) => side.reduce((s, p) => s + pick(p), 0)
    const incomeOf = (p: PlayerMetrics) => p.mined.findLast(m => m !== null) ?? 0
    const armyOf = (p: PlayerMetrics) => p.armyScore.findLast(m => m !== null) ?? 0
    const income = sum(incomeOf)
    const army = sum(armyOf)
    const killed = sum(p => p.armyKilled ?? 0)
    const outTimes = side
      .flatMap(p => (p.leftAtMs !== undefined ? [p.leftAtMs] : []))
      .sort((a, b) => a - b)
    for (const p of side) {
      p.teamShare = {
        income: income ? incomeOf(p) / income : 0,
        armyProduced: army ? armyOf(p) / army : 0,
        armyKilled: killed ? (p.armyKilled ?? 0) / killed : 0,
      }
      if (p.leftAtMs !== undefined) {
        p.outOrder = outTimes.indexOf(p.leftAtMs) + 1
      }
    }
  }
}

/** The other players of a game, met again sometimes, as regulars are in real replays. */
function pickOthers(
  random: Random,
  people: ReadonlyArray<Person>,
  regulars: ReadonlyArray<Person>,
  count: number,
  taken: Set<Person>,
) {
  const result: Person[] = []
  while (result.length < count) {
    const person = random.chance(0.25) ? random.pick(regulars) : random.pick(people)
    if (!taken.has(person)) {
      taken.add(person)
      result.push(person)
    }
  }
  return result
}

/**
 * A made up player with a couple of years of analyzed games of every type, on the maps people
 * play most, against and alongside a few hundred other made up players. The same games every time.
 */
export function generateDemoGames(nowMs: number): DatedGameMetrics[] {
  const random = createRandom(20261006)
  const people = makePeople(random, 700)
  const regulars = people.slice(0, 40)
  const startMs = nowMs - HISTORY_DAYS * DAY_MS

  const schedule = GAMES_BY_SHAPE.flatMap(([shape, count]) =>
    Array.from({ length: count }, () => ({
      shape,
      timeMs: startMs + random.next() ** 0.7 * HISTORY_DAYS * DAY_MS,
    })),
  ).sort((a, b) => a.timeMs - b.timeMs)

  return schedule.map(({ shape, timeMs }, i): DatedGameMetrics => {
    const progress = (timeMs - startMs) / (HISTORY_DAYS * DAY_MS)
    const map = random.weighted(DEMO_MAPS[shape], m => m.weight)
    const mapName = random.weighted(map.titles, t => t.weight).title
    const family = getMapFamily(mapName)
    const profiles = DEMO_PROFILES[profileKindOf(shape, family)]

    const myRace = random.weighted<AssignedRaceChar>(['p', 't', 'z'], r => MY_RACES[r])
    const mySkill = MY_SKILL_START + (MY_SKILL_END - MY_SKILL_START) * progress
    const me: Person = { name: DEMO_PLAYER_NAME, race: myRace, skill: mySkill }
    const taken = new Set<Person>()
    const size = SIDE_SIZE[shape]
    const sideCount = shape === 'ffa' ? random.int(3, 4) : 2
    const mine = [me, ...pickOthers(random, people, regulars, size - 1, taken)]
    const sides = [
      mine,
      ...Array.from({ length: sideCount - 1 }, () =>
        pickOthers(random, people, regulars, size, taken),
      ),
    ]
    // Each player's play this game: how well they play, and how this game went for them.
    const form = new Map(sides.flat().map(p => [p, p.skill + random.normal() * 0.6]))

    const strength = (side: Person[]) => side.reduce((s, p) => s + form.get(p)!, 0) / side.length
    const theirs = Math.max(...sides.slice(1).map(strength))
    const iWin = random.chance(1 / (1 + Math.exp(-(strength(mine) - theirs) * 2.2)))
    const winner = iWin ? 0 : random.int(1, sides.length - 1)
    const unknown = random.chance(0.03)
    const complete = !random.chance(0.04)
    const durationMs = Math.round(
      Math.max(4, profiles[myRace].durationMinutes * Math.exp(random.normal() * 0.4)) * 60_000,
    )

    const teamGame = size > 1
    const players: PlayerMetrics[] = sides.flatMap((side, s) => {
      const lost = s !== winner
      // Losing teams fall one by one: the weakest first, the last one when the game ends.
      const order = [...side].sort((a, b) => form.get(a)! - form.get(b)!)
      return side.map(person => {
        let leftAtMs: number | undefined
        let quit = false
        if (lost && teamGame && order.indexOf(person) < side.length - 1) {
          leftAtMs = Math.round(durationMs * random.between(0.55, 0.97))
        }
        if (person === me && random.chance(0.02)) {
          leftAtMs = Math.round(random.between(1.5, 4.5) * 60_000)
          quit = true
        }
        let result: Played['result'] = lost ? 'loss' : 'win'
        if (unknown) {
          result = 'unknown'
        }
        const played: Played = { person, team: teamGame ? s + 1 : 0, result, leftAtMs, quit }
        return makeMetrics(random, played, profiles[person.race], durationMs, form.get(person)!)
      })
    })
    if (teamGame) {
      addTeamShares(players)
    }

    return {
      version: GAME_METRICS_VERSION,
      gameId: `demo-${String(i).padStart(5, '0')}`,
      durationMs,
      complete,
      mapName,
      mapFamily: family,
      shape,
      players,
      gameTimeMs: Math.round(timeMs),
    }
  })
}
