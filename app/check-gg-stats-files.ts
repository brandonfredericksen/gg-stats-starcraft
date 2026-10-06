import { app } from 'electron'
import { access } from 'fs/promises'
import path from 'path'
import { GgStatsFile, GgStatsFileResult } from '../common/gg-stats-file'
import logger from './logger'

const FILES_TO_CHECK: [GgStatsFile, string][] = [
  [GgStatsFile.Init, path.join('game', 'dist', 'sb_init.dll')],
  [GgStatsFile.Main, path.join('game', 'dist', 'ggstats.dll')],
  [GgStatsFile.Init64, path.join('game', 'dist', 'sb_init_64.dll')],
  [GgStatsFile.Main64, path.join('game', 'dist', 'ggstats_64.dll')],
]

export function checkGgStatsFiles(): Promise<GgStatsFileResult[]> {
  const basePath = path.resolve(app.getAppPath(), '..')

  logger.verbose('checking the game DLLs')

  return Promise.all(
    FILES_TO_CHECK.map(async ([file, filePath]) => {
      let canAccess = false
      try {
        await access(path.resolve(basePath, filePath))
        canAccess = true
      } catch (err) {
        logger.error(`Error accessing ${filePath}: ${(err as any).stack ?? err}`)
      }

      const result: GgStatsFileResult = [file, canAccess]
      return result
    }),
  )
}
