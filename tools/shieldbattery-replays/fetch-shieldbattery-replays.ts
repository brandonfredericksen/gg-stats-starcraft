/**
 * Downloads team game replays from ShieldBattery's best players, for the ladder baseline the app
 * ships: `pnpm run fetch-shieldbattery-replays --out <folder> [--format 3v3] [--type 3v3bgh]
 * [--top 50] [--per-player 40] [--since-days 180] [--everyone [--source ranked] [--pages <n>]]
 * [--max <replays>] [--control <folder>]`. `pnpm run ladder-baseline --team-dir <folder>` runs it
 * for 2v2 and 3v3, then analyzes what it got.
 *
 * For each of the format's ladders, like 3v3 on Big Game Hunters, Hunters and Fastest, it takes the
 * `--top` players by rating and saves up to `--per-player` of their ranked games on that ladder it
 * doesn't have yet, newest first, going back as far as `--since-days`. Running it again goes on
 * further back, and picks up games played since, so each run adds more. Matchmaking puts players
 * of about the same rating together, so their teammates and opponents are strong too. `--type`
 * keeps to one ladder.
 *
 * `--everyone` instead pages through every player's games, newest first, 40 a page, from ranked
 * games or, with `--source all`, public lobby games too. It goes until the list ends, or for
 * `--pages`. Players on the ladder's current season get their rating there. Once a run has been
 * through to the end, later runs only go back as far as the games it looked at.
 *
 * Each replay is saved as `<sha256>.rep`. `shieldbattery-manifest.json` next to them records each
 * one's game, ladder, start time, and players with their ladder rating when the replay was saved.
 * The rated players also go in a `ladder-manifest.json`, which gives them their MMR in the
 * baseline. Games seen before are skipped.
 *
 * It waits while `--control` (the `--out` folder unless given) has a pause file, and stops where
 * it is when it has a stop file, the same files `ladder-baseline` uses.
 *
 * ShieldBattery's terms allow downloading for personal, non-commercial use. It's paced well under
 * the site's limits and waits when the site asks it to. Download links are only good for a day, so
 * each page's replays are saved right after listing it.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import {
  LADDER_MANIFEST_FILE,
  LADDER_MANIFEST_VERSION,
  LadderGame,
  LadderManifest,
} from '../../common/games/ladder'
import { LADDER_PAUSE_FILE, LADDER_STOP_FILE } from '../../common/games/ladder-baseline'
import { AssignedRaceChar } from '../../common/races'

const API = 'https://shieldbattery.net/api/1'
const MANIFEST_FILE = 'shieldbattery-manifest.json'
const MANIFEST_VERSION = 1
/** Listing everyone's games is limited to 20 a minute, so this stays well under it. */
const LIST_INTERVAL_MS = 4000
/** Ladders and match histories are limited to 50 a minute each. */
const HISTORY_INTERVAL_MS = 2000
const DOWNLOAD_INTERVAL_MS = 1000
/** How long to wait when the site says to slow down without saying how long. */
const DEFAULT_RETRY_MS = 60_000
const MAX_ATTEMPTS = 5
/** How far into a list of games the site lets a page start. */
const MAX_OFFSET = 10_000
/** StarCraft: Remastered replays have this at offset 12. */
const REPLAY_MAGIC = 'seRS'
const SOURCES = ['ranked', 'custom', 'all']
/** The matchmaking ladders of each team game format. 4v4 has none. */
const LADDERS: Readonly<Record<string, ReadonlyArray<string>>> = {
  '2v2': ['2v2', '2v2bgh', '2v2hunters', '2v2fastest'],
  '3v3': ['3v3bgh', '3v3hunters', '3v3fastest'],
  '4v4': [],
}

interface ShieldBatteryGame {
  id: string
  /** When the game started, in milliseconds since the epoch. */
  startTime?: number
  config?: {
    gameSourceExtra?: { type?: string }
    teams?: Array<Array<{ id: number; race?: string; isComputer?: boolean }>>
  }
}

interface ShieldBatteryReplay {
  gameId: string
  url: string
  hash: string
}

interface ShieldBatteryUser {
  id: number
  name: string
}

interface GamesResponse {
  games?: ShieldBatteryGame[]
  replays?: ShieldBatteryReplay[]
  users?: ShieldBatteryUser[]
  hasMoreGames?: boolean
}

interface LadderResponse {
  players?: Array<{ userId: number; rating: number }>
  users?: ShieldBatteryUser[]
  season?: { id?: number }
}

interface ManifestPlayer {
  name: string
  race?: string
  team: number
  /** Their rating on the game's ladder when the replay was saved. */
  rating?: number
}

