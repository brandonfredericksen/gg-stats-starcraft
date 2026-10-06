import { getErrorStack } from '../common/errors'
import { TypedIpcMain } from '../common/ipc'
import { computeMyStats, DatedGameMetrics } from '../common/my-stats/my-stats'
import { GameStatsStore } from './game/game-stats-store'
import log from './logger'

/**
 * Answers My stats from the saved stats, dating each game by its replay. A replay the library
 * doesn't know, like one moved away, is dated by when its stats were saved.
 */
export function setupMyStats(
  gameStatsStore: GameStatsStore,
  getGameTimes: () => Promise<Map<string, number>> | Map<string, number>,
) {
  new TypedIpcMain().handle('myStatsQuery', async (_event, query) => {
    const [listings, gameTimes] = await Promise.all([
      gameStatsStore.listMetrics(),
      Promise.resolve()
        .then(getGameTimes)
        .catch((err: unknown) => {
          log.warning(`Couldn't read when replays were played: ${getErrorStack(err)}`)
          return new Map<string, number>()
        }),
    ])
    const games: DatedGameMetrics[] = listings.map(({ replayPathKey, savedAt, metrics }) => ({
      ...metrics,
      gameTimeMs:
        (replayPathKey !== undefined ? gameTimes.get(replayPathKey) : undefined) ??
        savedAt - metrics.durationMs,
    }))
    return computeMyStats(games, query, Date.now())
  })
}
