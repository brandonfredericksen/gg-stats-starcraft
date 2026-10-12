import type { CommandData, ReplayCommand } from '@shieldbattery/broodrep'
import { describe, expect, test } from 'vitest'
import { getHotkeyRates, SCRIPTED_BURST_SHARE, summarizeCommands } from './command-stats'

/** Frames in a minute of game time on Fastest. */
const MINUTE = 60_000 / 42

function at(minutes: number, playerId: number, command: CommandData): ReplayCommand {
  return { frame: Math.round(minutes * MINUTE), playerId, command }
}

const select = (tag: number): CommandData => ({ type: 'select', unitTags: [tag] })
const train = (unitType: number): CommandData => ({ type: 'train', unitType })
const recall = (group: number): CommandData => ({ type: 'hotkey', hotkeyType: 1, group })
const move = (x: number): CommandData => ({
  type: 'rightClick',
  x,
  y: 0,
  targetUnitTag: 0,
  targetUnitType: 0,
  queued: false,
})

/**
 * A game where both players act on frames `turnFrames` apart, as a network turn that long runs
 * them, with `burst` giving player 0's commands on some of those frames.
 */
function turnsGame(turnFrames: number, burst: (turn: number) => CommandData[] | undefined) {
  const commands: ReplayCommand[] = []
  for (let turn = 0; turn < 600; turn++) {
    const frame = 100 + turn * turnFrames
    const player = turn % 2
    const sent = player === 0 ? (burst(turn) ?? [move(turn)]) : [move(1000 + turn)]
    commands.push(...sent.map(command => ({ frame, playerId: player, command })))
  }
  return summarizeCommands(players, commands, Math.round(20 * MINUTE))
}

const players = [
  { networkId: 0, name: 'Bisu', playerType: 'human' as const, isObserver: false },
  { networkId: 1, name: 'Stork', playerType: 'human' as const, isObserver: false },
  { networkId: 255, name: 'Computer', playerType: 'computer' as const, isObserver: false },
]

