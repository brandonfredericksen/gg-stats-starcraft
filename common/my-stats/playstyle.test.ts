import { describe, expect, test } from 'vitest'
import { CHECKPOINT_MINUTES, PlayerMetrics } from '../games/player-metrics'
import {
  BuildPopulation,
  emptyPlaystyleCounts,
  getGamePlaystyle,
  getPopulationKey,
  mergeBuildPopulations,
  MIN_POPULATION_GAMES,
  StyledGame,
  summarizePlaystyle,
} from './playstyle'

const empty = CHECKPOINT_MINUTES.map(() => null)

/** A Protoss 1v1 game with this build, and static defense started at these minutes. */
function game(family: string, defenseMinutes: number[] = [], shape: StyledGame['shape'] = '1v1') {
  const player: PlayerMetrics = {
    names: ['p'],
    race: 'p',
    team: 0,
    result: 'win',
    human: true,
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
    buildSteps: defenseMinutes.map(minutes => ({ key: 'u162', timeMs: minutes * 60_000 })),
  }
  return { family, shape, race: 'p' as const, player }
}

/** Protoss 1v1 games: plenty of 1 Gate expands, a couple of odd builds. */
const population: BuildPopulation = new Map([
  [
    getPopulationKey('1v1', undefined, 'p'),
    {
      games: 100,
      families: new Map([
        ['p gates1 expand u155 reaver', 60],
        ['p gates1 u163 dt', 2],
      ]),
    },
  ],
])

describe('common/my-stats/playstyle', () => {
  test('calls rushes and all-ins cheese, however common', () => {
    expect(getGamePlaystyle(game('p gates2 allIn'), population)).toBe('cheese')
    expect(getGamePlaystyle(game('p forgeCannons'), population)).toBe('cheese')
    // In team games, few workers is how money maps play.
    expect(getGamePlaystyle(game('p gates2 allIn', [], '3v3'), population)).not.toBe('cheese')
    expect(getGamePlaystyle(game('p bbs', [], '3v3'), population)).toBe('cheese')
    // At home in team games, Cannons first are defense, not a rush.
    expect(getGamePlaystyle(game('p forgeCannons', [], '3v3'), population)).not.toBe('cheese')
  })

  test('counts static defense by 6 minutes, more of it in team games', () => {
    expect(getGamePlaystyle(game('p forgeExpand', [2, 3, 4]), population)).toBe('staticDefense')
    expect(getGamePlaystyle(game('p forgeExpand', [2, 3, 7]), population)).not.toBe('staticDefense')
    expect(getGamePlaystyle(game('p forgeExpand', [2, 3, 4], '3v3'), population)).not.toBe(
      'staticDefense',
    )
  })

  test('calls common builds standard, and names what an uncommon one went for', () => {
    expect(getGamePlaystyle(game('p gates1 expand u155 reaver'), population)).toBe('standard')
    expect(getGamePlaystyle(game('p gates1 u163 dt'), population)).toBe('tech')
    expect(getGamePlaystyle(game('p nexusFirst'), population)).toBe('greedy')
    expect(getGamePlaystyle(game('p gates3'), population)).toBe('offMeta')
  })

  test('without enough games to compare to, only cheese and defense stand out', () => {
    const few: BuildPopulation = new Map([
      [
        getPopulationKey('1v1', undefined, 'p'),
        { games: MIN_POPULATION_GAMES - 1, families: new Map() },
      ],
    ])
    expect(getGamePlaystyle(game('p gates1 u163 dt'), few)).toBe('standard')
    expect(getGamePlaystyle(game('p gates3'))).toBe('standard')
    expect(getGamePlaystyle(game('p gates2 allIn'))).toBe('cheese')
  })

  test('sums up a player, cheese and defense first when they happen often', () => {
    const counts = { ...emptyPlaystyleCounts(), standard: 7, cheese: 3 }
    expect(summarizePlaystyle(counts)?.style).toBe('cheese')
    expect(summarizePlaystyle({ ...counts, cheese: 1 })?.style).toBe('standard')
    // One rush in a few games isn't a habit.
    expect(summarizePlaystyle({ ...emptyPlaystyleCounts(), standard: 2, cheese: 1 })?.style).toBe(
      'standard',
    )
    expect(summarizePlaystyle({ ...emptyPlaystyleCounts(), standard: 2, tech: 2 })?.style).toBe(
      'standard',
    )
    expect(summarizePlaystyle({ ...emptyPlaystyleCounts(), tech: 2 })).toBeUndefined()
  })

  test('adds counts together', () => {
    const merged = mergeBuildPopulations(population, population)
    const counted = merged.get(getPopulationKey('1v1', undefined, 'p'))
    expect(counted?.games).toBe(200)
    expect(counted?.families.get('p gates1 u163 dt')).toBe(4)
  })
})
