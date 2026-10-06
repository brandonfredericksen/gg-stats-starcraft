import { getErrorStack } from '../common/errors'
import { TypedIpcMain } from '../common/ipc'
import { computeCoach } from '../common/my-stats/coach'
import { computeMyStats, DatedGameMetrics } from '../common/my-stats/my-stats'
import { GameStatsStore } from './game/game-stats-store'
import log from './logger'

/**
 * Answers My stats and the coach from the saved stats, dating each game by its replay. A replay the
 * library doesn't know, like one moved away, is dated by when its stats were saved.
 */
export function setupMyStats(
  gameStatsStore: GameStatsStore,
  getGameTimes: () => Promise<Map<string, number>> | Map<string, number>,
) {
  const loadGames = async (): Promise<DatedGameMetrics[]> => {
    const [listings, gameTimes] = await Promise.all([
      gameStatsStore.listMetrics(),
      Promise.resolve()
        .then(getGameTimes)
        .catch((err: unknown) => {
          log.warning(`Couldn't read when replays were played: ${getErrorStack(err)}`)
          return new Map<string, number>()
        }),
    ])
    return listings.map(({ replayPathKey, savedAt, metrics }) => ({
      ...metrics,
      gameTimeMs:
        (replayPathKey !== undefined ? gameTimes.get(replayPathKey) : undefined) ??
        savedAt - metrics.durationMs,
    }))
  }

  const ipcMain = new TypedIpcMain()
  ipcMain.handle('myStatsQuery', async (_event, query) =>
    computeMyStats(await loadGames(), query, Date.now()),
  )
  ipcMain.handle('coachQuery', async (_event, query) => computeCoach(await loadGames(), query))
}
