import { stat } from 'node:fs/promises'
import { ReplayTrashOutcome, ReplayTrashResult } from '../../common/replays-library'
import { isPathUnderRoot } from './replay-watcher-paths'

/**
 * Whether `filePath` sits inside one of `watchedFolders`. Pure (no filesystem access) so it can be unit-tested directly; the containment check
 * itself (case-insensitive, separator-normalizing, `..`-resistant) is `isPathUnderRoot`'s.
 */
export function isWithinWatchedFolders(
  filePath: string,
  watchedFolders: ReadonlyArray<string>,
): boolean {
  return watchedFolders.some(folder => isPathUnderRoot(filePath, folder))
}

/**
 * Moves each of `paths` to the Recycle Bin via `trashItem`, one at a time. Every path must resolve
 * inside one of `watchedFolders` (a path outside them is refused and reported `failed` without
 * being touched), and a path whose file is already gone is reported `missing`. One path failing
 * never stops the rest from being attempted. The local index isn't touched here; the watcher's own
 * reconcile un-indexes the files (cascading any playlist membership) once it notices they're gone.
 */
export async function trashReplays(
  paths: ReadonlyArray<string>,
  watchedFolders: ReadonlyArray<string>,
  trashItem: (filePath: string) => Promise<void>,
  onError: (filePath: string, err: unknown) => void,
): Promise<ReplayTrashResult[]> {
  const results: ReplayTrashResult[] = []
  for (const filePath of paths) {
    results.push({
      path: filePath,
      outcome: await trashReplay(filePath, watchedFolders, trashItem, onError),
    })
  }
  return results
}

async function trashReplay(
  filePath: string,
  watchedFolders: ReadonlyArray<string>,
  trashItem: (filePath: string) => Promise<void>,
  onError: (filePath: string, err: unknown) => void,
): Promise<ReplayTrashOutcome> {
  if (!isWithinWatchedFolders(filePath, watchedFolders)) {
    onError(filePath, new Error('Refusing to trash a replay outside the watched replay folders'))
    return 'failed'
  }

  try {
    await stat(filePath)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return 'missing'
    }
    onError(filePath, err)
    return 'failed'
  }

  try {
    await trashItem(filePath)
    return 'trashed'
  } catch (err) {
    onError(filePath, err)
    return 'failed'
  }
}
