import type { CommandKind, Player, ReplayCommand } from '@shieldbattery/broodrep'
import { FASTEST_MS_PER_FRAME } from './game-stats'
import { PHASE_MINUTES } from './player-metrics'

/**
 * The version of {@link ReplayCommandStats} worked out now. Stats from an older version are worked
 * out again from the replay.
 */
export const COMMAND_STATS_VERSION = 2

/** BW's hotkey commands: assigning a group, selecting it, and adding to it. */
const HOTKEY_ASSIGN = 0
const HOTKEY_RECALL = 1
const HOTKEY_ADD = 2

/**
 * Units that aren't made by production buildings, or that are made but don't fight: workers,
 * Overlords, Nukes, and the Zerg units morphed from other units rather than from larvae.
 */
const NOT_PRODUCED_UNIT_IDS: ReadonlySet<number> = new Set([
  7, // SCV
  41, // Drone
  64, // Probe
  42, // Overlord
  14, // Nuclear Missile
  103, // Lurker
  44, // Guardian
  62, // Devourer
])

/** Commands that start making something. */
const PRODUCTION_KINDS: ReadonlySet<CommandKind> = new Set<CommandKind>([
  'train',
  'unitMorph',
  'buildingMorph',
  'build',
  'trainFighter',
])

/** Commands that pick units. */
const SELECTION_KINDS: ReadonlySet<CommandKind> = new Set<CommandKind>([
  'select',
  'selectAdd',
  'selectRemove',
])

/**
 * The spells worth counting, by BW's order id. A cast here is a command to cast, which a player
 * may give more than once for one spell.
 */
export const SPELL_ORDERS: ReadonlyMap<number, string> = new Map([
  [0x71, 'yamatoGun'],
  [0x73, 'lockdown'],
  [0x77, 'darkSwarm'],
  [0x78, 'parasite'],
  [0x79, 'spawnBroodlings'],
  [0x7a, 'empShockwave'],
  [0x89, 'recall'],
  [0x8b, 'scannerSweep'],
  [0x8d, 'defensiveMatrix'],
  [0x8e, 'psionicStorm'],
  [0x8f, 'irradiate'],
  [0x90, 'plague'],
  [0x91, 'consume'],
  [0x92, 'ensnare'],
  [0x93, 'stasisField'],
  [0x94, 'hallucination'],
  [0xb4, 'restoration'],
  [0xb5, 'disruptionWeb'],
  [0xb6, 'mindControl'],
  [0xb8, 'feedback'],
  [0xb9, 'opticalFlare'],
  [0xba, 'maelstrom'],
])

/** What a player did in one of {@link PHASE_MINUTES}. */
export interface PhaseCommands {
  /** How long the player was playing in this phase. */
  minutes: number
  /** Commands that count toward APM: selecting, ordering, making things and hotkeys. */
  actions: number
  hotkeyAssigns: number
  hotkeyRecalls: number
  hotkeyAdds: number
  selections: number
  /** Orders for army units from production buildings and larvae. */
  production: number
}

export interface PlayerCommandStats {
  name: string
  /** One per {@link PHASE_MINUTES}. */
  phases: PhaseCommands[]
  /** How many different hotkey groups the player recalled. */
  groupsUsed: number
  /** Commands to cast each spell, keyed by the names in {@link SPELL_ORDERS}. */
  casts: Record<string, number>
}

/** What a replay's commands say about how each player played, which the game's stats don't. */
export interface ReplayCommandStats {
  version: typeof COMMAND_STATS_VERSION
  players: PlayerCommandStats[]
}

function emptyPhase(minutes: number): PhaseCommands {
  return {
    minutes,
    actions: 0,
    hotkeyAssigns: 0,
    hotkeyRecalls: 0,
    hotkeyAdds: 0,
    selections: 0,
    production: 0,
  }
}

function phaseIndex(ms: number) {
  return PHASE_MINUTES.findIndex(([start, end]) => ms >= start * 60_000 && ms < end * 60_000)
}

/** Counts what each human player did from a replay's commands. */
export function summarizeCommands(
  players: ReadonlyArray<Pick<Player, 'networkId' | 'name' | 'playerType' | 'isObserver'>>,
  commands: ReadonlyArray<ReplayCommand>,
  frames: number,
): ReplayCommandStats {
  const humans = players.filter(p => p.playerType === 'human' && !p.isObserver)
  const leftAtMs = new Map<number, number>()
  for (const { frame, playerId, command } of commands) {
    if (command.type === 'leaveGame' && !leftAtMs.has(playerId)) {
      leftAtMs.set(playerId, frame * FASTEST_MS_PER_FRAME)
    }
  }

  const byId = new Map(
    humans.map(p => {
      const playedMs = leftAtMs.get(p.networkId) ?? frames * FASTEST_MS_PER_FRAME
      const phases = PHASE_MINUTES.map(([start, end]) =>
        emptyPhase(Math.max(0, Math.min(end * 60_000, playedMs) - start * 60_000) / 60_000),
      )
      return [
        p.networkId,
        {
          stats: { name: p.name, phases, groupsUsed: 0, casts: {} } as PlayerCommandStats,
          groups: new Set<number>(),
        },
      ]
    }),
  )

  for (const { frame, playerId, command } of commands) {
    const entry = byId.get(playerId)
    const phase = entry?.stats.phases[phaseIndex(frame * FASTEST_MS_PER_FRAME)]
    if (!entry || !phase) {
      continue
    }
    const kind = command.type as CommandKind
    if (command.type === 'hotkey') {
      phase.actions += 1
      if (command.hotkeyType === HOTKEY_ASSIGN) {
        phase.hotkeyAssigns += 1
      } else if (command.hotkeyType === HOTKEY_RECALL) {
        phase.hotkeyRecalls += 1
        entry.groups.add(command.group)
      } else if (command.hotkeyType === HOTKEY_ADD) {
        phase.hotkeyAdds += 1
      }
    } else if (SELECTION_KINDS.has(kind)) {
      phase.actions += 1
      phase.selections += 1
    } else if (PRODUCTION_KINDS.has(kind)) {
      phase.actions += 1
      if (
        (command.type === 'train' || command.type === 'unitMorph') &&
        !NOT_PRODUCED_UNIT_IDS.has(command.unitType)
      ) {
        phase.production += 1
      }
    } else if (command.type === 'targetedOrder') {
      phase.actions += 1
      const spell = SPELL_ORDERS.get(command.order)
      if (spell) {
        entry.stats.casts[spell] = (entry.stats.casts[spell] ?? 0) + 1
      }
    } else if (!NOT_ACTIONS.has(kind)) {
      phase.actions += 1
    }
  }

  return {
    version: COMMAND_STATS_VERSION,
    players: Array.from(byId.values(), ({ stats, groups }) => ({
      ...stats,
      groupsUsed: groups.size,
    })),
  }
}

/** Commands that aren't the player acting in the game, which APM leaves out. */
const NOT_ACTIONS: ReadonlySet<CommandKind> = new Set<CommandKind>([
  'vision',
  'alliance',
  'gameSpeed',
  'pause',
  'resume',
  'cheat',
  'chat',
  'keepAlive',
  'leaveGame',
  'latency',
  'known',
  'unknown',
])
