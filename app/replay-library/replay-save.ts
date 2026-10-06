import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pickSaveFilename } from './replay-save-naming'

/** Hashes a replay's whole contents, which identifies it however it was named. */
export function hashReplay(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Saves a replay into `folder` as `<baseName>.rep`, or `<baseName> (2).rep` and so on when another
 * replay has that name. If the same replay is already saved under one of those names, that file is
 * used instead of writing a duplicate. The file is written under a temporary name first, so the
 * replay library never sees half a replay.
 */
export async function saveReplay(
  folder: string,
  baseName: string,
  data: Uint8Array,
): Promise<{ path: string; alreadyExists: boolean }> {
  await mkdir(folder, { recursive: true })
  const hash = hashReplay(data)
  const { name, alreadyExists } = await pickSaveFilename(baseName, hash, async name => {
    try {
      return hashReplay(await readFile(path.join(folder, name)))
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return undefined
      }
      throw err
    }
  })

  const savePath = path.join(folder, name)
  if (!alreadyExists) {
    // Not a .rep, so the replay library ignores it while it's being written.
    const tempPath = `${savePath}.${hash.slice(0, 8)}.tmp`
    try {
      await writeFile(tempPath, data)
      await rename(tempPath, savePath)
    } catch (err) {
      await rm(tempPath, { force: true })
      throw err
    }
  }
  return { path: savePath, alreadyExists }
}
