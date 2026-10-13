import fs, { promises as fsPromises } from 'fs'
import path from 'path'

async function checkRemasteredPath(dirPath: string): Promise<boolean> {
  const requiredFiles = ['x86/starcraft.exe', 'x86/clientsdk.dll']

  try {
    await Promise.all(
      requiredFiles.map(f => fsPromises.access(path.join(dirPath, f), fs.constants.R_OK)),
    )
    return true
  } catch (err) {
    return false
  }
}

export interface PathCheckResult {
  /**
   * Whether the path contains a StarCraft: Remastered installation. Any version of it counts: the
   * game DLL finds what it needs in each patch as it loads, see `game/scr-analysis`.
   */
  path: boolean
}

export async function checkStarcraftPath(dirPath: string): Promise<PathCheckResult> {
  return { path: await checkRemasteredPath(dirPath) }
}
