import type { CommandData, CommandKind, Player, ReplayCommand } from '@shieldbattery/broodrep'
import { FASTEST_MS_PER_FRAME } from './game-stats'
import { MIN_PHASE_MINUTES, PHASE_MINUTES } from './player-metrics'

/**
 * The version of {@link ReplayCommandStats} worked out now. Stats from an older version are worked
 * out again from the replay.
 */
export const COMMAND_STATS_VERSION = 7

/**
 * How many commands that do something, from one player, per frame of a network turn, make a frame
 * a burst. A turn runs everything sent during it on one frame, and lasts a frame or more depending
 * on latency. Over about 14,000 player-games of ladder and team replays, players playing by hand
 * almost never sent this many, while macro programs and bots select and order building after
 * building in one go.
 */
const BURST_COMMANDS_PER_TURN_FRAME = 4

/**
 * At this share of a player's commands sent in bursts, a program played the game. Players playing
 * by hand stayed under 0.1 in the same replays, and most programs sent over half in bursts.
 */
export const SCRIPTED_BURST_SHARE = 0.2

/**
 * Fewer commands that do something than this say too little to tell a program from a person, like
 * a player leaving in the first minute. The shares above were worked out from players with more.
 */
const MIN_BURST_COMMANDS = 200

/**
 * A player who made something this many times by selecting it and switching back to what they had,
 * all on one frame, had a program do it, if those were at least {@link MACRO_CYCLE_SHARE} of what
 * they made. A program that makes workers or units for a player does it that way between the
 * player's own commands, while over about 35,000 player-games of ladder and team replays, players
 * the bursts didn't give away almost never did it more than twice.
 */
export const MACRO_CYCLES = 10
export const MACRO_CYCLE_SHARE = 0.1

/** Cycles this early are a player setting up their hotkeys as the game starts, not a program. */
const OPENING_MS = 20_000

/** Commands that make something with what's selected. */
const PRODUCTION_KINDS: ReadonlySet<CommandKind> = new Set<CommandKind>([
  'train',
  'trainFighter',
  'unitMorph',
  'buildingMorph',
  'tech',
  'upgrade',
])

/** Gaps between commands longer than this are players pausing, not the length of a turn. */
const MAX_TURN_FRAMES = 12

/** A gap is the turn's length once at least this share of gaps are that long. */
const TURN_GAP_SHARE = 0.02

/** BW's hotkey commands: assigning a group, selecting it, and adding to it. */
export const HOTKEY_ASSIGN = 0
export const HOTKEY_RECALL = 1
export const HOTKEY_ADD = 2

/**
 * Recalling the same group twice this many frames apart or closer is a double tap, which centers
 * the screen on the group.
 */
export const DOUBLE_TAP_FRAMES = 12

/** Commands that pick units. */
export const SELECTION_KINDS: ReadonlySet<CommandKind> = new Set<CommandKind>([
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
  /**
   * Times the player double tapped a hotkey, which moves the screen to the group, and didn't press
   * another hotkey right away.
   */
  hotkeyJumps: number
}

export interface PlayerCommandStats {
  name: string
  /** One per {@link PHASE_MINUTES}. */
  phases: PhaseCommands[]
  /** How many different hotkey groups the player recalled. */
  groupsUsed: number
  /** Commands to cast each spell, keyed by the names in {@link SPELL_ORDERS}. */
  casts: Record<string, number>
  /**
   * The share of the player's commands that do something sent in bursts no hand could manage, the
   * way a macro program or bot plays, unless they sent too few to tell. See
   * {@link SCRIPTED_BURST_SHARE}.
   */
  burstShare?: number
  /** Commands that made something: units, morphs, research and upgrades. */
  productions: number
  /**
   * Times the player selected something, made something with it and selected what they had before
   * again, all on one frame, as a macro program does. See {@link MACRO_CYCLES}.
   */
  productionCycles: number
}

/** Whether a program made things for the player between their own commands. */
export function isMacroAssisted(
  player: Pick<PlayerCommandStats, 'productions' | 'productionCycles'>,
) {
  return (
    player.productionCycles >= MACRO_CYCLES &&
    player.productionCycles >= player.productions * MACRO_CYCLE_SHARE
  )
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
    hotkeyJumps: 0,
  }
}

function phaseIndex(ms: number) {
  return PHASE_MINUTES.findIndex(([start, end]) => ms >= start * 60_000 && ms < end * 60_000)
}

/**
 * How many frames a network turn lasts in a game, from the frames the players' commands ran on:
 * the shortest gap between them that's common, since no command runs between turns.
 */
