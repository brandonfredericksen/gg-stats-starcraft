import {
  decodeMatchup,
  EncodedMatchupString,
  GameFormat,
  makeEncodedMatchupString,
} from '../../common/games/game-filters'

/** Parses a `matchup` URL search param. */
export function parseMatchup(
  value: string,
  format: GameFormat | undefined,
): EncodedMatchupString | undefined {
  if (!value || !format) {
    return undefined
  }
  // Only keep the matchup if it actually decodes for the current format, so a hand-edited URL (e.g.
  // `?matchup=foo`) gets ignored.
  const encoded = makeEncodedMatchupString(value)
  return decodeMatchup(format, encoded) ? encoded : undefined
}
