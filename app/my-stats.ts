import { getErrorStack } from '../common/errors'
import { MIN_GAME_LENGTH_MS } from '../common/games/game-filters'
import { LadderGame } from '../common/games/ladder'
import { TypedIpcMain } from '../common/ipc'
import { computeCoach } from '../common/my-stats/coach'
import { ESkillModel, fitESkillModel } from '../common/my-stats/eskill'
import { computeMetaBuilds } from '../common/my-stats/meta-builds'
import { computeMyStatsSummary, DatedGameMetrics } from '../common/my-stats/my-stats'
import { GameStatsStore } from './game/game-stats-store'
import { loadLadderBaseline, withoutLibraryCopies } from './ladder-baseline/load-baseline'
import { ScoutGames } from './live-game/scout-games'
import log from './logger'
import { LadderManifests, withLadder } from './replay-library/ladder-manifests'

function isLongEnough(game: DatedGameMetrics) {
  return game.durationMs >= MIN_GAME_LENGTH_MS
}

/**
 * Answers My stats, the coach and Builds from the saved stats, dating each game by its replay. A
 * replay the library doesn't know, like one moved away, is dated by when its stats were saved.
 * Players of a ladder replay get their MMR and rank from the ladder manifest next to it, if there is
 * one. The ladder baseline the app ships adds other players' games to compare with. Games shorter
 * than `MIN_GAME_LENGTH_MS` don't count. eSkill is fit to the baseline's ranked players. Also
 * answers what the games say about the people in a game the user joined, see {@link ScoutGames}.
 */
export function setupMyStats(
  gameStatsStore: GameStatsStore,
  getGameTimes: (pathKeys: string[]) => Promise<Map<string, number>> | Map<string, number>,
  loadBaseline: () => Promise<DatedGameMetrics[]> = loadLadderBaseline,
) {
  const ladderManifests = new LadderManifests()
  // Read once, the first time it's needed: it ships with the app and doesn't change while it runs.
  let baseline: Promise<DatedGameMetrics[]> | undefined
  /** The baseline's games long enough to count, once it's been read. */
  let loadedBaseline: DatedGameMetrics[] | undefined
  const getBaseline = () => {
    if (!baseline) {
      const loading = loadBaseline()
      baseline = loading
      loading.then(
        games => {
          loadedBaseline = games.filter(isLongEnough)
        },
        () => {},
      )
    }
    return baseline
  }

  let eSkillModel: Promise<ESkillModel | undefined> | undefined
  /** The eSkill model, once it's been fit. */
  let loadedESkillModel: ESkillModel | undefined
  const loadESkillModel = () => {
    eSkillModel ??= getBaseline().then(games => {
      const model = fitESkillModel(games)
      log.info(
        model
          ? `Fit eSkill to ${model.players} ladder players`
          : "The ladder baseline doesn't have enough ranked players to fit eSkill to",
      )
      loadedESkillModel = model
      return model
    })
    return eSkillModel
  }

  /**
   * The user's games, dated, with the replay each is from (`gameKeys`, lined up with `games`) and
   * every replay there's a game from.
   */
  const loadOwnGames = async () => {
    const listings = await gameStatsStore.listMetrics()
    const replayPathKeys = listings.flatMap(l =>
      l.replayPathKey !== undefined ? [l.replayPathKey] : [],
    )
    const gameTimes = await Promise.resolve()
      .then(() => getGameTimes(replayPathKeys))
      .catch((err: unknown) => {
        log.warning(`Couldn't read when replays were played: ${getErrorStack(err)}`)
        return new Map<string, number>()
      })
    const games = listings.map(({ replayPathKey, savedAt, metrics }) => ({
      ...metrics,
      gameTimeMs:
        (replayPathKey !== undefined ? gameTimes.get(replayPathKey) : undefined) ??
        savedAt - metrics.durationMs,
    }))
    return { games, gameKeys: listings.map(l => l.replayPathKey), replayPathKeys }
  }

  const loadGames = async (): Promise<DatedGameMetrics[]> => {
    const [own, baselineGames] = await Promise.all([loadOwnGames(), getBaseline()])
    const ladderGames = await ladderManifests.getGames(own.replayPathKeys).catch((err: unknown) => {
      log.warning(`Couldn't read ladder manifests: ${getErrorStack(err)}`)
      return new Map<string, LadderGame>()
    })
    const ownGames = own.games.map((game, i) => {
      const key = own.gameKeys[i]
      const ladder = key !== undefined ? ladderGames.get(key) : undefined
      return { ...withLadder(game, ladder), gameTimeMs: game.gameTimeMs }
    })
    return [
      ...ownGames,
      ...withoutLibraryCopies(baselineGames, own.replayPathKeys, ownGames),
    ].filter(isLongEnough)
  }

  const ipcMain = new TypedIpcMain()
  ipcMain.handle('myStatsQuery', async (_event, query) => {
    const [games, model] = await Promise.all([loadGames(), loadESkillModel()])
    return computeMyStatsSummary(games, query, Date.now(), model)
  })
  ipcMain.handle('coachQuery', async (_event, query) => computeCoach(await loadGames(), query))
  ipcMain.handle('metaBuildsQuery', async (_event, query) =>
    computeMetaBuilds(await loadGames(), query),
  )

  // Looking up the players in a game happens while it loads: no ladder manifests, which it doesn't
  // need, and no baseline or eSkill model unless something else already read them.
  const scoutGames = new ScoutGames({
    loadOwnGames: async () => {
      const { games, replayPathKeys } = await loadOwnGames()
      return { games: games.filter(isLongEnough), replayPathKeys }
    },
    loadedBaseline: () => loadedBaseline,
    loadedESkillModel: () => loadedESkillModel,
  })
  ipcMain.handle('liveGameScout', (_event, accountLists) => scoutGames.scout(accountLists))

  return {
    /** Lets go of the games read for looking up players, like when a game was just analyzed. */
    forgetScoutGames: () => scoutGames.forget(),
    /**
     * Reads the baseline and fits eSkill ahead of time, so the people in a game the user joins can
     * be scored against the ladder. Best done while no game is loading.
     */
    prepareScouting: () =>
      loadESkillModel().then(
        () => {},
        (err: unknown) => {
          log.warning(`Couldn't get eSkill ready for looking up players: ${getErrorStack(err)}`)
        },
      ),
  }
}
