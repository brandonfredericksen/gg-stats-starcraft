import type { CommandData, CommandKind, Player, ReplayCommand } from '@shieldbattery/broodrep'
import { RaceChar } from '../races'
import {
  DOUBLE_TAP_FRAMES,
  estimateTurnFrames,
  HOTKEY_ADD,
  HOTKEY_ASSIGN,
  HOTKEY_RECALL,
  NOT_ACTIONS,
  SELECTION_KINDS,
  SPELL_ORDERS,
} from './command-stats'
import { FASTEST_MS_PER_FRAME } from './game-stats'

/**
 * The version of {@link fingerprintReplay}'s features. Fingerprints of another version are worked
 * out again from their replays, and a model of another version can't score them.
 */
export const FINGERPRINT_VERSION = 1

/**
 * Fewer actions than this say too little about how someone plays, like a game left in the first
 * minutes.
 */
export const MIN_FINGERPRINT_ACTIONS = 200

/** How long the opening lasts: splitting workers and the first few orders, done by habit. */
const OPENING_FRAMES = Math.round(20_000 / FASTEST_MS_PER_FRAME)

/** Gaps longer than this are the player waiting or thinking, not their rhythm. */
const MAX_RHYTHM_GAP_MS = 5_000

/** The phases tempo is measured in, as [start, end) minutes. */
const TEMPO_PHASES: ReadonlyArray<readonly [number, number]> = [
  [0, 4],
  [4, 10],
  [10, Infinity],
]

/**
 * Gaps between a player's actions, in network turns, a bin for each range. A turn runs everything
 * sent during it on one frame, so turns rather than frames keep the rhythm the same at every latency.
 */
const GAP_TURN_BINS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 5],
  [6, 8],
  [9, 15],
  [16, 30],
  [31, Infinity],
]

/** BW's order ids for the orders players give most. */
const ORDER_MOVE = 0x06
const ORDER_ATTACK_UNIT = 0x0a
const ORDER_ATTACK_MOVE = 0x0e
const ORDER_PATROL = 0x98

/** What kind of thing an action does, for which follows which. */
const enum ActionClass {
  Select,
  Recall,
  Assign,
  RightClick,
  Order,
  Spell,
  Build,
  Produce,
  StopHold,
  Other,
}
const CLASS_COUNT = 10

const PRODUCE_KINDS: ReadonlySet<CommandKind> = new Set<CommandKind>([
  'train',
  'unitMorph',
  'buildingMorph',
  'trainFighter',
])

function classify(command: CommandData): ActionClass {
  const kind = command.type as CommandKind
  if (SELECTION_KINDS.has(kind)) {
    return ActionClass.Select
  }
  switch (command.type) {
    case 'hotkey':
      return command.hotkeyType === HOTKEY_RECALL ? ActionClass.Recall : ActionClass.Assign
    case 'rightClick':
      return ActionClass.RightClick
    case 'targetedOrder':
      return SPELL_ORDERS.has(command.order) ? ActionClass.Spell : ActionClass.Order
    case 'build':
      return ActionClass.Build
    case 'stop':
    case 'holdPosition':
      return ActionClass.StopHold
    default:
      return PRODUCE_KINDS.has(kind) ? ActionClass.Produce : ActionClass.Other
  }
}

interface Action {
  frame: number
  cls: ActionClass
  command: CommandData
}

/** How one player played one game: numbers that stay much the same from game to game for them. */
export interface GameFingerprint {
  name: string
  race: RaceChar
  /** One number per feature, NaN where the game didn't show it (like hotkeys never used). */
  features: number[]
  actions: number
}

function share(part: number, whole: number) {
  return whole > 0 ? part / whole : NaN
}

function median(values: number[]) {
  return quantile(values, 0.5)
}

function quantile(values: number[], q: number) {
  if (!values.length) {
    return NaN
  }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (sorted.length - 1) * q
  const low = Math.floor(at)
  const high = Math.ceil(at)
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low)
}

/** The same action twice in a row, which does nothing the second time. */
function sameAction(a: CommandData, b: CommandData) {
  if (a.type !== b.type) {
    return false
  }
  if (a.type === 'hotkey') {
    const other = b as typeof a
    return a.hotkeyType === other.hotkeyType && a.group === other.group
  }
  if (a.type === 'select' || a.type === 'selectAdd' || a.type === 'selectRemove') {
    const tags = (b as typeof a).unitTags
    return a.unitTags.length === tags.length && a.unitTags.every((tag, i) => tag === tags[i])
  }
  return a.type === 'stop' || a.type === 'holdPosition'
}

