import { IndexedReplay } from '../replay-library/replay-parser'

/** Characters Windows doesn't allow in a file name, besides control characters. */
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*]/g
/** Keeps the whole path comfortably under Windows' 260 character limit. */
const MAX_NAME_LENGTH = 120

function pad(value: number) {
  return String(value).padStart(2, '0')
}

/** Makes `text` safe to use in a Windows file name. */
export function sanitizeFilenamePart(text: string): string {
  return (
    Array.from(text)
      // Control characters, like StarCraft's color codes in names.
      .filter(char => char.charCodeAt(0) >= 0x20)
      .join('')
      .replace(INVALID_FILENAME_CHARS, '')
      .replace(/\s+/g, ' ')
      .trim()
      // Windows drops trailing dots and spaces, which would make the name differ from what we wrote.
      .replace(/[. ]+$/, '')
  )
}

/** A matchup like `p-tz` as players read it: `PvTZ`. */
export function displayMatchup(matchup: string) {
  return matchup
    .split('-')
    .map(team => team.toUpperCase())
    .join('v')
}

/**
 * The folder and file name an automatically captured replay is archived under, like
 * `2026-10` and `2026-10-03 21.05 PvZ Polypoid - Flash vs Jaedong.rep`, by the local time the game
 * started.
 */
export function getArchiveName(replay: IndexedReplay): { folder: string; fileName: string } {
  const started = new Date(replay.gameTime)
  const month = `${started.getFullYear()}-${pad(started.getMonth() + 1)}`
  const time = `${month}-${pad(started.getDate())} ${pad(started.getHours())}.${pad(started.getMinutes())}`

  const teams = new Map<number, string[]>()
  for (const player of replay.players) {
    if (!player.isComputer) {
      teams.set(player.team, [...(teams.get(player.team) ?? []), player.name])
    }
  }
  const players = Array.from(teams.values(), names => names.join(', ')).join(' vs ')

  const description = [
    replay.matchup ? displayMatchup(replay.matchup) : undefined,
    sanitizeFilenamePart(replay.mapName),
    players ? `- ${sanitizeFilenamePart(players)}` : undefined,
  ]
    .filter(Boolean)
    .join(' ')

  const name = sanitizeFilenamePart(`${time} ${description}`.slice(0, MAX_NAME_LENGTH))
  return { folder: month, fileName: `${name}.rep` }
}
