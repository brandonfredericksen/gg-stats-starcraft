import {
  BuildStepMetric,
  CHECKPOINT_MINUTES,
  GameShape,
  PlayerMetrics,
} from '../games/player-metrics'
import { isTeamGame } from './player-games'

/** Tech started after this isn't part of how a player opened anymore. */
const TECH_BY_MS = 7 * 60_000
/** In team games, where openings run longer, what follows them is told by this. */
const TEAM_TECH_BY_MS = 10 * 60_000
/** A second town hall after this, with no tech before it, came after the opening. */
const EXPAND_BY_MS = 5 * 60_000
/**
 * A game over before this, with nothing after the opening to tell where it was going, doesn't say
 * which build it was.
 */
const SHORT_GAME_MS = 6 * 60_000
/** This few workers at 6 minutes, with no tech, is an all-in. */
const ALL_IN_WORKERS = 14
/** Or this few at 4 minutes, for a game over before 6. */
const ALL_IN_WORKERS_AT_4 = 12
/** A Barracks this early, with no gas before it, is part of a Barracks rush. */
const BBS_MAX_SUPPLY = 10
/** Two Starports by this are a Wraith or Valkyrie build. */
const TWO_PORT_BY_MS = 6 * 60_000
/** A Starport and a Wraith by these, after a Factory, are Wraith play. */
const WRAITH_PORT_BY_MS = 5.5 * 60_000
const WRAITH_BY_MS = 6.5 * 60_000
/** Marines made by this, with a Factory before the Command Center, are a fake double. */
const FD_MARINES_BY_MS = 4.5 * 60_000
const FD_MARINES = 4
/** Two more Command Centers by this, after a Factory, are a 1 Factory double expand. */
const DOUBLE_BY_MS = 5.5 * 60_000
/** Production buildings by 10 minutes, three of one kind, say which way a Terran went. */
const STYLE_BUILDINGS = 3
/** A Siege Tank by this, with bio, is bio and tanks. */
const BIO_TANKS_BY_MS = 8 * 60_000
/** A Zerg's Metabolic Boost started by this goes with a pool first opening. */
const SPEED_BY_MS = 3 * 60_000
/** A Spawning Pool started before these, without supply to go by, is a 4 pool or a 9 pool. */
const POOL4_MS = 50_000
const POOL9_MS = 90_000
/** Protoss tech that comes after the first, by these, names where the build went. */
const REAVER_BY_MS = 7 * 60_000
const DT_BY_MS = 8 * 60_000
const CAPITAL_BY_MS = 9 * 60_000

const NEXUS = 'u154'
const GATEWAY = 'u160'
const FORGE = 'u166'
const CORE = 'u164'
const CANNON = 'u162'
const PYLON = 'u156'
const ASSIMILATOR = 'u157'
const SUPPORT_BAY = 'u171'
const DARK_TEMPLAR = 'u61'
const CARRIER = 'u72'
const ARBITER = 'u71'
/** Robotics Facility, Citadel of Adun, Stargate and Templar Archives. */
const PROTOSS_TECH = ['u155', 'u163', 'u167', 'u165']

const COMMAND_CENTER = 'u106'
const BARRACKS = 'u111'
const ACADEMY = 'u112'
const FACTORY = 'u113'
const STARPORT = 'u114'
const REFINERY = 'u110'
const SIEGE_TANK = 'u5'
const WRAITH = 'u8'
const VALKYRIE = 'u58'
const MARINE_ID = 0
/** Buildings that don't say where a Terran build is going: gas, defense, add-ons and supply. */
const TERRAN_FILLER: ReadonlySet<string> = new Set([
  'u107',
  'u108',
  'u109',
  REFINERY,
  'u115',
  'u117',
  'u118',
  'u120',
  'u122',
  'u124',
  'u125',
])

const HATCHERY = 'u131'
const LAIR = 'u132'
const HYDRALISK_DEN = 'u135'
const SPIRE = 'u141'
const SPAWNING_POOL = 'u142'
const OVERLORD = 'u42'
const LURKER_ASPECT = 't32'
const METABOLIC_BOOST = 'g27.1'
const HYDRALISK_ID = 38
const MUTALISK_ID = 43
const SCOURGE_ID = 47