/** The features of one player's actions, in order, each with a name to tell them apart by. */
function getFeatures(actions: ReadonlyArray<Action>, playedFrames: number, turnFrames: number) {
  const out: Array<[string, number]> = []
  const add = (name: string, value: number) => out.push([name, value])
  const playedMinutes = (playedFrames * FASTEST_MS_PER_FRAME) / 60_000

  // Hotkeys: which groups, what for, and how the player moves between them.
  const recalls = new Array<number>(10).fill(0)
  const assigns = new Array<number>(10).fill(0)
  const adds = new Array<number>(10).fill(0)
  const firstAssigns = new Array<number>(10).fill(0)
  let firstAssignCount = 0
  const recallSequence: number[] = []
  const doubleTapGaps: number[] = []
  let doubleTaps = 0
  let tripleTaps = 0
  const assignedAt = new Map<number, number>()
  const assignToRecall: number[] = []
  let lastRecall: { group: number; frame: number; taps: number } | undefined
  for (const { frame, command } of actions) {
    if (command.type !== 'hotkey' || command.group > 9) {
      if (command.type !== 'hotkey') {
        lastRecall = undefined
      }
      continue
    }
    const group = command.group
    if (command.hotkeyType === HOTKEY_ASSIGN) {
      assigns[group] += 1
      if (firstAssignCount < 5) {
        firstAssigns[group] += 1
        firstAssignCount += 1
      }
      assignedAt.set(group, frame)
      lastRecall = undefined
    } else if (command.hotkeyType === HOTKEY_ADD) {
      adds[group] += 1
      lastRecall = undefined
    } else if (command.hotkeyType === HOTKEY_RECALL) {
      recalls[group] += 1
      recallSequence.push(group)
      const at = assignedAt.get(group)
      if (at !== undefined) {
        assignToRecall.push(Math.log1p(((frame - at) * FASTEST_MS_PER_FRAME) / 1000))
        assignedAt.delete(group)
      }
      const tapped =
        lastRecall && lastRecall.group === group && frame - lastRecall.frame <= DOUBLE_TAP_FRAMES
      if (tapped) {
        const taps = lastRecall!.taps + 1
        if (taps === 2) {
          doubleTaps += 1
          doubleTapGaps.push(frame - lastRecall!.frame)
        } else if (taps === 3) {
          tripleTaps += 1
        }
        lastRecall = { group, frame, taps }
      } else {
        lastRecall = { group, frame, taps: 1 }
      }
    }
  }
  const totalRecalls = recalls.reduce((a, b) => a + b, 0)
  const totalAssigns = assigns.reduce((a, b) => a + b, 0)
  const totalAdds = adds.reduce((a, b) => a + b, 0)
  for (let g = 0; g < 10; g++) {
    add(`recall${g}`, share(recalls[g], totalRecalls))
  }
  for (let g = 0; g < 10; g++) {
    add(`assign${g}`, share(assigns[g], totalAssigns))
  }
  for (let g = 0; g < 10; g++) {
    add(`add${g}`, share(adds[g], totalAdds))
  }
  for (let g = 0; g < 10; g++) {
    add(`firstAssign${g}`, share(firstAssigns[g], firstAssignCount))
  }
  add('groupsRecalled', recalls.filter(n => n > 0).length / 10)
  add('groupsAssigned', assigns.filter(n => n > 0).length / 10)
  add('recallShare', share(totalRecalls, actions.length))
  add('assignShare', share(totalAssigns, actions.length))
  add('addShare', share(totalAdds, actions.length))
  add('recallsPerAssign', Math.log1p(share(totalRecalls, totalAssigns + totalAdds)))
  add('doubleTapShare', share(doubleTaps, totalRecalls))
  add('tripleTapShare', share(tripleTaps, doubleTaps))
  add('doubleTapGap', median(doubleTapGaps) / turnFrames)
  add('assignToRecall', median(assignToRecall))

  const groupMoves = new Array<number>(100).fill(0)
  let same = 0
  let next = 0
  let prev = 0
  for (let i = 1; i < recallSequence.length; i++) {
    const from = recallSequence[i - 1]
    const to = recallSequence[i]
    groupMoves[from * 10 + to] += 1
    if (to === from) {
      same += 1
    } else if (to === (from + 1) % 10) {
      next += 1
    } else if (to === (from + 9) % 10) {
      prev += 1
    }
  }
  const moves = Math.max(0, recallSequence.length - 1)
  add('recallSame', share(same, moves))
  add('recallNext', share(next, moves))
  add('recallPrev', share(prev, moves))
  for (let i = 0; i < 100; i++) {
    add(`recall${Math.floor(i / 10)}to${i % 10}`, share(groupMoves[i], moves))
  }

  // What the player does, and what they do after each thing.
  const classes = new Array<number>(CLASS_COUNT).fill(0)
  const pairs = new Array<number>(CLASS_COUNT * CLASS_COUNT).fill(0)
  for (let i = 0; i < actions.length; i++) {
    classes[actions[i].cls] += 1
    if (i > 0) {
      pairs[actions[i - 1].cls * CLASS_COUNT + actions[i].cls] += 1
    }
  }
  for (let c = 0; c < CLASS_COUNT; c++) {
    add(`class${c}`, share(classes[c], actions.length))
  }
  for (let i = 0; i < pairs.length; i++) {
    add(
      `class${Math.floor(i / CLASS_COUNT)}to${i % CLASS_COUNT}`,
      share(pairs[i], actions.length - 1),
    )
  }

  // Rhythm: the gaps between actions, and how they bunch up.
  const gapBins = new Array<number>(GAP_TURN_BINS.length).fill(0)
  const gapsMs: number[] = []
  const afterRecall: number[] = []
  const selectToOrder: number[] = []
  let runs = 0
  let runLengths = 0
  let longRuns = 0
  let run = 1
  let redundant = 0
  let selectedAt: number | undefined
  for (let i = 1; i <= actions.length; i++) {
    const action = actions[i]
    const before = actions[i - 1]
    if (!action || action.frame !== before.frame) {
      runs += 1
      runLengths += run
      longRuns += run >= 3 ? 1 : 0
      run = 1
    } else {
      run += 1
    }
    if (!action) {
      break
    }
    const gapFrames = action.frame - before.frame
    const turns = Math.round(gapFrames / turnFrames)
    const bin = GAP_TURN_BINS.findIndex(([low, high]) => turns >= low && turns <= high)
    gapBins[bin] += 1
    const gapMs = gapFrames * FASTEST_MS_PER_FRAME
    if (gapFrames > 0 && gapMs <= MAX_RHYTHM_GAP_MS) {
      gapsMs.push(Math.log(gapMs))
      if (before.cls === ActionClass.Recall) {
        afterRecall.push(Math.log(gapMs))
      }
    }
    if (sameAction(before.command, action.command)) {
      redundant += 1
    }
    if (action.cls === ActionClass.Select || action.cls === ActionClass.Recall) {
      selectedAt ??= action.frame
    } else if (selectedAt !== undefined) {
      const ms = (action.frame - selectedAt) * FASTEST_MS_PER_FRAME
      if (ms <= MAX_RHYTHM_GAP_MS) {
        selectToOrder.push(Math.log1p(ms))
      }
      selectedAt = undefined
    }
  }
  for (let i = 0; i < gapBins.length; i++) {
    add(`gapTurns${i}`, share(gapBins[i], actions.length - 1))
  }
  for (const q of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    add(`gapQ${q * 100}`, quantile(gapsMs, q))
  }
  add('afterRecallGap', median(afterRecall))
  add('selectToOrder', median(selectToOrder))
  add('runLength', share(runLengths, runs))
  add('longRunShare', share(longRuns, runs))
  add('redundancy', share(redundant, actions.length - 1))

  // Selecting units and ordering them.
  const selectSizes: number[] = []
  let selectAdds = 0
  let selectRemoves = 0
  let rightClicks = 0
  let rightClicksOnUnits = 0
  let rightClicksQueued = 0
  let orders = 0
  let ordersQueued = 0
  const orderKinds = { move: 0, attackMove: 0, attackUnit: 0, patrol: 0 }
  let stops = 0
  let holds = 0
  let pings = 0
  for (const { command } of actions) {
    switch (command.type) {
      case 'select':
        selectSizes.push(command.unitTags.length)
        break
      case 'selectAdd':
        selectAdds += 1
        break
      case 'selectRemove':
        selectRemoves += 1
        break
      case 'rightClick':
        rightClicks += 1
        rightClicksOnUnits += command.targetUnitTag > 0 && command.targetUnitTag < 0xffff ? 1 : 0
        rightClicksQueued += command.queued ? 1 : 0
        break
      case 'targetedOrder':
        if (!SPELL_ORDERS.has(command.order)) {
          orders += 1
          ordersQueued += command.queued ? 1 : 0
          if (command.order === ORDER_MOVE) {
            orderKinds.move += 1
          } else if (command.order === ORDER_ATTACK_MOVE) {
            orderKinds.attackMove += 1
          } else if (command.order === ORDER_ATTACK_UNIT) {
            orderKinds.attackUnit += 1
          } else if (command.order === ORDER_PATROL) {
            orderKinds.patrol += 1
          }
        }
        break
      case 'stop':
        stops += 1
        break
      case 'holdPosition':
        holds += 1
        break
      case 'minimapPing':
        pings += 1
        break
    }
  }
  const selections = selectSizes.length + selectAdds + selectRemoves
  add('selectSize', selectSizes.length ? Math.log1p(median(selectSizes)) : NaN)
  add('selectSizeMean', selectSizes.length ? Math.log1p(quantile(selectSizes, 0.75)) : NaN)
  add('singleSelects', share(selectSizes.filter(n => n === 1).length, selectSizes.length))
  add('fullSelects', share(selectSizes.filter(n => n >= 12).length, selectSizes.length))
  add('selectAddShare', share(selectAdds, selections))
  add('selectRemoveShare', share(selectRemoves, selections))
  add('rightClickShare', share(rightClicks, rightClicks + orders))
  add('rightClickOnUnits', share(rightClicksOnUnits, rightClicks))
  add('rightClickQueued', share(rightClicksQueued, rightClicks))
  add('orderQueued', share(ordersQueued, orders))
  add('orderMove', share(orderKinds.move, orders))
  add('orderAttackMove', share(orderKinds.attackMove, orders))
  add('orderAttackUnit', share(orderKinds.attackUnit, orders))
  add('orderPatrol', share(orderKinds.patrol, orders))
  add('stopShare', share(stops, actions.length))
  add('holdShare', share(holds, actions.length))
  add('pingShare', share(pings, actions.length))

  // Tempo, overall and by phase.
  const apm = share(actions.length, playedMinutes)
  add('apm', Math.log1p(apm))
  for (const [start, end] of TEMPO_PHASES) {
    const startFrame = (start * 60_000) / FASTEST_MS_PER_FRAME
    const endFrame = Math.min(playedFrames, (end * 60_000) / FASTEST_MS_PER_FRAME)
    const minutes = ((endFrame - startFrame) * FASTEST_MS_PER_FRAME) / 60_000
    const count = actions.filter(a => a.frame >= startFrame && a.frame < endFrame).length
    add(`apmPhase${start}`, minutes >= 1 ? share(count / minutes, apm) : NaN)
  }

  // The opening, played the same way every game.
  const opening = actions.filter(a => a.frame < OPENING_FRAMES)
  add('openingActions', Math.log1p(opening.length))
  add(
    'openingSelects',
    share(opening.filter(a => a.cls === ActionClass.Select).length, opening.length),
  )
  add(
    'openingHotkeys',
    share(
      opening.filter(a => a.cls === ActionClass.Recall || a.cls === ActionClass.Assign).length,
      opening.length,
    ),
  )
  const firstAssign = actions.find(a => a.cls === ActionClass.Assign)
  add(
    'firstAssignAt',
    firstAssign ? Math.log1p((firstAssign.frame * FASTEST_MS_PER_FRAME) / 1000) : NaN,
  )
  const firstProduce = actions.find(a => a.cls === ActionClass.Produce)
  add(
    'firstProduceAt',
    firstProduce ? Math.log1p((firstProduce.frame * FASTEST_MS_PER_FRAME) / 1000) : NaN,
  )

  return out
}

