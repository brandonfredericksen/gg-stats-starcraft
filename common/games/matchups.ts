import { Tagged } from 'type-fest'
import { ALL_ASSIGNED_RACE_CHARS, AssignedRaceChar, RaceChar } from '../races'
import { MatchupFilter } from './game-filters'

/** A canonical matchup string, e.g. `'p-z'`, `'pt-tz'`. */
export type MatchupString = Tagged<string, 'MatchupString'>

/**
 * Converts a string to a properly typed `MatchupString`. Prefer better ways of getting a typed
 * version, such as computing it via `computeMatchupString`. This method should mainly be considered
 * for testing and internal behavior.
 */
export function makeMatchupString(s: string): MatchupString {
  return s as MatchupString
}

/**
 * Computes a canonical matchup string from an array of team race arrays.
 * Races within each team are sorted alphabetically, then teams are sorted lexicographically,
 * and joined with '-'.
 *
 * @example
 * computeMatchupString([['z'], ['p']]) // => 'p-z'
 * computeMatchupString([['p', 't'], ['t', 'z']]) // => 'pt-tz'
 *
 * @returns the canonical matchup string, or `null` if the input is invalid
 */
export function computeMatchupString(teamRaces: RaceChar[][]): MatchupString | null {
  if (teamRaces.length < 2) {
    return null
  }

  for (const team of teamRaces) {
    if (team.length === 0) {
      return null
    }
  }

  const sortedTeams = teamRaces.map(team => [...team].sort().join(''))
  sortedTeams.sort()

  return makeMatchupString(sortedTeams.join('-'))
}

/**
 * Expands a matchup filter (which may contain `undefined` wildcard slots) into all possible
 * canonical matchup strings.
 *
 * For each team, replaces `undefined` slots with each of 'p', 't', 'z', computes the cartesian
 * product, canonicalizes each combination, and deduplicates.
 *
 * @returns the list of all matching canonical matchup strings
 */
export function expandMatchupFilter(matchup: MatchupFilter): MatchupString[] {
  const expandTeam = (team: (AssignedRaceChar | undefined)[]): AssignedRaceChar[][] => {
    let combinations: AssignedRaceChar[][] = [[]]
    for (const slot of team) {
      const races = slot !== undefined ? [slot] : ALL_ASSIGNED_RACE_CHARS
      const newCombinations: AssignedRaceChar[][] = []
      for (const combo of combinations) {
        for (const race of races) {
          newCombinations.push([...combo, race])
        }
      }
      combinations = newCombinations
    }
    return combinations
  }

  const team1Combos = expandTeam(matchup.team1)
  const team2Combos = expandTeam(matchup.team2)

  const seen = new Set<MatchupString>()
  const result: MatchupString[] = []

  for (const t1 of team1Combos) {
    for (const t2 of team2Combos) {
      const matchupStr = computeMatchupString([t1, t2])
      if (matchupStr && !seen.has(matchupStr)) {
        seen.add(matchupStr)
        result.push(matchupStr)
      }
    }
  }

  return result
}