export function estimateTurnFrames(frames: Iterable<number>): number {
  const sorted = Array.from(new Set(frames)).sort((a, b) => a - b)
  const gaps = new Map<number, number>()
  let total = 0
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1]
    if (gap <= MAX_TURN_FRAMES) {
      gaps.set(gap, (gaps.get(gap) ?? 0) + 1)
      total += 1
    }
  }
  const common = Array.from(gaps).flatMap(([gap, count]) =>
    count >= total * TURN_GAP_SHARE ? [gap] : [],
  )
  return common.length ? Math.min(...common) : 1
}

/** Counts a player's commands that did something, by the frame they ran on, to find bursts. */
export class BurstCounter {
  /** Commands that did something, by the frame they ran on. */
  readonly byFrame = new Map<number, number>()
  /** The frame of a selection no order has followed yet. */
  private selectedAt: number | undefined

  /** Takes the player's next action, one that counts toward APM. */
  add(frame: number, command: CommandData) {
    // A selection only does something once an order follows it, so one replaced by another first,
    // like a hotkey pressed over and over, isn't counted toward bursts.
    if (
      SELECTION_KINDS.has(command.type) ||
      (command.type === 'hotkey' && command.hotkeyType === HOTKEY_RECALL)
    ) {
      this.selectedAt = frame
      return
    }
    if (this.selectedAt !== undefined) {
      this.count(this.selectedAt)
      this.selectedAt = undefined
    }
    this.count(frame)
  }

  private count(frame: number) {
    this.byFrame.set(frame, (this.byFrame.get(frame) ?? 0) + 1)
  }

  /** Whether the commands on a frame were a burst no hand could manage. */
  isBurst(frame: number, turnFrames: number) {
    return (this.byFrame.get(frame) ?? 0) >= BURST_COMMANDS_PER_TURN_FRAME * turnFrames
  }

  /**
   * The share of the player's commands sent in frames with a burst of them, unless there are too
   * few to tell.
   */
  share(turnFrames: number) {
    let total = 0
    let inBursts = 0
    for (const [frame, sent] of this.byFrame) {
      total += sent
      if (this.isBurst(frame, turnFrames)) {
        inBursts += sent
      }
    }
    return total >= MIN_BURST_COMMANDS ? inBursts / total : undefined
  }
}

/**
 * Finds a player making something by selecting it and selecting what they had before again, all on
 * one frame. See {@link MACRO_CYCLES}.
 */
export class ProductionCycleFinder {
  /** Commands that made something. */
  productions = 0
  /** What the player selected last, as a key that's the same for the same selection. */
  private selection: { key: string; frame: number; index: number } | undefined
  private previousSelection: string | undefined
  /** Something just made, until another command shows whether it was a cycle. */
  private made:
    | { frame: number; selectedAt: number; selected: string; before?: string; indices: number[] }
    | undefined
  private lastCycleFrame: number | undefined

  /**
   * Takes the player's next action, one that counts toward APM, with `index` saying where it is.
   * Returns the indices of the actions in a cycle this one finishes.
   */
  add(index: number, frame: number, command: CommandData): number[] | undefined {
    let selected: string | undefined
    if (command.type === 'select') {
      selected = `s${command.unitTags.toSorted((a, b) => a - b).join(',')}`
    } else if (command.type === 'hotkey' && command.hotkeyType === HOTKEY_RECALL) {
      selected = `h${command.group}`
    }
    if (selected !== undefined) {
      const made = this.made
      let cycle: number[] | undefined
      if (
        made &&
        made.frame === frame &&
        made.selectedAt === frame &&
        selected === made.before &&
        selected !== made.selected &&
        frame * FASTEST_MS_PER_FRAME >= OPENING_MS &&
        this.lastCycleFrame !== frame
      ) {
        this.lastCycleFrame = frame
        cycle = [...made.indices, index]
      }
      this.made = undefined
      this.previousSelection = this.selection?.key
      this.selection = { key: selected, frame, index }
      return cycle
    }
    if (PRODUCTION_KINDS.has(command.type)) {
      this.productions += 1
      const { selection } = this
      if (selection) {
        this.made = {
          frame,
          selectedAt: selection.frame,
          selected: selection.key,
          before: this.previousSelection,
          indices: [...(this.made?.indices ?? [selection.index]), index],
        }
      }
    } else if (command.type !== 'selectAdd' && command.type !== 'selectRemove') {
      this.made = undefined
    }
    return undefined
  }
}

/** How a player used hotkeys over the whole game, per minute they played. */
export interface HotkeyRates {
  recallsPerMin: number
  /** See {@link PhaseCommands.hotkeyJumps}. */
  jumpsPerMin: number
}