/** The name of each feature, in the order {@link GameFingerprint.features} lists them. */
export const FINGERPRINT_FEATURES: ReadonlyArray<string> = getFeatures([], 1, 1).map(([n]) => n)

/**
 * How each human player in a replay played, from its commands. Players who did too little to tell,
 * like leaving in the first minutes, are left out.
 */
export function fingerprintReplay(
  players: ReadonlyArray<Pick<Player, 'networkId' | 'name' | 'race' | 'playerType' | 'isObserver'>>,
  commands: ReadonlyArray<ReplayCommand>,
  frames: number,
): GameFingerprint[] {
  const humans = players.filter(p => p.playerType === 'human' && !p.isObserver)
  const actionsById = new Map(humans.map(p => [p.networkId, [] as Action[]]))
  const leftAt = new Map<number, number>()
  for (const { frame, playerId, command } of commands) {
    if (command.type === 'leaveGame') {
      if (!leftAt.has(playerId)) {
        leftAt.set(playerId, frame)
      }
      continue
    }
    const actions = actionsById.get(playerId)
    if (!actions || leftAt.has(playerId) || NOT_ACTIONS.has(command.type as CommandKind)) {
      continue
    }
    actions.push({ frame, cls: classify(command), command })
  }
  const turnFrames = estimateTurnFrames(
    Array.from(actionsById.values(), actions => actions.map(a => a.frame)).flat(),
  )

  return humans.flatMap(player => {
    const actions = actionsById.get(player.networkId)!
    if (actions.length < MIN_FINGERPRINT_ACTIONS) {
      return []
    }
    const playedFrames = leftAt.get(player.networkId) ?? frames
    return [
      {
        name: player.name,
        race: player.race,
        features: getFeatures(actions, playedFrames, turnFrames).map(([, value]) => value),
        actions: actions.length,
      },
    ]
  })
}
