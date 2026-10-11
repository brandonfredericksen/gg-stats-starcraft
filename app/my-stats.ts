import { getErrorStack } from '../common/errors'
import { LadderGame } from '../common/games/ladder'
import { TypedIpcMain } from '../common/ipc'
import { computeCoach } from '../common/my-stats/coach'
import { computeMetaBuilds } from '../common/my-stats/meta-builds'
import { computeMyStats, DatedGameMetrics } from '../common/my-stats/my-stats'
import { GameStatsStore } from './game/game-stats-store'
import { loadLadderBaseline, withoutLibraryCopies } from './ladder-baseline/load-baseline'
import log from './logger'
import { LadderManifests, withLadder } from './replay-library/ladder-manifests'

/**
 * Answers My stats and the coach from the saved stats, dating each game by its replay. A replay the
 * library doesn't know, like one moved away, is dated by when its stats were saved. Players of a
 * ladder replay get their MMR and rank from the ladder manifest next to it, if there is one. The
 * ladder baseline the app ships adds other players' games to compare with.
 */
export function setupMyStats(
  gameStatsStore: GameStatsStore,
  getGameTimes: () => Promise<Map<string, number>> | Map<string, number>,
  loadBaseline: () => Promise<DatedGameMetrics[]> = loadLadderBaseline,
) {
  const ladderManifests = new LadderManifests()
  // Read once, the first time it's needed: it ships with the app and doesn't change while it runs.
  let baseline: Promise<DatedGameMetrics[]> | undefined
  const loadGames = async (): Promise<DatedGameMetrics[]> => {
    baseline ??= loadBaseline()
    const [listings, gameTimes, baselineGames] = await Promise.all([
      gameStatsStore.listMetrics(),
      Promise.resolve()
        .then(getGameTimes)
        .catch((err: unknown) => {
          log.warning(`Couldn't read when replays were played: ${getErrorStack(err)}`)
          return new Map<string, number>()
        }),
      baseline,
    ])
    const ladderGames = await ladderManifests
      .getGames(listings.flatMap(l => (l.replayPathKey !== undefined ? [l.replayPathKey] : [])))
      .catch((err: unknown) => {
        log.warning(`Couldn't read ladder manifests: ${getErrorStack(err)}`)
        return new Map<string, LadderGame>()
      })
    const ownGames = listings.map(({ replayPathKey, savedAt, metrics }) => ({
      ...withLadder(
        metrics,
        replayPathKey !== undefined ? ladderGames.get(replayPathKey) : undefined,
      ),
      gameTimeMs:
        (replayPathKey !== undefined ? gameTimes.get(replayPathKey) : undefined) ??
        savedAt - metrics.durationMs,
    }))
    return [
      ...ownGames,
      ...withoutLibraryCopies(
        baselineGames,
        listings.flatMap(l => (l.replayPathKey !== undefined ? [l.replayPathKey] : [])),
      ),
    ]
  }

  const ipcMain = new TypedIpcMain()
  ipcMain.handle('myStatsQuery', async (_event, query) =>
    computeMyStats(await loadGames(), query, Date.now()),
  )
  ipcMain.handle('coachQuery', async (_event, query) => computeCoach(await loadGames(), query))
  ipcMain.handle('metaBuildsQuery', async (_event, query) =>
    computeMetaBuilds(await loadGames(), query),
  )
}