/** Openings and tags that are where a build was going on their own, without more after them. */
const TELLING_OPENERS: ReadonlySet<string> = new Set([
  'nexusFirst',
  'forgeExpand',
  'forgeCannons',
  'bbs',
  'pool4',
  'hatch3',
  'twoPort',
  'twoFact',
  'oneOneOne',
  'siegeExpand',
  'fd',
  'factDouble',
])

class Steps {
  constructor(private steps: ReadonlyArray<BuildStepMetric>) {}

  /** The `nth` step of a kind, if the player took it. */
  find(key: string, nth = 1) {
    return this.steps.filter(step => step.key === key)[nth - 1]
  }

  /** When the `nth` step of a kind was started, or Infinity if it never was. */
  at(key: string, nth = 1) {
    return this.find(key, nth)?.timeMs ?? Infinity
  }

  /** How many steps of a kind were started before a time. */
  countBefore(key: string, ms: number) {
    return this.steps.filter(step => step.key === key && step.timeMs < ms).length
  }

  /** The buildings started after a time, in order. */
  buildingsAfter(ms: number) {
    return this.steps.filter(
      step => step.timeMs > ms && /^u\d+$/.test(step.key) && isBuilding(step),
    )
  }
}

function isBuilding(step: BuildStepMetric) {
  return Number(step.key.slice(1)) >= 106
}

/** What kind of game a build was played in, which changes how far into it a build goes. */
interface FamilyContext {
  team: boolean
  techByMs: number
}

function protossFamily(steps: Steps, context: FamilyContext): string[] | undefined {
  const gate = steps.at(GATEWAY)
  const forge = steps.at(FORGE)
  const nexus = steps.at(NEXUS)
  const core = steps.at(CORE)
  const [techMs, tech] = PROTOSS_TECH.map(key => [steps.at(key), key] as const)
    .filter(([ms]) => ms <= TECH_BY_MS)
    .sort(([a], [b]) => a - b)[0] ?? [Infinity, undefined]

  let opener: string
  if (nexus < gate && nexus < forge) {
    opener = 'nexusFirst'
  } else if (forge < gate) {
    if (nexus < Math.min(techMs, EXPAND_BY_MS)) {
      opener = 'forgeExpand'
    } else if (steps.countBefore(CANNON, gate) >= 2) {
      opener = 'forgeCannons'
    } else {
      opener = 'forge'
    }
  } else if (gate < Infinity) {
    if (steps.countBefore(GATEWAY, core) >= 2) {
      // Zealots first, the Core after them.
      opener = 'gates2'
    } else {
      // A Core first, then however many Gateways before the first tech.
      const gates = steps.countBefore(GATEWAY, Math.min(techMs, TECH_BY_MS))
      opener = gates >= 3 ? `gates${Math.min(gates, 4)}` : 'gates1'
    }
  } else {
    return undefined
  }

  if (context.team && opener === 'gates2') {
    return [opener, ...protossBranch(steps)]
  }
  const expanded =
    opener !== 'nexusFirst' && opener !== 'forgeExpand' && nexus < Math.min(techMs, EXPAND_BY_MS)
  return [
    opener,
    ...(expanded ? ['expand'] : []),
    ...(tech ? [tech, ...protossFollowUp(steps, tech)] : []),
  ]
}

/**
 * In team games, where a 2 Gate opening is everyone's, what comes after the second Gateway, other
 * than Pylons: a third Gateway, a Forge, or gas and a Core.
 */
function protossBranch(steps: Steps): string[] {
  const next = steps.buildingsAfter(steps.at(GATEWAY, 2)).find(step => step.key !== PYLON)
  switch (next?.key) {
    case GATEWAY:
      return ['gate3']
    case FORGE:
      return ['forge']
    case ASSIMILATOR:
    case CORE:
      return ['core']
    case NEXUS:
      return ['expand']
    default:
      return []
  }
}

/** Where a Protoss's first tech led: Reavers, Dark Templar, Carriers or Arbiters. */
function protossFollowUp(steps: Steps, tech: string): string[] {
  if (tech === 'u155' && steps.at(SUPPORT_BAY) <= REAVER_BY_MS) {
    return ['reaver']
  }
  if (steps.at(DARK_TEMPLAR) <= DT_BY_MS) {
    return ['dt']
  }
  if (steps.at(CARRIER) <= CAPITAL_BY_MS) {
    return ['carrier']
  }
  if (steps.at(ARBITER) <= CAPITAL_BY_MS) {
    return ['arbiter']
  }
  return []
}

