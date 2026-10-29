import { TFunction } from 'i18next'
import { GameShape } from './player-metrics'

/**
 * A race as its letter, for chips, tags and other tight spots: P, T, Z, R, or `?` when the race
 * isn't known.
 */
export function getRaceLetter(race: string | undefined, t: TFunction): string {
  switch (race) {
    case 'p':
      return t('game.raceLetter.p', 'P')
    case 't':
      return t('game.raceLetter.t', 'T')
    case 'z':
      return t('game.raceLetter.z', 'Z')
    case 'r':
      return t('game.raceLetter.r', 'R')
    default:
      return '?'
  }
}

/** A race as it's written inside a 1v1 matchup, where some languages use a syllable, not a letter. */
function getMatchupRace(race: string | undefined, t: TFunction): string {
  switch (race) {
    case 'p':
      return t('game.matchup.race.p', 'P')
    case 't':
      return t('game.matchup.race.t', 'T')
    case 'z':
      return t('game.matchup.race.z', 'Z')
    case 'r':
      return t('game.matchup.race.r', 'R')
    default:
      return '?'
  }
}

/**
 * The races facing off, each team's races in the order given: "TvZ" for a 1v1, and for team games
 * each team's race letters, like "PPZ vs TZP", or "PPZvTZP" when `compact`.
 */
export function formatMatchup(
  teams: ReadonlyArray<ReadonlyArray<string | undefined>>,
  t: TFunction,
  { compact = false }: { compact?: boolean } = {},
): string {
  if (teams.length === 2 && teams.every(team => team.length === 1)) {
    return t('game.matchup.oneOnOne', '{{race}}v{{opponent}}', {
      race: getMatchupRace(teams[0][0], t),
      opponent: getMatchupRace(teams[1][0], t),
    })
  }
  const separator = compact
    ? t('gameStats.matchupSeparator', 'v')
    : t('gameStats.teamMatchupSeparator', ' vs ')
  return teams.map(team => team.map(race => getRaceLetter(race, t)).join('')).join(separator)
}

/** Team sizes as players write them, like 3v3 or 2v1. */
export function formatTeamSizes(sizes: ReadonlyArray<number>, t: TFunction): string {
  return sizes.join(t('game.shape.sizeSeparator', 'v'))
}

/** A game type by its teams, like 1v1, 3v3 or FFA. */
export function getShapeLabel(shape: GameShape, t: TFunction): string {
  switch (shape) {
    case '1v1':
      return formatTeamSizes([1, 1], t)
    case '2v2':
      return formatTeamSizes([2, 2], t)
    case '3v3':
      return formatTeamSizes([3, 3], t)
    case '4v4':
      return formatTeamSizes([4, 4], t)
    case 'ffa':
      return t('game.shape.ffa', 'FFA')
    case 'other':
      return t('game.shape.other', 'Other')
    default:
      return shape satisfies never
  }
}