export function getHotkeyRates(player: PlayerCommandStats): HotkeyRates | undefined {
  let minutes = 0
  let recalls = 0
  let jumps = 0
  for (const phase of player.phases) {
    minutes += phase.minutes
    recalls += phase.hotkeyRecalls
    jumps += phase.hotkeyJumps
  }
  return minutes >= MIN_PHASE_MINUTES
    ? { recallsPerMin: recalls / minutes, jumpsPerMin: jumps / minutes }
    : undefined
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
          stats: {
            name: p.name,
            phases,
            groupsUsed: 0,
            casts: {},
            productions: 0,
            productionCycles: 0,
          } as PlayerCommandStats,
          groups: new Set<number>(),
          bursts: new BurstCounter(),
          cycles: new ProductionCycleFinder(),
          lastRecall: undefined as { group: number; frame: number; taps: number } | undefined,
          /** When the player last double tapped a hotkey, until it's known to be a jump. */
          doubleTappedAt: undefined as number | undefined,
        },
      ]
    }),
  )
  const phaseAt = (stats: PlayerCommandStats, frame: number) =>
    stats.phases[phaseIndex(frame * FASTEST_MS_PER_FRAME)]

  for (const [index, { frame, playerId, command }] of commands.entries()) {
    const entry = byId.get(playerId)
    const phase = entry && phaseAt(entry.stats, frame)
    if (!entry || !phase) {
      continue
    }
    const kind = command.type as CommandKind
    if (NOT_ACTIONS.has(kind)) {
      continue
    }
    phase.actions += 1
    entry.bursts.add(frame, command)
    if (entry.cycles.add(index, frame, command)) {
      entry.stats.productionCycles += 1
    }

    const last = entry.lastRecall
    const soon = last !== undefined && frame - last.frame <= DOUBLE_TAP_FRAMES
    const recalled =
      command.type === 'hotkey' && command.hotkeyType === HOTKEY_RECALL ? command.group : undefined
    const taps = soon && recalled === last.group ? last.taps + 1 : 1
    if (taps === 1 && entry.doubleTappedAt !== undefined) {
      // Another hotkey right away flips past the group rather than looking at it, like warming
      // up with "1 1 2 2".
      const jumpedIn =
        soon && command.type === 'hotkey' ? undefined : phaseAt(entry.stats, entry.doubleTappedAt)
      if (jumpedIn) {
        jumpedIn.hotkeyJumps += 1
      }
      entry.doubleTappedAt = undefined
    }
    entry.lastRecall = recalled === undefined ? undefined : { group: recalled, frame, taps }
    // Tapping on after the double tap centers the screen on the same group again.
    if (taps === 2) {
      entry.doubleTappedAt = frame
    }

    if (command.type === 'hotkey') {
      if (command.hotkeyType === HOTKEY_ASSIGN) {
        phase.hotkeyAssigns += 1
      } else if (command.hotkeyType === HOTKEY_RECALL) {
        phase.hotkeyRecalls += 1
        entry.groups.add(command.group)
      } else if (command.hotkeyType === HOTKEY_ADD) {
        phase.hotkeyAdds += 1
      }
    } else if (SELECTION_KINDS.has(kind)) {
      phase.selections += 1
    } else if (command.type === 'targetedOrder') {
      const spell = SPELL_ORDERS.get(command.order)
      if (spell) {
        entry.stats.casts[spell] = (entry.stats.casts[spell] ?? 0) + 1
      }
    }
  }

  const turnFrames = estimateTurnFrames(
    Array.from(byId.values()).flatMap(({ bursts }) => Array.from(bursts.byFrame.keys())),
  )
  return {
    version: COMMAND_STATS_VERSION,
    players: Array.from(byId.values(), ({ stats, groups, bursts, cycles }) => ({
      ...stats,
      groupsUsed: groups.size,
      burstShare: bursts.share(turnFrames),
      productions: cycles.productions,
    })),
  }
}

/** The hotkeys one player pressed, from a replay's commands. */
export interface PlayerHotkeyPresses {
  name: string
  /** Each press, oldest first, with kinds as in {@link HOTKEY_ASSIGN} and the rest. */
  presses: Array<[frame: number, kind: number, group: number]>
}

/**
 * The hotkeys each player pressed, for games whose stats were recorded without them. The commands
 * can't say what a group held: they only name units, not what type each is.
 */
export function readHotkeyPresses(
  players: ReadonlyArray<Pick<Player, 'networkId' | 'name' | 'playerType' | 'isObserver'>>,
  commands: ReadonlyArray<ReplayCommand>,
): PlayerHotkeyPresses[] {
  const byId = new Map(
    players
      .filter(p => p.playerType === 'human' && !p.isObserver)
      .map(p => [p.networkId, { name: p.name, presses: [] } as PlayerHotkeyPresses]),
  )
  for (const { frame, playerId, command } of commands) {
    const player = byId.get(playerId)
    if (player && command.type === 'hotkey') {
      player.presses.push([frame, command.hotkeyType, command.group])
    }
  }
  return Array.from(byId.values())
}

/** Commands that aren't the player acting in the game, which APM leaves out. */
export const NOT_ACTIONS: ReadonlySet<CommandKind> = new Set<CommandKind>([
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
