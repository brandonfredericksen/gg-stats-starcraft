import { GameStatsSummary } from '../../common/games/game-stats'
import { ReplayLibraryPlayer } from '../../common/replays-library'
import { TeamLineResult } from '../material/team-line'
import { ReplayTeamLayout } from './replay-library-helpers'

/** One line of a game row: a team, or for FFA the winner or everyone else. */
export interface GameRowLine {
  players: ReplayLibraryPlayer[]
  result: TeamLineResult
}

/** The game's type as players say it: `1v1`, `2v2`, `3v3`, `2v1`, `FFA`. */
export function getGameModeLabel(layout: ReplayTeamLayout): string {
  if (layout.kind === 'flat') {
    return layout.teams.flat().length > 2 ? 'FFA' : '1v1'
  }
  return layout.teams.map(team => team.length).join('v')
}

/**
 * The lines of a game row. With a known result, the winning team comes first, then the rest; in
 * FFA the winner gets a line and everyone else follows on the next in finishing order. Without
 * one, or with results hidden, teams keep replay order and FFA is a single line.
 */
export function getGameRowLines(
  layout: ReplayTeamLayout,
  summary: GameStatsSummary | undefined,
  hideResults: boolean,
): GameRowLine[] {
  const players = layout.teams.flat()
  // Everyone sharing control of a player is listed in the replay under their own name.
  const results = new Map(
    summary?.players.flatMap(p => (p.names?.length ? p.names : [p.name]).map(name => [name, p])),
  )
  const known =
    !hideResults && !!summary && players.some(p => results.get(p.name)?.result === 'win')

  if (layout.kind === 'flat') {
    if (!known || players.length <= 2) {
      return players.length > 2
        ? [{ players, result: 'hidden' }]
        : layout.teams.map(team => ({ players: team, result: 'hidden' }))
    }
    const winners = players.filter(p => results.get(p.name)?.result === 'win')
    const rest = players
      .filter(p => !winners.includes(p))
      // Whoever lasted longest finished higher. Players without a leave time played to the end.
      .sort(
        (a, b) =>
          (results.get(b.name)?.leftAtMs ?? Infinity) - (results.get(a.name)?.leftAtMs ?? Infinity),
      )
    return [
      { players: winners, result: 'won' },
      { players: rest, result: 'lost' },
    ]
  }

  if (!known) {
    return layout.teams.map(team => ({ players: team, result: 'hidden' }))
  }
  const lines = layout.teams.map<GameRowLine>(team => ({
    players: team,
    result: team.some(p => results.get(p.name)?.result === 'win') ? 'won' : 'lost',
  }))
  return [...lines.filter(l => l.result === 'won'), ...lines.filter(l => l.result !== 'won')]
}
