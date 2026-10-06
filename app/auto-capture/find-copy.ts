import path from 'node:path'
import { hashReplay } from '../replay-library/replay-save'
import { FileSignature } from './last-replay-detector'

export interface FindCopyDeps {
  /** Lists a folder, or returns an empty list if it doesn't exist. */
  readdir: (folder: string) => Promise<Array<{ name: string; isDirectory: boolean }>>
  stat: (filePath: string) => Promise<FileSignature | undefined>
  readFile: (filePath: string) => Promise<Uint8Array>
}

/**
 * How far apart StarCraft's AutoSave copy and `LastReplay.rep` can be written. Both are saved as a
 * game ends, but nothing guarantees they land in the same second.
 */
export const AUTOSAVE_WINDOW_MS = 10 * 60 * 1000

/** A folder to look for copies in. */
export interface CopyLocation {
  folder: string
  /** Also look in the folder's direct subfolders, like AutoSave's folder per day. */
  includeSubfolders: boolean
  /** Only consider files saved within {@link AUTOSAVE_WINDOW_MS} of the replay. */
  nearReplayTime: boolean
}

async function listReplays(folder: string, includeSubfolders: boolean, deps: FindCopyDeps) {
  const entries = await deps.readdir(folder)
  const files = entries
    .filter(e => !e.isDirectory && e.name.toLowerCase().endsWith('.rep'))
    .map(e => path.join(folder, e.name))
  if (includeSubfolders) {
    for (const sub of entries.filter(e => e.isDirectory)) {
      files.push(...(await listReplays(path.join(folder, sub.name), false, deps)))
    }
  }
  return files
}

/**
 * Finds a file elsewhere that holds exactly this replay, like the AutoSave copy StarCraft keeps,
 * so it can be used instead of saving the replay a second time.
 */
export async function findReplayCopy(
  data: Uint8Array,
  signature: FileSignature,
  locations: ReadonlyArray<CopyLocation>,
  deps: FindCopyDeps,
): Promise<string | undefined> {
  let hash: string | undefined
  for (const location of locations) {
    for (const filePath of await listReplays(location.folder, location.includeSubfolders, deps)) {
      const candidate = await deps.stat(filePath)
      if (
        !candidate ||
        candidate.size !== signature.size ||
        (location.nearReplayTime &&
          Math.abs(candidate.modifiedMs - signature.modifiedMs) > AUTOSAVE_WINDOW_MS)
      ) {
        continue
      }
      hash ??= hashReplay(data)
      try {
        if (hashReplay(await deps.readFile(filePath)) === hash) {
          return filePath
        }
      } catch {
        // Gone or unreadable since it was listed, so it's no use as a copy.
      }
    }
  }
  return undefined
}
