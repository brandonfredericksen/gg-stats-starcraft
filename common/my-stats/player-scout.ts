import { MapFamily } from '../games/map-family'
import { GameShape, PlayerMetrics } from '../games/player-metrics'
import { AssignedRaceChar } from '../races'
import { getBuildFamily } from './build-family'
import { Average, DatedGameMetrics, WinLoss } from './my-stats'
import { getMyResult, getSidesOf, splitsByMap } from './player-games'

/** A build a player went with, and how those games went for them. */
export interface ScoutBuild extends WinLoss {
  family: string
}

/**
 * A player's games of one kind, as one race with and against the same races, and in team games
 * that play differently by map, on the same kind of map.
 */
export interface ScoutMatchup extends WinLoss {
  shape: GameShape
  race: AssignedRaceChar
  /** In 2v2, their teammate's race. */
  teammateRaces: AssignedRaceChar[]
  /** In 1v1 and 2v2, the races they played against, in alphabetical order. */
  opponentRaces: AssignedRaceChar[]
  /** In game types that split by map, see `splitsByMap`. */
  mapFamily?: MapFamily
  /** Every build they went with, the one they went with most first. */
  builds: ScoutBuild[]
  /** Games whose build couldn't be named, like ones over too soon to say. */
  unnamed: WinLoss
}

/** What the analyzed games say about another player: how they play and how they've done. */
export interface PlayerScout extends WinLoss {
  apm?: Average
  eapm?: Average
  /** Every race they played, the one they played most first. */
  races: Array<{ race: AssignedRaceChar; games: number }>
  /** Most games first. */
  matchups: ScoutMatchup[]
  lastPlayedMs?: number
  /** How many of the games are from the ladder games the app ships, not the user's replays. */
  fromBaseline: number
}

function addResult(tally: WinLoss, result: string) {
  tally.games += 1
  if (result === 'win') {
    tally.wins += 1
  } else if (result === 'loss') {
    tally.losses += 1
  }
}

function addAverage(sums: { total: number; games: number }, value: number | undefined) {
  if (value !== undefined && Number.isFinite(value)) {
    sums.total += value
    sums.games += 1
  }
}

function toAverage({ total, games }: { total: number; games: number }): Average | undefined {
  return games ? { value: total / games, games } : undefined
}

function byGames<T extends { games: number }>(a: T, b: T) {
  return b.games - a.games
}

/**
 * Sums up every analyzed game played by someone going by any of `accounts`, from their side. Games
 * with a computer in them are practice, and don't count, the same as for the user's own stats.
 */
export function computePlayerScout(
  games: ReadonlyArray<DatedGameMetrics>,
  accounts: ReadonlyArray<string>,
): PlayerScout {
  const lowerAccounts = new Set(accounts.map(a => a.toLowerCase()))
  const scout: PlayerScout = {
    games: 0,
    wins: 0,
    losses: 0,
    races: [],
    matchups: [],
    fromBaseline: 0,
  }
  const apm = { total: 0, games: 0 }
  const eapm = { total: 0, games: 0 }
  const races = new Map<AssignedRaceChar, number>()
  const matchups = new Map<string, ScoutMatchup & { familyTallies: Map<string, ScoutBuild> }>()

  for (const game of games) {
    if (game.players.some(p => !p.human)) {
      continue
    }
    let player: PlayerMetrics | undefined
    let name: string | undefined
    for (const p of game.players) {
      name = p.names.find(n => lowerAccounts.has(n.toLowerCase()))
      if (name !== undefined) {
        player = p
        break
      }
    }
    if (!player || name === undefined) {
      continue
    }
    const result = getMyResult(game, player, [name])
    addResult(scout, result)
    addAverage(apm, player.apm)
    addAverage(eapm, player.eapm)
    scout.lastPlayedMs = Math.max(scout.lastPlayedMs ?? 0, game.gameTimeMs)
    scout.fromBaseline += game.ladderBaseline ? 1 : 0
    if (!player.race) {
      continue
    }
    races.set(player.race, (races.get(player.race) ?? 0) + 1)

    const sides = getSidesOf(game, player)
    const racesOf = (players: PlayerMetrics[]) =>
      players.flatMap(p => (p.race ? [p.race] : [])).sort()
    const teammateRaces = game.shape === '2v2' ? racesOf(sides.teammates) : []
    const opponentRaces =
      game.shape === '1v1' || game.shape === '2v2' ? racesOf(sides.opponents) : []
    const mapFamily = splitsByMap(game.shape) ? game.mapFamily : undefined
    const key = [
      game.shape,
      player.race,
      teammateRaces.join(''),
      opponentRaces.join(''),
      mapFamily,
    ].join(' ')
    let matchup = matchups.get(key)
    if (!matchup) {
      matchup = {
        shape: game.shape,
        race: player.race,
        teammateRaces,
        opponentRaces,
        mapFamily,
        games: 0,
        wins: 0,
        losses: 0,
        builds: [],
        unnamed: { games: 0, wins: 0, losses: 0 },
        familyTallies: new Map(),
      }
      matchups.set(key, matchup)
    }
    addResult(matchup, result)
    const family = getBuildFamily(player, {
      shape: game.shape,
      playedMs: Math.min(player.leftAtMs ?? game.durationMs, game.durationMs),
    })
    if (family) {
      let build = matchup.familyTallies.get(family)
      if (!build) {
        build = { family, games: 0, wins: 0, losses: 0 }
        matchup.familyTallies.set(family, build)
      }
      addResult(build, result)
    } else {
      addResult(matchup.unnamed, result)
    }
  }

  scout.apm = toAverage(apm)
  scout.eapm = toAverage(eapm)
  scout.races = Array.from(races, ([race, count]) => ({ race, games: count })).sort(byGames)
  scout.matchups = Array.from(matchups.values(), ({ familyTallies, ...matchup }) => ({
    ...matchup,
    builds: Array.from(familyTallies.values()).sort(
      (a, b) => b.games - a.games || a.family.localeCompare(b.family),
    ),
  })).sort(byGames)
  return scout
}
