import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { gunzipSync, gzipSync } from 'node:zlib'
import { FINGERPRINT_VERSION, GameFingerprint } from '../../common/games/fingerprint'
import { RaceChar } from '../../common/races'

export const LADDER_FINGERPRINTS_VERSION = 1

/** One baseline game's players, and how the ones who did enough to tell played. */
export interface LadderFingerprintGame {
  gameTimeMs: number
  /** Every human player's name, who can't be the same person as any other of them. */
  names: string[]
  prints: Array<{ name: string; race: RaceChar; features: Float32Array }>
}

interface StoredLadderFingerprints {
  version: typeof LADDER_FINGERPRINTS_VERSION
  fingerprintVersion: number
  createdMs: number
  games: Array<{
    gameTimeMs: number
    names: string[]
    /** Features as the bytes of a Float32Array, in base64, which keeps NaN and the file small. */
    prints: Array<{ name: string; race: RaceChar; features: string }>
  }>
}

export async function writeLadderFingerprints(
  filePath: string,
  games: ReadonlyArray<{ gameTimeMs: number; names: string[]; prints: GameFingerprint[] }>,
  createdMs: number,
) {
  const stored: StoredLadderFingerprints = {
    version: LADDER_FINGERPRINTS_VERSION,
    fingerprintVersion: FINGERPRINT_VERSION,
    createdMs,
    games: games.map(({ gameTimeMs, names, prints }) => ({
      gameTimeMs,
      names,
      prints: prints.map(({ name, race, features }) => ({
        name,
        race,
        features: Buffer.from(Float32Array.from(features).buffer).toString('base64'),
      })),
    })),
  }
  await writeFile(filePath, gzipSync(JSON.stringify(stored), { level: 9 }))
}

/**
 * The games of a file written by {@link writeLadderFingerprints}, or none if its features are of
 * another version than these. Throws if the file can't be read.
 */
export function readLadderFingerprints(filePath: string): LadderFingerprintGame[] {
  const stored = JSON.parse(
    gunzipSync(readFileSync(filePath)).toString('utf8'),
  ) as Partial<StoredLadderFingerprints>
  if (
    stored.version !== LADDER_FINGERPRINTS_VERSION ||
    stored.fingerprintVersion !== FINGERPRINT_VERSION ||
    !Array.isArray(stored.games)
  ) {
    return []
  }
  return stored.games.map(game => ({
    ...game,
    prints: game.prints.map(print => ({
      ...print,
      // Copied out of the decoded bytes, which may not be aligned for a Float32Array over them.
      features: new Float32Array(new Uint8Array(Buffer.from(print.features, 'base64')).buffer),
    })),
  }))
}
