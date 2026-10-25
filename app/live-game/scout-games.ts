import { ESkillModel } from '../../common/my-stats/eskill'
import { DatedGameMetrics } from '../../common/my-stats/my-stats'
import { computePlayerScout, PlayerScout } from '../../common/my-stats/player-scout'
import {
  BuildPopulation,
  countBuildPopulation,
  mergeBuildPopulations,
} from '../../common/my-stats/playstyle'
import { withoutLibraryCopies } from '../ladder-baseline/load-baseline'

/**
 * How long the user's games, once read, are kept for the next few people to join a lobby. They're
 * let go after, rather than held for a game that may never come.
 */
export const KEEP_GAMES_MS = 30_000

export interface ScoutGamesDeps {
  /** The user's analyzed games, and the replays they're from by lowercased path. */
  loadOwnGames: () => Promise<{ games: DatedGameMetrics[]; replayPathKeys: string[] }>
  /**
   * The ladder games the app ships, if they've been read already. Reading them is a big job, not
   * one to start while the user's game is loading, so they're only used once something else did.
   */
  loadedBaseline: () => ReadonlyArray<DatedGameMetrics> | undefined
  /** The eSkill model, if it's been fit already, for the same reason. */
  loadedESkillModel: () => ESkillModel | undefined
}

type NameIndex = ReadonlyMap<string, ReadonlyArray<DatedGameMetrics>>

/** The games each player name is in, by the name in lower case, each game once per name. */
export function indexByName(games: ReadonlyArray<DatedGameMetrics>): NameIndex {
  const byName = new Map<string, DatedGameMetrics[]>()
  for (const game of games) {
    for (const player of game.players) {
      for (const name of player.names) {
        const key = name.toLowerCase()
        const list = byName.get(key)
        if (!list) {
          byName.set(key, [game])
        } else if (list.at(-1) !== game) {
          list.push(game)
        }
      }
    }
  }
  return byName
}

function gamesOf(index: NameIndex, accounts: ReadonlyArray<string>) {
  return Array.from(new Set(accounts.flatMap(a => index.get(a.toLowerCase()) ?? [])))
}

/**
 * Answers what the analyzed games say about the people in a game, from the user's games and the
 * ladder baseline if it's been read. Looking someone up takes their games from an index by name,
 * not a pass over every game.
 */
export class ScoutGames {
  private own:
    | Promise<{
        byName: NameIndex
        replayPathKeys: ReadonlyArray<string>
        population: BuildPopulation
      }>
    | undefined
  private forgetTimer: ReturnType<typeof setTimeout> | undefined
  /** The baseline's index, made once: the baseline doesn't change while the app runs. */
  private baseline:
    | { games: ReadonlyArray<DatedGameMetrics>; byName: NameIndex; population: BuildPopulation }
    | undefined
  /** Everyone's builds counted together, made once for the user's games and the baseline. */
  private population: { from: unknown[]; population: BuildPopulation } | undefined

  constructor(private readonly deps: ScoutGamesDeps) {}

  async scout(accountLists: ReadonlyArray<ReadonlyArray<string>>): Promise<PlayerScout[]> {
    const own = await this.loadOwn()
    const baseline = this.getBaselineIndex()
    const eSkillModel = this.deps.loadedESkillModel()
    const nowMs = Date.now()
    const population = this.getPopulation(own.population, baseline?.population)
    return accountLists.map(accounts => {
      const ownGames = gamesOf(own.byName, accounts)
      const baselineGames = baseline
        ? withoutLibraryCopies(gamesOf(baseline.byName, accounts), own.replayPathKeys, ownGames)
        : []
      return computePlayerScout(
        [...ownGames, ...baselineGames],
        accounts,
        nowMs,
        eSkillModel,
        population,
      )
    })
  }

  /** Lets go of the user's games, like when newly analyzed ones would change what they say. */
  forget() {
    clearTimeout(this.forgetTimer)
    this.forgetTimer = undefined
    this.own = undefined
  }

  private loadOwn() {
    if (!this.own) {
      const loading = this.deps.loadOwnGames().then(({ games, replayPathKeys }) => ({
        byName: indexByName(games),
        replayPathKeys,
        population: countBuildPopulation(games),
      }))
      this.own = loading
      this.forgetTimer = setTimeout(() => this.forget(), KEEP_GAMES_MS)
      this.forgetTimer.unref?.()
      loading.catch(() => {
        if (this.own === loading) {
          this.forget()
        }
      })
    }
    return this.own
  }

  private getBaselineIndex() {
    const games = this.deps.loadedBaseline()
    if (!games) {
      return undefined
    }
    if (this.baseline?.games !== games) {
      this.baseline = { games, byName: indexByName(games), population: countBuildPopulation(games) }
    }
    return this.baseline
  }

  private getPopulation(own: BuildPopulation, baseline: BuildPopulation | undefined) {
    const from = baseline ? [own, baseline] : [own]
    const cached = this.population
    if (cached?.from.length !== from.length || cached.from.some((p, i) => p !== from[i])) {
      this.population = {
        from,
        population: baseline ? mergeBuildPopulations(own, baseline) : own,
      }
    }
    return this.population!.population
  }
}