function terranFamily(steps: Steps, player: PlayerMetrics): string[] | undefined {
  const rax = steps.at(BARRACKS)
  const cc = steps.at(COMMAND_CENTER)
  if (cc < rax) {
    return ['ccFirst', ...terranStyle(steps)]
  }
  if (rax === Infinity) {
    return undefined
  }
  const next = steps.buildingsAfter(rax).find(step => !TERRAN_FILLER.has(step.key))
  let opener = 'rax'
  if (next?.key === BARRACKS) {
    const gasFirst = steps.at(REFINERY) < next.timeMs
    opener = !gasFirst && (next.supply ?? Infinity) <= BBS_MAX_SUPPLY ? 'bbs' : 'twoRax'
  } else if (next?.key === COMMAND_CENTER) {
    opener = 'raxCC'
  } else if (next?.key === ACADEMY) {
    opener = 'raxAcademy'
  } else if (next?.key === FACTORY) {
    const port = steps.at(STARPORT)
    const laterCC = steps.at(COMMAND_CENTER)
    const marines = (player.unitTimes?.[MARINE_ID] ?? []).filter(
      ms => ms <= FD_MARINES_BY_MS,
    ).length
    if (steps.at(STARPORT, 2) <= TWO_PORT_BY_MS) {
      opener = 'twoPort'
    } else if (steps.at(FACTORY, 2) < Math.min(port, laterCC)) {
      opener = 'twoFact'
    } else if (port < laterCC) {
      opener = 'oneOneOne'
    } else if (steps.at(SIEGE_TANK) < laterCC) {
      opener = marines >= FD_MARINES ? 'fd' : 'siegeExpand'
    } else if (steps.at(COMMAND_CENTER, 2) <= DOUBLE_BY_MS) {
      opener = 'factDouble'
    } else if (laterCC < Infinity) {
      opener = 'factExpand'
    } else {
      opener = 'factory'
    }
  }
  const expanded =
    (opener === 'twoRax' || opener === 'raxAcademy' || opener === 'bbs' || opener === 'rax') &&
    cc <= EXPAND_BY_MS
  const air = opener === 'twoPort' || opener === 'oneOneOne' || isFactoryOpener(opener)
  return [
    opener,
    ...(expanded ? ['expand'] : []),
    ...(air ? terranAir(steps, opener) : []),
    ...terranStyle(steps),
  ]
}

function isFactoryOpener(opener: string) {
  return (
    opener === 'factExpand' ||
    opener === 'factory' ||
    opener === 'factDouble' ||
    opener === 'siegeExpand'
  )
}

/** The air units a Starport build made: Wraiths or Valkyries. */
function terranAir(steps: Steps, opener: string): string[] {
  const wraith = steps.at(WRAITH)
  const valkyrie = steps.at(VALKYRIE)
  if (opener === 'twoPort' || opener === 'oneOneOne') {
    if (valkyrie < wraith) {
      return ['valkyrie']
    }
    return wraith < Infinity ? ['wraith'] : []
  }
  return steps.at(STARPORT) <= WRAITH_PORT_BY_MS && wraith <= WRAITH_BY_MS ? ['wraith'] : []
}

/**
 * Three Barracks with an Academy by 10 minutes (`bio`), with a Siege Tank by 8 (`bioTanks`). A
 * Terran with fewer gets no tag, even if they play that style.
 */
function terranStyle(steps: Steps) {
  if (steps.find(BARRACKS, STYLE_BUILDINGS) && steps.find(ACADEMY)) {
    return [steps.at(SIEGE_TANK) <= BIO_TANKS_BY_MS ? 'bioTanks' : 'bio']
  }
  return []
}

