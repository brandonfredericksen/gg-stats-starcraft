import { getErrorStack } from '../common/errors'
import { MIN_GAME_LENGTH_MS } from '../common/games/game-filters'
import { LadderGame } from '../common/games/ladder'
import { TypedIpcMain } from '../common/ipc'
import { computeCoach } from '../common/my-stats/coach'
import { ESkill, ESkillModel, fitESkillModel, getESkill } from '../common/my-stats/eskill'
import { computeMetaBuilds } from '../common/my-stats/meta-builds'
import { computeMyStatsSummary, DatedGameMetrics } from '../common/my-stats/my-stats'
import { GameStatsStore } from './game/game-stats-store'
import { loadLadderBaseline, withoutLibraryCopies } from './ladder-baseline/load-baseline'
import log from './logger'
import { LadderManifests, withLadder } from './replay-library/ladder-manifests'

/**
 * Answers My stats, the coach and Builds from the saved stats, dating each game by its replay. A
 * replay the library doesn't know, like one moved away, is dated by when its stats were saved.
 * Players of a ladder replay get their MMR and rank from the ladder manifest next to it, if there is
 * one. The ladder baseline the app ships adds other players' games to compare with. Games shorter
 * than `MIN_GAME_LENGTH_MS` don't count. eSkill is fit to the baseline's ranked players.
 */
export function setupMyStats(
  gameStatsStore: GameStatsStore,
  getGameTimes: (pathKeys: string[]) => Promise<Map<string, number>> | Map<string, number>,
  loadBaseline: () => Promise<DatedGameMetrics[]> = loadLadderBaseline,
) {
  const ladderManifests = new LadderManifests()
  // Read once, the first time it's needed: it ships with the app and doesn't change while it runs.
  let baseline: Promise<DatedGameMetrics[]> | undefined
  let eSkillModel: Promise<ESkillModel | undefined> | undefined
  const loadESkillModel = () => {
    baseline ??= loadBaseline()
    eSkillModel ??= baseline.then(games => {
      const model = fitESkillModel(games)
      log.info(
        model
          ? `Fit eSkill to ${model.players} ladder players`
          : "The ladder baseline doesn't have enough ranked players to fit eSkill to",
      )
      return model
    })
    return eSkillModel
  }
  const loadGames = async (): Promise<DatedGameMetrics[]> => {
    baseline ??= loadBaseline()
    const listings = await gameStatsStore.listMetrics()
    const replayPathKeys = listings.flatMap(l =>
      l.replayPathKey !== undefined ? [l.replayPathKey] : [],
    )
    const [gameTimes, baselineGames] = await Promise.all([
      Promise.resolve()
        .then(() => getGameTimes(replayPathKeys))
        .catch((err: unknown) => {
          log.warning(`Couldn't read when replays were played: ${getErrorStack(err)}`)
          return new Map<string, number>()
        }),
      baseline,
    ])
    const ladderGames = await ladderManifests.getGames(replayPathKeys).catch((err: unknown) => {
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
    return [...ownGames, ...withoutLibraryCopies(baselineGames, replayPathKeys, ownGames)].filter(
      game => game.durationMs >= MIN_GAME_LENGTH_MS,
    )
  }

  const ipcMain = new TypedIpcMain()
  ipcMain.handle('myStatsQuery', async (_event, query) => {
    const [games, model] = await Promise.all([loadGames(), loadESkillModel()])
    return computeMyStatsSummary(games, query, Date.now(), model)
  })
  ipcMain.handle('gameESkill', async (_event, gameId) => {
    const [found, model] = await Promise.all([gameStatsStore.getMetrics(gameId), loadESkillModel()])
    const scores: Record<number, ESkill> = {}
    if (found && model) {
      found.metrics.players.forEach((player, i) => {
        const eSkill = getESkill(model, found.metrics, player)
        if (eSkill) {
          scores[found.playerIds[i]] = eSkill
        }
      })
    }
    return scores
  })
  ipcMain.handle('coachQuery', async (_event, query) => computeCoach(await loadGames(), query))
  ipcMain.handle('metaBuildsQuery', async (_event, query) =>
    computeMetaBuilds(await loadGames(), query),
  )
}
