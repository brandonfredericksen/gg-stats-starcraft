import { MapFamily } from '../games/map-family'
import { GameShape, PlayerMetrics } from '../games/player-metrics'
import { AssignedRaceChar } from '../races'
import { getBuildFamily } from './build-family'
import { DatedGameMetrics } from './my-stats'
import { isTeamGame, splitsByMap } from './player-games'

/**
 * How someone tends to play, from the builds they went with:
 *
 * - `cheese`: rushes and all-ins, like a BBS, a 4 pool, a cannon rush, or few workers at 6 minutes
 * - `staticDefense`: plenty of Cannons, Bunkers, Turrets or Colonies early
 * - `standard`: builds plenty of other players go with too
 * - `tech`: an uncommon build heading for tech early, like Dark Templar or 1 base Mutalisks
 * - `greedy`: an uncommon build that expands early, like a Nexus first or a 3 hatch
 * - `offMeta`: an uncommon build that's none of those
 */
export type Playstyle = 'standard' | 'cheese' | 'staticDefense' | 'tech' | 'greedy' | 'offMeta'

export const PLAYSTYLES: ReadonlyArray<Playstyle> = [
  'standard',
  'cheese',
  'staticDefense',
  'tech',
  'greedy',
  'offMeta',
]

/** A build at least this share of a race's games, in the same kind of game, is a standard one. */
export const STANDARD_SHARE = 0.03
/** Fewer games than this of a race, in a kind of game, can't say which builds are standard. */
export const MIN_POPULATION_GAMES = 40
/**
 * Someone who cheesed in this share of their games, and at least this many, is a cheeser, whatever
 * else they do. One rush in a handful of games isn't a habit.
 */
const CHEESE_SHARE = 0.2
const MIN_CHEESE_GAMES = 2
/** And someone with this share of games heavy on static defense plays that way. */
const STATIC_DEFENSE_SHARE = 0.4
/** The fewest games with a build that can say how someone plays. */
export const MIN_STYLE_GAMES = 3

/** Static defense counted from the first 6 minutes, see `buildSteps`. */
const STATIC_DEFENSE: ReadonlySet<string> = new Set(['u162', 'u125', 'u124', 'u146', 'u144'])
const STATIC_DEFENSE_BY_MS = 6 * 60_000
/** This many static defenses by 6 minutes is heavy on it, more in team games. */
const STATIC_DEFENSE_COUNT = 3
const TEAM_STATIC_DEFENSE_COUNT = 4

const CHEESE_PARTS: ReadonlySet<string> = new Set(['bbs', 'pool4', 'allIn'])
/**
 * In team games, few workers is how a 2 Gate or a pool first plays on money maps, so only the
 * rushes count as cheese.
 */
const TEAM_CHEESE_PARTS: ReadonlySet<string> = new Set(['bbs', 'pool4'])
const TECH_PARTS: ReadonlySet<string> = new Set([
  'dt',
  'reaver',
  'carrier',
  'arbiter',
  'muta1',
  'lurker',
  'twoPort',
  'oneOneOne',
  'wraith',
  'valkyrie',
])
const GREEDY_PARTS: ReadonlySet<string> = new Set(['nexusFirst', 'ccFirst', 'hatch3', 'factDouble'])

/** How often each build was played, by {@link getPopulationKey}. */
export type BuildPopulation = ReadonlyMap<
  string,
  { games: number; families: ReadonlyMap<string, number> }
>

/** The kind of game and race whose builds are counted together. */
export function getPopulationKey(
  shape: GameShape,
  mapFamily: MapFamily | undefined,
  race: AssignedRaceChar,
) {
  return [shape, splitsByMap(shape) ? mapFamily : undefined, race].join(' ')
}

/** How long a player played, which says whether their build had time to show. */
function getPlayedMs(game: DatedGameMetrics, player: PlayerMetrics) {
  return Math.min(player.leftAtMs ?? game.durationMs, game.durationMs)
}