interface ManifestGame {
  gameId: string
  /** The matchmaking type, like `3v3bgh`, or none for a lobby game. */
  type?: string
  /** The ladder's season the game was found in. */
  season?: number
  /** When the game started, in milliseconds since the epoch. */
  startTime?: number
  players?: ManifestPlayer[]
}

interface Manifest {
  version: typeof MANIFEST_VERSION
  /** By replay file name. */
  games: Record<string, ManifestGame>
  /**
   * By `--everyone` list, the start time in milliseconds since the epoch that every game in it
   * started at or before has been looked at.
   */
  listedThrough?: Record<string, number>
}

const { values: args } = parseArgs({
  options: {
    out: { type: 'string' },
    format: { type: 'string', default: '3v3' },
    type: { type: 'string' },
    top: { type: 'string', default: '50' },
    'per-player': { type: 'string', default: '40' },
    'since-days': { type: 'string', default: '180' },
    everyone: { type: 'boolean', default: false },
    source: { type: 'string', default: 'ranked' },
    pages: { type: 'string' },
    max: { type: 'string' },
    control: { type: 'string' },
  },
})

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function writeJson(filePath: string, value: unknown) {
  const temp = `${filePath}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 1))
  // Windows refuses to replace a file another program has open for a moment, like an antivirus
  // scan or the search indexer, so the swap is tried again for a few seconds before giving up.
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(temp, filePath)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt >= 20 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        throw err
      }
      await sleep(250)
    }
  }
}

async function readManifest(filePath: string): Promise<Manifest> {
  if (!existsSync(filePath)) {
    return { version: MANIFEST_VERSION, games: {} }
  }
  const manifest = JSON.parse(await readFile(filePath, 'utf8')) as Partial<Manifest>
  if (manifest.version !== MANIFEST_VERSION || !manifest.games) {
    fail(`${filePath} isn't a manifest this can read.`)
  }
  return manifest as Manifest
}

function isRaceChar(race: string | undefined): race is AssignedRaceChar {
  return race === 'p' || race === 't' || race === 'z'
}

/** The rated players of each game, as the ladder manifest the baseline reads them from. */
function toLadderManifest(manifest: Manifest): LadderManifest {
  const games: Record<string, LadderGame> = {}
  for (const [fileName, game] of Object.entries(manifest.games)) {
    const players = (game.players ?? []).flatMap(p =>
      p.rating
        ? [{ name: p.name, race: isRaceChar(p.race) ? p.race : undefined, mmr: p.rating }]
        : [],
    )
    if (players.length) {
      games[fileName] = {
        matchId: game.gameId,
        createdMs: game.startTime ?? 0,
        season: game.season ?? 0,
        players,
      }
    }
  }
  return { version: LADDER_MANIFEST_VERSION, games }
}

/** Fetches a URL, waiting and trying again when the site asks it to slow down. */
async function fetchPolitely(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: { 'user-agent': 'gg-stats-replay-fetch' } })
    if (response.status !== 429 && response.status < 500) {
      return response
    }
    if (attempt >= MAX_ATTEMPTS) {
      throw new Error(`${url} answered ${response.status} ${attempt} times`)
    }
    const retryAfter = Number(response.headers.get('retry-after'))
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : DEFAULT_RETRY_MS
    console.log(`The site answered ${response.status}. Waiting ${Math.round(waitMs / 1000)}s.`)
    await sleep(waitMs)
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetchPolitely(url)
  if (!response.ok) {
    fail(`${url} answered ${response.status}.`)
  }
  return (await response.json()) as T
}