describe('common/games/command-stats', () => {
  test('counts hotkeys, selections and spells per phase', () => {
    const stats = summarizeCommands(
      players,
      [
        at(1, 0, { type: 'hotkey', hotkeyType: 0, group: 1 }),
        at(2, 0, { type: 'hotkey', hotkeyType: 1, group: 1 }),
        at(7, 0, { type: 'hotkey', hotkeyType: 1, group: 2 }),
        at(7, 0, { type: 'hotkey', hotkeyType: 1, group: 2 }),
        at(13, 0, { type: 'hotkey', hotkeyType: 2, group: 3 }),
        at(3, 0, { type: 'select', unitTags: [1] }),
        at(3, 0, { type: 'train', unitType: 65 }),
        at(3, 0, { type: 'chat', senderSlot: 0, message: 'gl hf' }),
        at(14, 0, {
          type: 'targetedOrder',
          x: 0,
          y: 0,
          targetUnitTag: 0,
          targetUnitType: 0,
          order: 0x8e,
          queued: false,
        }),
      ],
      Math.round(20 * MINUTE),
    )
    const [bisu, stork] = stats.players
    expect(stats.players).toHaveLength(2)
    expect(bisu.phases.map(p => p.hotkeyRecalls)).toEqual([1, 2, 0])
    expect(bisu.phases[0]).toMatchObject({
      hotkeyAssigns: 1,
      selections: 1,
      actions: 4,
    })
    expect(bisu.phases[2]).toMatchObject({ hotkeyAdds: 1, actions: 2 })
    expect(bisu.groupsUsed).toBe(2)
    expect(bisu.casts).toEqual({ psionicStorm: 1 })
    expect(bisu.phases.map(p => Math.round(p.minutes))).toEqual([6, 6, 8])
    expect(stork.phases[0].actions).toBe(0)
  })

  test('counts making things as actions', () => {
    const stats = summarizeCommands(
      players,
      [
        at(1, 0, { type: 'train', unitType: 65 }),
        at(1, 0, { type: 'unitMorph', unitType: 43 }),
        at(1, 0, { type: 'train', unitType: 64 }),
        at(1, 0, { type: 'unitMorph', unitType: 42 }),
        at(1, 0, { type: 'unitMorph', unitType: 103 }),
        at(1, 0, { type: 'build', order: 0, x: 0, y: 0, unitType: 160 }),
        at(1, 0, { type: 'buildingMorph', unitType: 132 }),
        at(1, 0, { type: 'trainFighter' }),
      ],
      Math.round(20 * MINUTE),
    )
    expect(stats.players[0].phases[0].actions).toBe(8)
  })

  describe('hotkey jumps', () => {
    const moveTo = (x: number, y: number): CommandData => ({
      type: 'rightClick',
      x,
      y,
      targetUnitTag: 0,
      targetUnitType: 0,
      queued: false,
    })
    function phaseOf(commands: Array<[frame: number, command: CommandData]>) {
      const stats = summarizeCommands(
        players,
        commands.map(([frame, command]) => ({ frame, playerId: 0, command })),
        Math.round(20 * MINUTE),
      )
      return stats.players[0].phases[0]
    }

    test('counts a double tapped hotkey once, however many taps follow', () => {
      expect(
        phaseOf([
          [100, recall(1)],
          [104, recall(1)],
          [108, recall(1)],
          [112, recall(1)],
          [130, moveTo(100, 100)],
        ]).hotkeyJumps,
      ).toBe(1)
    })

    test('leaves out a double tap flipped past right away', () => {
      expect(
        phaseOf([
          [100, recall(1)],
          [102, recall(1)],
          [104, recall(2)],
          [106, recall(2)],
          [108, recall(1)],
          [110, recall(1)],
          [112, { type: 'hotkey', hotkeyType: 0, group: 1 }],
          [114, recall(4)],
          [116, recall(4)],
          [140, recall(3)],
          [142, recall(3)],
          [150, moveTo(100, 100)],
        ]).hotkeyJumps,
      ).toBe(2)
    })

    test('needs the taps close together, of one group, with nothing in between', () => {
      expect(
        phaseOf([
          [100, recall(1)],
          [140, recall(1)],
          [200, recall(1)],
          [204, recall(2)],
          [300, recall(3)],
          [302, moveTo(100, 100)],
          [304, recall(3)],
        ]).hotkeyJumps,
      ).toBe(0)
    })
  })

  test('works out hotkey rates over the time a player was in the game', () => {
    const stats = summarizeCommands(
      players,
      [
        at(1, 1, { type: 'hotkey', hotkeyType: 1, group: 1 }),
        at(1, 1, { type: 'hotkey', hotkeyType: 1, group: 1 }),
        at(1.1, 1, { type: 'hotkey', hotkeyType: 1, group: 2 }),
        at(4, 1, { type: 'leaveGame', reason: 0 }),
      ],
      Math.round(20 * MINUTE),
    )
    const rates = getHotkeyRates(stats.players[1])
    expect(rates?.recallsPerMin).toBeCloseTo(0.75)
    expect(rates?.jumpsPerMin).toBeCloseTo(0.25)
  })

  test('only counts the time a player was in the game', () => {
    const stats = summarizeCommands(
      players,
      [at(4, 1, { type: 'leaveGame', reason: 0 })],
      Math.round(20 * MINUTE),
    )
    expect(stats.players[1].phases.map(p => Math.round(p.minutes))).toEqual([4, 0, 0])
  })

  test('finds no bursts in commands sent by hand', () => {
    const stats = turnsGame(1, turn => (turn % 10 === 0 ? [select(turn), train(65)] : undefined))
    expect(stats.players.map(p => p.burstShare)).toEqual([0, 0])
  })

  test('leaves bursts unmeasured for a player who sent too few commands to tell', () => {
    const stats = summarizeCommands(
      players,
      Array.from({ length: 20 }, (_, i) => ({
        frame: 10,
        playerId: 0,
        command: i % 2 ? train(65) : select(i),
      })),
      Math.round(20 * MINUTE),
    )
    expect(stats.players[0].burstShare).toBeUndefined()
  })

  test("counts a program's bursts of commands on one frame", () => {
    const stats = turnsGame(1, turn =>
      turn % 4 === 0 ? [select(turn), train(65), select(turn + 1), train(66)] : undefined,
    )
    const [program, person] = stats.players
    expect(program.burstShare).toBeGreaterThanOrEqual(SCRIPTED_BURST_SHARE)
    expect(person.burstShare).toBe(0)
  })

  test('leaves out selections replaced before any order, like hotkeys pressed over and over', () => {
    const spam = (turn: number) =>
      turn % 4 === 0
        ? [recall(4), recall(5), recall(4), recall(5), recall(4), move(turn)]
        : undefined
    expect(turnsGame(1, spam).players[0].burstShare).toBe(0)
  })

  test('allows for more commands on a frame when turns last longer', () => {
    const handFast = (turn: number) =>
      turn % 4 === 0 ? [select(turn), train(65), select(turn + 1), train(66)] : undefined
    expect(turnsGame(3, handFast).players[0].burstShare).toBe(0)

    const program = (turn: number) =>
      turn % 4 === 0
        ? Array.from({ length: 6 }, (_, i) => [select(turn * 10 + i), train(65)]).flat()
        : undefined
    expect(turnsGame(3, program).players[0].burstShare).toBeGreaterThanOrEqual(SCRIPTED_BURST_SHARE)
  })
})
