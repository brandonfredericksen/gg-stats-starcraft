import { BuildStepMetric, PlayerMetrics } from '../games/player-metrics'

/** Tech started after this isn't part of how a player opened anymore. */
const TECH_BY_MS = 7 * 60_000
/** A second town hall after this, with no tech before it, came after the opening. */
const EXPAND_BY_MS = 5 * 60_000
/** A Barracks this early, with no gas before it, is part of a Barracks rush. */
const BBS_MAX_SUPPLY = 10
/** Two Starports by this are a Wraith or Valkyrie build. */
const TWO_PORT_BY_MS = 6 * 60_000
/** Production buildings by 10 minutes, three of one kind, say which way a Terran went. */
const STYLE_BUILDINGS = 3
/** A Zerg's Metabolic Boost started by this, on one base, goes with a 9 pool. */
const SPEED_BY_MS = 3 * 60_000
/** A Spawning Pool started before these, without supply to go by, is a 4 pool or a 9 pool. */
const POOL4_MS = 50_000
const POOL9_MS = 90_000

const NEXUS = 'u154'
const GATEWAY = 'u160'
const FORGE = 'u166'
const CORE = 'u164'
const CANNON = 'u162'
/** Robotics Facility, Citadel of Adun, Stargate and Templar Archives. */
const PROTOSS_TECH = ['u155', 'u163', 'u167', 'u165']

const COMMAND_CENTER = 'u106'
const BARRACKS = 'u111'
const ACADEMY = 'u112'
const FACTORY = 'u113'
const STARPORT = 'u114'
const REFINERY = 'u110'
const SIEGE_MODE = 't5'
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

function protossFamily(steps: Steps): string[] | undefined {
  const gate = steps.at(GATEWAY)
  const forge = steps.at(FORGE)
  const nexus = steps.at(NEXUS)
  const [techMs, tech] = PROTOSS_TECH.map(key => [steps.at(key), key] as const)
    .filter(([ms]) => ms <= TECH_BY_MS)
    .sort(([a], [b]) => a - b)[0] ?? [Infinity, undefined]

  let opener: string
  if (nexus < gate && nexus < forge) {
    opener = 'nexusFirst'
  } else if (forge < gate) {
    if (nexus < gate) {
      opener = 'forgeExpand'
    } else if (steps.countBefore(CANNON, gate) >= 2) {
      opener = 'forgeCannons'
    } else {
      opener = 'forge'
    }
  } else if (gate < Infinity) {
    const gates = steps.countBefore(GATEWAY, Math.min(steps.at(CORE), techMs))
    opener = `gates${Math.min(gates, 4)}`
  } else {
    return undefined
  }
  const expanded =
    opener !== 'nexusFirst' && opener !== 'forgeExpand' && nexus < Math.min(techMs, EXPAND_BY_MS)
  return [opener, ...(expanded ? ['expand'] : []), ...(tech ? [tech] : [])]
}

function terranFamily(steps: Steps): string[] | undefined {
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
    if (steps.at(STARPORT, 2) <= TWO_PORT_BY_MS) {
      opener = 'twoPort'
    } else if (steps.at(FACTORY, 2) < Math.min(port, laterCC)) {
      opener = 'twoFact'
    } else if (port < laterCC) {
      opener = 'oneOneOne'
    } else if (steps.at(SIEGE_MODE) < laterCC) {
      opener = 'siegeExpand'
    } else if (laterCC < Infinity) {
      opener = 'factExpand'
    } else {
      opener = 'factory'
    }
  }
  const expanded =
    (opener === 'twoRax' || opener === 'raxAcademy' || opener === 'bbs' || opener === 'rax') &&
    cc <= EXPAND_BY_MS
  return [opener, ...(expanded ? ['expand'] : []), ...terranStyle(steps)]
}

/**
 * Three Factories (`mech`, shown as a third Factory) or three Barracks with an Academy (`bio`) by 10
 * minutes. A Terran with fewer of either gets no tag, even if they play that style.
 */
function terranStyle(steps: Steps) {
  if (steps.find(FACTORY, STYLE_BUILDINGS)) {
    return ['mech']
  }
  if (steps.find(BARRACKS, STYLE_BUILDINGS) && steps.find(ACADEMY)) {
    return ['bio']
  }
  return []
}

function zergFamily(steps: Steps): string[] | undefined {
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
  let tech: string | undefined
  if (steps.at(SPIRE) <= TECH_BY_MS) {
    tech = steps.countBefore(HATCHERY, lair) + 1 >= 3 ? 'muta3' : 'muta2'
  } else if (steps.at(LURKER_ASPECT) <= TECH_BY_MS) {
    tech = 'lurker'
  } else if (steps.at(HYDRALISK_DEN) <= TECH_BY_MS && steps.at(HYDRALISK_DEN) < lair) {
    tech = 'hydra'
  } else if (
    opener === 'pool9' &&
    steps.at(METABOLIC_BOOST) <= SPEED_BY_MS &&
    steps.countBefore(HATCHERY, SPEED_BY_MS) === 0
  ) {
    tech = 'speed'
  }
  return [opener, ...(tech ? [tech] : [])]
}

/**
 * The build a player went with, by the names players use for them, like a 2 Gate, a Forge expand,
 * a Rax CC with bio, or a hatch first into 3 hatch Mutalisks. It's the race, the opening, then what
 * it led to, joined by spaces, like `p gates1 expand u155`. Undefined without a build order to tell.
 */
export function getBuildFamily(player: PlayerMetrics): string | undefined {
  if (!player.buildSteps?.length) {
    return undefined
  }
  const steps = new Steps(player.buildSteps)
  let parts: string[] | undefined
  if (player.race === 'p') {
    parts = protossFamily(steps)
  } else if (player.race === 't') {
    parts = terranFamily(steps)
  } else if (player.race === 'z') {
    parts = zergFamily(steps)
  }
  return parts ? [player.race, ...parts].join(' ') : undefined
}