async function downloadReplay(url: string): Promise<Buffer | undefined> {
  const response = await fetchPolitely(url)
  if (!response.ok) {
    console.log(`Couldn't download a replay: ${response.status}`)
    return undefined
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  return bytes.subarray(12, 16).toString('latin1') === REPLAY_MAGIC ? bytes : undefined
}

/**
 * Waits while the folder has a pause file, and says whether it has a stop file, which ends the run
 * where it is. Everything up to here is saved, so running again picks up from it.
 */
async function shouldStop(dir: string): Promise<boolean> {
  let paused = false
  while (
    existsSync(path.join(dir, LADDER_PAUSE_FILE)) &&
    !existsSync(path.join(dir, LADDER_STOP_FILE))
  ) {
    if (!paused) {
      console.log('Paused.')
      paused = true
    }
    await sleep(1000)
  }
  const stop = existsSync(path.join(dir, LADDER_STOP_FILE))
  if (paused && !stop) {
    console.log('Going on.')
  }
  return stop
}

/** Saves the replays of games not seen before, keeping count of them. */
class ReplaySaver {
  kept = 0
  /** Whether the control folder asked to stop. */
  stopped = false
  private seenGames: Set<string>
  private manifestPath: string

  constructor(
    private outDir: string,
    private manifest: Manifest,
    readonly max: number,
    private controlDir: string,
  ) {
    this.manifestPath = path.join(outDir, MANIFEST_FILE)
    this.seenGames = new Set(Object.values(manifest.games).map(game => game.gameId))
  }

  /** Whether it has kept `max` replays or was asked to stop, after waiting out a pause. */
  async done() {
    if (!this.stopped && this.kept < this.max) {
      this.stopped = await shouldStop(this.controlDir)
    }
    return this.stopped || this.kept >= this.max
  }

  listedThrough(key: string): number | undefined {
    return this.manifest.listedThrough?.[key]
  }

  async setListedThrough(key: string, startMs: number) {
    this.manifest.listedThrough = { ...this.manifest.listedThrough, [key]: startMs }
    await writeJson(this.manifestPath, this.manifest)
  }

  /** Writes the ladder manifest for every replay saved so far. */
  async writeLadderManifest() {
    await writeJson(path.join(this.outDir, LADDER_MANIFEST_FILE), toLadderManifest(this.manifest))
  }

  /**
   * Saves up to `limit` of a page's games' replays, each game's players named from `names` and
   * rated from its ladder's `ratings` when they're there, and returns how many it saved.
   */
  async savePage(
    list: GamesResponse,
    keep: (game: ShieldBatteryGame) => boolean,
    names: ReadonlyMap<number, string>,
    {
      ladders = new Map(),
      limit = Infinity,
    }: {
      ladders?: ReadonlyMap<string, LadderRatings>
      limit?: number
    } = {},
  ) {
    const replays = new Map((list.replays ?? []).map(replay => [replay.gameId, replay]))
    let saved = 0
    for (const game of list.games ?? []) {
      const replay = replays.get(game.id)
      if (saved >= limit || (await this.done())) {
        break
      }
      if (this.seenGames.has(game.id) || !replay || !keep(game)) {
        continue
      }
      this.seenGames.add(game.id)
      const fileName = `${replay.hash.toLowerCase()}.rep`
      if (this.manifest.games[fileName]) {
        continue
      }
      const bytes = await downloadReplay(replay.url)
      await sleep(DOWNLOAD_INTERVAL_MS)
      if (!bytes) {
        continue
      }
      const type = game.config?.gameSourceExtra?.type
      const ladder = type ? ladders.get(type) : undefined
      const ratings = ladder?.ratings ?? new Map<number, number>()
      const season = ladder?.season
      const players = (game.config?.teams ?? []).flatMap((team, i) =>
        team
          .filter(p => !p.isComputer)
          .map(p => ({
            name: names.get(p.id) ?? String(p.id),
            race: p.race,
            team: i,
            rating: ratings.get(p.id),
          })),
      )
      await writeFile(path.join(this.outDir, fileName), bytes)
      this.manifest.games[fileName] = {
        gameId: game.id,
        type,
        season,
        startTime: game.startTime,
        players,
      }
      await writeJson(this.manifestPath, this.manifest)
      this.kept += 1
      saved += 1
      const date = game.startTime ? new Date(game.startTime).toISOString().slice(0, 10) : '?'
      const rated = players.flatMap(p => (p.rating ? [Math.round(p.rating)] : []))
      console.log(
        `${this.kept}: ${type ?? 'lobby'} game from ${date}` +
          (rated.length ? `, rated ${rated.join(' ')}` : ''),
      )
    }
    return saved
  }
}

/** A ladder's rated players this season. */
interface LadderRatings {
  /** By user id. */
  ratings: Map<number, number>
  names: Map<number, string>
  season?: number
}

async function getLadder(type: string): Promise<LadderRatings> {
  const ladder = await getJson<LadderResponse>(`${API}/ladder/${type}`)
  await sleep(HISTORY_INTERVAL_MS)
  return {
    ratings: new Map(
      (ladder.players ?? []).filter(p => p.rating > 0).map(p => [p.userId, p.rating]),
    ),
    names: new Map((ladder.users ?? []).map(user => [user.id, user.name])),
    season: ladder.season?.id,
  }
}

/** Saves ranked games of each ladder's best players that aren't saved yet. */
async function fetchFromLadders(saver: ReplaySaver, format: string, types: ReadonlyArray<string>) {
  const top = Number(args.top)
  const perPlayer = Number(args['per-player'])
  const sinceMs = Date.now() - Number(args['since-days']) * 24 * 60 * 60_000
  if (!(top > 0) || !(perPlayer > 0) || Number.isNaN(sinceMs)) {
    fail('--top, --per-player and --since-days are how many players, games and days to take.')
  }
  for (const type of types) {
    const ladder = await getLadder(type)
    const ladders = new Map([[type, ladder]])
    const names = ladder.names
    const best = Array.from(ladder.ratings)
      .sort(([, a], [, b]) => b - a)
      .slice(0, top)
    if (!best.length) {
      console.log(`${type}: no rated players this season.`)
      continue
    }
    console.log(
      `\n${type}: ${best.length} players rated ${Math.round(best.at(-1)![1])} to ` +
        `${Math.round(best[0][1])}.`,
    )
    for (const [userId] of best) {
      let saved = 0
      for (let offset = 0; saved < perPlayer && offset <= MAX_OFFSET;) {
        if (await saver.done()) {
          return
        }
        const query = new URLSearchParams({
          ranked: 'true',
          custom: 'false',
          format,
          offset: String(offset),
          startDate: String(sinceMs),
        })
        const history = await getJson<GamesResponse>(
          `${API}/users/${userId}/match-history?${query}`,
        )
        await sleep(HISTORY_INTERVAL_MS)
        for (const user of history.users ?? []) {
          names.set(user.id, user.name)
        }
        const games = history.games ?? []
        saved += await saver.savePage(
          history,
          game => game.config?.gameSourceExtra?.type === type,
          names,
          { ladders, limit: perPlayer - saved },
        )
        if (!history.hasMoreGames || !games.length) {
          break
        }
        offset += games.length
      }
    }
  }
}

/** Saves every player's games, newest first, page by page. */
async function fetchEveryone(saver: ReplaySaver, format: string, types: ReadonlyArray<string>) {
  const source = args.source!
  const pages = args.pages !== undefined ? Number(args.pages) : Infinity
  if (!SOURCES.includes(source)) {
    fail(`--source is one of ${SOURCES.join(', ')}.`)
  }
  if (!(pages > 0)) {
    fail('--pages is how many pages of 40 games to look through.')
  }
  // Lobby games have no ladder, so only ranked games get ratings.
  const ladders = new Map<string, LadderRatings>()
  if (source !== 'custom') {
    for (const type of types) {
      ladders.set(type, await getLadder(type))
    }
  }
  const keep = (game: ShieldBatteryGame) =>
    !args.type || game.config?.gameSourceExtra?.type === args.type
  const listKey = [format, source, args.type ?? ''].join('/')
  const listedThrough = saver.listedThrough(listKey)
  /** The newest game's start time, which this run looks at every game up to once it's done. */
  let newestMs: number | undefined
  let offset = 0
  for (let page = 0; page < pages; page++) {
    if (await saver.done()) {
      return
    }
    const query = new URLSearchParams({
      sort: 'latest',
      format,
      offset: String(offset),
      ...(source !== 'all' ? { source } : {}),
    })
    const list = await getJson<GamesResponse>(`${API}/games/list?${query}`)
    const names = new Map((list.users ?? []).map(user => [user.id, user.name]))
    const games = list.games ?? []
    newestMs ??= games[0]?.startTime
    await saver.savePage(list, keep, names, { ladders })
    if (saver.stopped) {
      return
    }
    const oldestMs = games.at(-1)?.startTime
    const reachedListed =
      listedThrough !== undefined && oldestMs !== undefined && oldestMs <= listedThrough
    if (!list.hasMoreGames || !games.length || reachedListed) {
      if (reachedListed) {
        console.log('Reached the games a run before looked at.')
      }
      if (newestMs !== undefined) {
        await saver.setListedThrough(listKey, newestMs)
      }
      break
    }
    offset += games.length
    await sleep(LIST_INTERVAL_MS)
  }
}

async function main() {
  const outDir = args.out ? path.resolve(args.out) : fail('Say where to save them with --out.')
  const format = args.format!
  const ladders = LADDERS[format] ?? fail(`--format is one of ${Object.keys(LADDERS).join(', ')}.`)
  const types = args.type ? [args.type] : ladders
  if (!args.everyone && !types.length) {
    fail(`${format} has no ladder. Use --everyone to take anyone's games.`)
  }
  if (args.type && !ladders.includes(args.type)) {
    fail(`${args.type} isn't a ${format} ladder. They are ${ladders.join(', ')}.`)
  }
  await mkdir(outDir, { recursive: true })
  const manifest = await readManifest(path.join(outDir, MANIFEST_FILE))
  const saver = new ReplaySaver(
    outDir,
    manifest,
    args.max ? Number(args.max) : Infinity,
    args.control ? path.resolve(args.control) : outDir,
  )
  // Written first too, for replays saved before the ladder manifest was.
  await saver.writeLadderManifest()
  try {
    if (args.everyone) {
      await fetchEveryone(saver, format, types)
    } else {
      await fetchFromLadders(saver, format, types)
    }
  } finally {
    await saver.writeLadderManifest()
  }
  console.log(
    `\n${saver.stopped ? 'Stopped. ' : ''}Kept ${saver.kept} new replays, ` +
      `${Object.keys(manifest.games).length} in all.`,
  )
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
