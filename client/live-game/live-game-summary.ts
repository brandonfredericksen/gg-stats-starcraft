import { getMapFamily, MapFamily } from '../../common/games/map-family'
import { GameShape } from '../../common/games/player-metrics'
import { LiveGamePlayer, LiveGameSource } from '../../common/live-game'
import { WinLoss } from '../../common/my-stats/my-stats'
import { splitsByMap } from '../../common/my-stats/player-games'
import { PlayerScout, ScoutMatchup } from '../../common/my-stats/player-scout'
import {
  emptyPlaystyleCounts,
  PLAYSTYLES,
  PlaystyleSummary,
  summarizePlaystyle,
} from '../../common/my-stats/playstyle'
import { AssignedRaceChar } from '../../common/races'

/**
 * The sides of a game, the user's first. Without teams from the game, a ladder game, or any game of
 * two, has the user on one side and everyone else on the other. A bigger game without teams yet is
 * one side of everyone, until the teams are known. Anyone watching is left out.
 */
export function getTeams<T extends { player: LiveGamePlayer; isMe: boolean }>(
  people: ReadonlyArray<T>,
  source: LiveGameSource,
): T[][] {
  const playing = people.filter(p => !p.player.observer)
  if (playing.some(p => p.player.team !== undefined)) {
    const byTeam = new Map<number, T[]>()
    for (const person of playing) {
      // Someone the setup didn't place goes last, rather than with someone at random.
      const team = person.player.team ?? Number.MAX_SAFE_INTEGER
      byTeam.set(team, [...(byTeam.get(team) ?? []), person])
    }
    return Array.from(byTeam.entries())
      .sort(
        ([teamA, a], [teamB, b]) =>
          Number(b.some(p => p.isMe)) - Number(a.some(p => p.isMe)) || teamA - teamB,
      )
      .map(([, side]) => side)
  }
  if (source !== 'ladder' && playing.length !== 2) {
    return playing.length ? [playing] : []
  }
  const mine = playing.filter(p => p.isMe)
  if (!mine.length) {
    return playing.map(p => [p])
  }
  const others = playing.filter(p => !p.isMe)
  return others.length ? [mine, others] : [mine]
}

/** The kind of game the sides make. */
export function getGameShape(teams: ReadonlyArray<ReadonlyArray<unknown>>): GameShape {
  const sizes = teams.map(team => team.length)
  if (sizes.length === 2 && sizes[0] === sizes[1] && sizes[0] <= 4) {
    return `${sizes[0]}v${sizes[0]}` as GameShape
  }
  if (sizes.length > 2 && sizes.every(size => size === 1)) {
    return 'ffa'
  }
  return 'other'
}

/** What kind of game to look for someone's builds in. */
export interface GameKind {
  shape: GameShape
  mapFamily?: MapFamily
}

export function getGameKind(
  teams: ReadonlyArray<ReadonlyArray<unknown>>,
  mapName: string | undefined,
): GameKind {
  const shape = getGameShape(teams)
  return { shape, mapFamily: mapName && splitsByMap(shape) ? getMapFamily(mapName) : undefined }
}

function isKind(row: { shape: GameShape; mapFamily?: MapFamily }, kind: GameKind) {
  return row.shape === kind.shape && (!kind.mapFamily || row.mapFamily === kind.mapFamily)
}

/** Where a player's usual builds were counted from, the closest to this game that had any. */
export type BuildScope = 'matchup' | 'kind' | 'race'

/** The builds someone goes with most as a race, most played first, out of how many games. */
export interface UsualBuilds {
  builds: Array<{ family: string; games: number }>
  /** Their games with a build in {@link scope}. */
  of: number
  scope: BuildScope
}

/** How many builds show: the top one, and the next when the top one isn't most of their games. */
const SHOWN_BUILDS = 2
const SURE_SHARE = 0.5

/**
 * The builds someone goes with as `race`: against `enemyRaces` in this kind of game, where the
 * game types that write matchups out (1v1 and 2v2) have played it, or else in this kind of game,
 * or else in any game as the race.
 */
export function getUsualBuilds(
  scout: PlayerScout,
  race: AssignedRaceChar,
  kind: GameKind,
  enemyRaces: ReadonlyArray<AssignedRaceChar>,
): UsualBuilds | undefined {
  const asRace = scout.matchups.filter(m => m.race === race)
  const sameKind = asRace.filter(m => isKind(m, kind))
  const enemies = [...enemyRaces].sort().join('')
  const sameMatchup = sameKind.filter(
    m => m.opponentRaces.length > 0 && m.opponentRaces.join('') === enemies,
  )
  const hasBuilds = (rows: ScoutMatchup[]) => rows.some(m => m.builds.length)
  let matchups = asRace
  let scope: BuildScope = 'race'
  if (hasBuilds(sameMatchup)) {
    matchups = sameMatchup
    scope = 'matchup'
  } else if (hasBuilds(sameKind)) {
    matchups = sameKind
    scope = 'kind'
  }
  const tallies = new Map<string, number>()
  let of = 0
  for (const matchup of matchups) {
    for (const build of matchup.builds) {
      tallies.set(build.family, (tallies.get(build.family) ?? 0) + build.games)
      of += build.games
    }
  }
  if (!of) {
    return undefined
  }
  const ranked = Array.from(tallies, ([family, games]) => ({ family, games })).sort(
    (a, b) => b.games - a.games || a.family.localeCompare(b.family),
  )
  const shown = ranked[0].games / of > SURE_SHARE ? 1 : SHOWN_BUILDS
  return { builds: ranked.slice(0, shown), of, scope }
}

/**
 * Someone's record in this kind of game, any race, or for want of those games, in all their games.
 * `allGames` says which.
 */
export function getKindRecord(scout: PlayerScout, kind: GameKind): WinLoss & { allGames: boolean } {
  const record = { games: 0, wins: 0, losses: 0 }
  for (const matchup of scout.matchups) {
    if (isKind(matchup, kind)) {
      record.games += matchup.games
      record.wins += matchup.wins
      record.losses += matchup.losses
    }
  }
  if (record.games) {
    return { ...record, allGames: false }
  }
  return { ...scout.totals.record, allGames: true }
}

/**
 * How someone tends to play: as `race` in this kind of game if there are enough of those games,
 * or else as `race` in any game, or else in all their games when the race isn't known yet.
 */
export function getPlaystyle(
  scout: PlayerScout,
  race: AssignedRaceChar | undefined,
  kind: GameKind,
): PlaystyleSummary | undefined {
  const sum = (rows: PlayerScout['playstyles']) => {
    const counts = emptyPlaystyleCounts()
    for (const row of rows) {
      for (const style of PLAYSTYLES) {
        counts[style] += row.counts[style]
      }
    }
    return summarizePlaystyle(counts)
  }
  const asRace = race ? scout.playstyles.filter(p => p.race === race) : scout.playstyles
  return sum(asRace.filter(p => isKind(p, kind))) ?? sum(asRace)
}