function zergFamily(
  steps: Steps,
  player: PlayerMetrics,
  context: FamilyContext,
): string[] | undefined {
  const poolStep = steps.find(SPAWNING_POOL)
  const pool = poolStep?.timeMs ?? Infinity
  const hatches = steps.countBefore(HATCHERY, pool)
  let opener: string
  if (hatches >= 2) {
    opener = 'hatch3'
  } else if (hatches === 1) {
    opener = 'hatch'
  } else if (poolStep) {
    const overlordFirst = steps.at(OVERLORD) < pool
    if (poolStep.supply !== undefined) {
      if (poolStep.supply <= 8) {
        opener = 'pool4'
      } else if (poolStep.supply <= 10) {
        opener = overlordFirst ? 'overpool' : 'pool9'
      } else {
        opener = 'pool12'
      }
    } else if (pool < POOL4_MS) {
      opener = 'pool4'
    } else {
      opener = pool < POOL9_MS ? 'pool9' : 'pool12'
    }
  } else {
    return undefined
  }

  const lair = steps.at(LAIR)
  const spire = steps.at(SPIRE)
  const tags: string[] = []
  if (spire <= context.techByMs) {
    // Counted with the main: a third before the Lair is a 3 hatch build, whatever comes during it.
    if (steps.countBefore(HATCHERY, lair) + 1 >= 3) {
      tags.push('muta3')
    } else {
      tags.push(steps.countBefore(HATCHERY, spire) === 0 ? 'muta1' : 'muta2')
    }
    if (hydraOverMuta(player)) {
      tags.push('intoHydra')
    }
  } else if (steps.at(LURKER_ASPECT) <= context.techByMs) {
    tags.push('lurker')
  } else if (steps.at(HYDRALISK_DEN) <= context.techByMs && steps.at(HYDRALISK_DEN) < lair) {
    tags.push('hydra')
  } else if (
    opener !== 'hatch' &&
    opener !== 'hatch3' &&
    steps.at(METABOLIC_BOOST) <= SPEED_BY_MS
  ) {
    tags.push('speed')
  }
  return [opener, ...tags]
}

/**
 * Whether a Zerg's army, at the latest minute counted, had more Hydralisks than Mutalisks, with
 * each pair of Scourge counting as one: a Spire to hold off the air, then Hydras.
 */
function hydraOverMuta(player: PlayerMetrics) {
  const mix = player.armyMix ?? {}
  const count = (unitId: number, minute: number) => mix[unitId]?.[minute] ?? 0
  const minutes = Math.max(0, ...Object.values(mix).map(counts => counts.length))
  for (let minute = minutes - 1; minute >= 0; minute--) {
    const hydra = count(HYDRALISK_ID, minute) + count(SCOURGE_ID, minute) / 2
    const muta = count(MUTALISK_ID, minute)
    if (hydra || muta) {
      return hydra > muta
    }
  }
  return false
}

/** Whether a player kept so few workers that the build was all in on its first attack. */
function isAllIn(player: PlayerMetrics) {
  const at6 = player.workers[CHECKPOINT_MINUTES.indexOf(6)]
  if (at6 !== null && at6 !== undefined) {
    return at6 <= ALL_IN_WORKERS
  }
  const at4 = player.workers[CHECKPOINT_MINUTES.indexOf(4)]
  return at4 !== null && at4 !== undefined && at4 <= ALL_IN_WORKERS_AT_4
}

/** The game a build was played in, as far as naming it goes. */
export interface FamilyGame {
  shape?: GameShape
  /** How long the player played. */
  playedMs?: number
}

/**
 * The build a player went with, by the names players use for them, like a 2 Gate, a Forge expand,
 * a Rax CC with bio, or a hatch first into 2 hatch Mutalisks. It's the race, the opening, then what
 * it led to, joined by spaces, like `p gates1 expand u155 reaver`. An all-in with nothing after the
 * opening is tagged `allIn`. In team games, a Protoss 2 Gate is named by what came after its second
 * Gateway, and Zerg tech counts for longer. Undefined without a build order to tell, or for a game
 * over too soon to say where the build was going.
 */
export function getBuildFamily(player: PlayerMetrics, game: FamilyGame = {}): string | undefined {
  if (!player.buildSteps?.length) {
    return undefined
  }
  const team = game.shape !== undefined && isTeamGame(game.shape)
  const context: FamilyContext = { team, techByMs: team ? TEAM_TECH_BY_MS : TECH_BY_MS }
  const steps = new Steps(player.buildSteps)
  let parts: string[] | undefined
  if (player.race === 'p') {
    parts = protossFamily(steps, context)
  } else if (player.race === 't') {
    parts = terranFamily(steps, player)
  } else if (player.race === 'z') {
    parts = zergFamily(steps, player, context)
  }
  if (!parts) {
    return undefined
  }
  const [opener, ...rest] = parts
  const telling = rest.length > 0 || TELLING_OPENERS.has(opener)
  if (!telling && isAllIn(player)) {
    parts.push('allIn')
  } else if (!telling && game.playedMs !== undefined && game.playedMs < SHORT_GAME_MS) {
    return undefined
  }
  return [player.race, ...parts].join(' ')
}
