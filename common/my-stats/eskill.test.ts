import { describe, expect, test } from 'vitest'
import { LadderRank } from '../games/ladder'
import {
  CHECKPOINT_MINUTES,
  GAME_METRICS_VERSION,
  GameMetrics,
  GameShape,
  PlayerMetrics,
} from '../games/player-metrics'
import { AssignedRaceChar } from '../races'
import { fitESkillModel, getESkill } from './eskill'

function player(name: string, race: AssignedRaceChar, overrides: Partial<PlayerMetrics> = {}) {
  const empty = CHECKPOINT_MINUTES.map(() => null)
  const metrics: PlayerMetrics = {
    names: [name],
    race,
    team: 0,
    result: 'win',
    human: true,
    apm: 200,
    eapm: 150,
    workers: empty,
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
    ...overrides,
  }
  return metrics
}

let nextId = 0

function game(shape: GameShape, players: PlayerMetrics[], durationMs = 12 * 60_000): GameMetrics {
  nextId += 1
  return {
    version: GAME_METRICS_VERSION,
    gameId: `game-${nextId}`,
    durationMs,
    complete: true,
    mapName: 'Polypoid',
    mapFamily: 'standard',
    shape,
    players,
  }
}

const RANKS: LadderRank[] = ['e', 'd', 'c', 'b', 'a']

/**
 * Ladder players of every race whose EAPM goes up with their MMR and whose bank goes down, with a
 * little in each that doesn't, like real players.
 */
function ladderGames(count: number) {
  const games: GameMetrics[] = []
  for (let i = 0; i < count; i++) {
    const make = (n: number, race: AssignedRaceChar) => {
      const skill = (n * 37) % 100
      const wobble = ((n * 53) % 21) - 10
      return player(`ladder-${n}`, race, {
        eapm: 60 + skill * 2 + wobble,
        bank: [300 - skill * 2 + wobble, 600 - skill * 4, null],
        mmr: 1000 + skill * 14,
        rank: RANKS[Math.floor(skill / 20)],
      })
    }
    games.push(game('1v1', [make(i * 2, (['p', 't', 'z'] as const)[i % 3]), make(i * 2 + 1, 'z')]))
  }
  return games
}

describe('common/my-stats/eskill', () => {
  const games = ladderGames(900)
  const model = fitESkillModel(games)!

  test('scores faster players with smaller banks higher', () => {
    const slow = player('slow', 'p', { eapm: 80, bank: [280, 560, null] })
    const fast = player('fast', 'p', { eapm: 240, bank: [120, 250, null] })
    const slowSkill = getESkill(model, game('1v1', [slow, fast]), slow)!
    const fastSkill = getESkill(model, game('1v1', [slow, fast]), fast)!

    expect(fastSkill.value).toBeGreaterThan(slowSkill.value + 600)
    expect(fastSkill.parts.speed).toBeGreaterThan(85)
    expect(slowSkill.parts.speed).toBeLessThan(20)
    // No hotkeys without the replay's commands.
    expect(fastSkill.parts.hands).toBeUndefined()
    expect(RANKS.indexOf(fastSkill.rank!)).toBeGreaterThan(RANKS.indexOf(slowSkill.rank!))
  })

  test('stays within the MMRs of the players it was fit to', () => {
    const blazing = player('blazing', 't', { eapm: 900, bank: [0, 0, null] })
    const skill = getESkill(model, game('1v1', [blazing, player('other', 'z')]), blazing)!

    expect(skill.value).toBeLessThanOrEqual(1000 + 99 * 14)
    expect(skill.rank).toBe('a')
  })

  test('ranks team game players against the same kind of game', () => {
    const teamGames = Array.from({ length: 60 }, (_, i) =>
      game(
        '2v2',
        [0, 1, 2, 3].map(j =>
          player(`team-${i}-${j}`, 'z', { team: j % 2, eapm: 200 + ((i * 7 + j * 13) % 100) }),
        ),
      ),
    )
    const teamModel = fitESkillModel([...games, ...teamGames])!
    // Slow next to the 2v2 players, though as fast as a good 1v1 player.
    const slowForTeams = player('me', 'z', { eapm: 210 })
    const inTeamGame = game('2v2', [
      slowForTeams,
      ...[1, 2, 3].map(j => player(`x${j}`, 'z', { team: j % 2 })),
    ])
    const in1v1 = game('1v1', [slowForTeams, player('y', 'p')])

    expect(getESkill(teamModel, inTeamGame, slowForTeams)!.parts.speed).toBeLessThan(20)
    expect(getESkill(teamModel, in1v1, slowForTeams)!.parts.speed).toBeGreaterThan(60)
  })

  test("doesn't score games too short to tell, or against computers", () => {
    const me = player('me', 'p')
    expect(getESkill(model, game('1v1', [me, player('y', 'z')], 5 * 60_000), me)).toBeUndefined()
    expect(
      getESkill(model, game('1v1', [me, player('cpu', 'z', { human: false })]), me),
    ).toBeUndefined()
  })

  test('needs ranked players to fit', () => {
    expect(fitESkillModel([game('1v1', [player('a', 'p'), player('b', 'z')])])).toBeUndefined()
  })
})