/** Counts every build in `games`, games with a computer in them left out. */
export function countBuildPopulation(games: ReadonlyArray<DatedGameMetrics>): BuildPopulation {
  const population = new Map<string, { games: number; families: Map<string, number> }>()
  for (const game of games) {
    if (game.players.some(p => !p.human)) {
      continue
    }
    for (const player of game.players) {
      if (!player.race) {
        continue
      }
      const family = getBuildFamily(player, {
        shape: game.shape,
        playedMs: getPlayedMs(game, player),
      })
      if (!family) {
        continue
      }
      const key = getPopulationKey(game.shape, game.mapFamily, player.race)
      let entry = population.get(key)
      if (!entry) {
        entry = { games: 0, families: new Map() }
        population.set(key, entry)
      }
      entry.games += 1
      entry.families.set(family, (entry.families.get(family) ?? 0) + 1)
    }
  }
  return population
}

/** Two counts of the same builds added together, like the user's games and the ladder's. */
export function mergeBuildPopulations(...populations: BuildPopulation[]): BuildPopulation {
  const merged = new Map<string, { games: number; families: Map<string, number> }>()
  for (const population of populations) {
    for (const [key, { games, families }] of population) {
      let entry = merged.get(key)
      if (!entry) {
        entry = { games: 0, families: new Map() }
        merged.set(key, entry)
      }
      entry.games += games
      for (const [family, count] of families) {
        entry.families.set(family, (entry.families.get(family) ?? 0) + count)
      }
    }
  }
  return merged
}

/** One game's build, for telling how someone played it. */
export interface StyledGame {
  family: string
  shape: GameShape
  mapFamily?: MapFamily
  race: AssignedRaceChar
  player: PlayerMetrics
}

/**
 * How one game was played. Cheese and static defense say so whether or not plenty of others do the
 * same. Without enough games to tell which builds are standard, the rest count as standard unless
 * they head for early tech or an early expansion.
 */
export function getGamePlaystyle(game: StyledGame, population?: BuildPopulation): Playstyle {
  const parts = game.family.split(' ').slice(1)
  const cheese = isTeamGame(game.shape) ? TEAM_CHEESE_PARTS : CHEESE_PARTS
  if (parts.some(p => cheese.has(p)) || (parts[0] === 'forgeCannons' && game.shape === '1v1')) {
    return 'cheese'
  }
  const defenses = (game.player.buildSteps ?? []).filter(
    s => STATIC_DEFENSE.has(s.key) && s.timeMs <= STATIC_DEFENSE_BY_MS,
  ).length
  if (defenses >= (isTeamGame(game.shape) ? TEAM_STATIC_DEFENSE_COUNT : STATIC_DEFENSE_COUNT)) {
    return 'staticDefense'
  }
  const counted = population?.get(getPopulationKey(game.shape, game.mapFamily, game.race))
  const known = counted && counted.games >= MIN_POPULATION_GAMES
  if (known && (counted.families.get(game.family) ?? 0) / counted.games >= STANDARD_SHARE) {
    return 'standard'
  }
  if (parts.some(p => TECH_PARTS.has(p))) {
    return known ? 'tech' : 'standard'
  }
  if (parts.some(p => GREEDY_PARTS.has(p))) {
    return known ? 'greedy' : 'standard'
  }
  return known ? 'offMeta' : 'standard'
}

/** How someone tends to play, and how many of their games went each way. */
export interface PlaystyleSummary {
  style: Playstyle
  /** Games with a build, which is every game counted below. */
  games: number
  counts: Record<Playstyle, number>
}

export function emptyPlaystyleCounts(): Record<Playstyle, number> {
  return { standard: 0, cheese: 0, staticDefense: 0, tech: 0, greedy: 0, offMeta: 0 }
}

/**
 * Sums up how someone played: a cheeser if they cheesed often enough to watch for, the same for
 * static defense, or else however they played most. Undefined with too few games to say.
 */
export function summarizePlaystyle(
  counts: Record<Playstyle, number>,
): PlaystyleSummary | undefined {
  const games = PLAYSTYLES.reduce((sum, style) => sum + counts[style], 0)
  if (games < MIN_STYLE_GAMES) {
    return undefined
  }
  let style: Playstyle
  if (counts.cheese >= MIN_CHEESE_GAMES && counts.cheese / games >= CHEESE_SHARE) {
    style = 'cheese'
  } else if (counts.staticDefense / games >= STATIC_DEFENSE_SHARE) {
    style = 'staticDefense'
  } else {
    // Standard wins a tie, as the least to warn about.
    style = PLAYSTYLES.reduce((best, s) => (counts[s] > counts[best] ? s : best), 'standard')
  }
  return { style, games, counts: { ...counts } }
}
