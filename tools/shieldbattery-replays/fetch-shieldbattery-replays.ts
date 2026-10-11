/**
 * Downloads team game replays from ShieldBattery's best players, for the team game meta to learn
 * from: `pnpm run fetch-shieldbattery-replays --out <folder> [--format 3v3] [--type 3v3bgh]
 * [--top 50] [--per-player 40] [--max <replays>]`. Add the folder to GG Stats' replay folders and
 * it analyzes them like any other replays.
 *
 * For each of the format's ladders, like 3v3 on Big Game Hunters, Hunters and Fastest, it takes the
 * `--top` players by rating and saves the replays of their latest `--per-player` ranked games on
 * that ladder. Matchmaking puts players of about the same rating together, so their teammates and
 * opponents are strong too. `--type` keeps to one ladder. `--everyone` instead pages through the
 * newest games of every player, `--pages` of 40, from ranked games or, with `--source all`, public
 * lobby games too.
 *
 * Each replay is saved as `<sha256>.rep`. `shieldbattery-manifest.json` next to them records each
 * one's game, ladder, start time, and players with their ladder rating when it's known. Games seen
 * before are skipped, so running it again only adds new ones.
 *
 * ShieldBattery's terms allow downloading for personal, non-commercial use, which analyzing them
 * locally is. It's paced well under the site's limits and waits when the site asks it to. Download
 * links are only good for a day, so each page's replays are saved right after listing it.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'

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
  /** When the game started, in milliseconds since the epoch. */
  startTime?: number
  players?: ManifestPlayer[]
}

interface Manifest {
  version: typeof MANIFEST_VERSION
  /** By replay file name. */
  games: Record<string, ManifestGame>
}

const { values: args } = parseArgs({
  options: {
    out: { type: 'string' },
    format: { type: 'string', default: '3v3' },
    type: { type: 'string' },
    top: { type: 'string', default: '50' },
    'per-player': { type: 'string', default: '40' },
    everyone: { type: 'boolean', default: false },
    source: { type: 'string', default: 'ranked' },
    pages: { type: 'string', default: '10' },
    max: { type: 'string' },
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

/** Saves the replays of games not seen before, keeping count of them. */
class ReplaySaver {
  kept = 0
  private seenGames: Set<string>

  constructor(
    private outDir: string,
    private manifestPath: string,
    private manifest: Manifest,
    readonly max: number,
  ) {
    this.seenGames = new Set(Object.values(manifest.games).map(game => game.gameId))
  }

  get full() {
    return this.kept >= this.max
  }

  /**
   * Saves a page of games' replays, each game's players named from `names` and rated from
   * `ratings` when they're there.
   */
  async savePage(
    list: GamesResponse,
    keep: (game: ShieldBatteryGame) => boolean,
    names: ReadonlyMap<number, string>,
    ratings: ReadonlyMap<number, number> = new Map(),
  ) {
    const replays = new Map((list.replays ?? []).map(replay => [replay.gameId, replay]))
    for (const game of list.games ?? []) {
      const replay = replays.get(game.id)
      if (this.full || this.seenGames.has(game.id) || !replay || !keep(game)) {
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
      this.manifest.games[fileName] = { gameId: game.id, type, startTime: game.startTime, players }
      await writeJson(this.manifestPath, this.manifest)
      this.kept += 1
      const date = game.startTime ? new Date(game.startTime).toISOString().slice(0, 10) : '?'
      const rated = players.flatMap(p => (p.rating ? [Math.round(p.rating)] : []))
      console.log(
        `${this.kept}: ${type ?? 'lobby'} game from ${date}` +
          (rated.length ? `, rated ${rated.join(' ')}` : ''),
      )
    }
  }
}

/** Saves the latest ranked games of each ladder's best players. */
async function fetchFromLadders(saver: ReplaySaver, format: string, types: ReadonlyArray<string>) {
  const top = Number(args.top)
  const perPlayer = Number(args['per-player'])
  if (!(top > 0) || !(perPlayer > 0)) {
    fail('--top and --per-player are how many players, and games of each, to take.')
  }
  for (const type of types) {
    const ladder = await getJson<LadderResponse>(`${API}/ladder/${type}`)
    await sleep(HISTORY_INTERVAL_MS)
    const ratings = new Map(
      (ladder.players ?? []).filter(p => p.rating > 0).map(p => [p.userId, p.rating]),
    )
    const names = new Map((ladder.users ?? []).map(user => [user.id, user.name]))
    const best = Array.from(ratings)
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
      let looked = 0
      for (let offset = 0; looked < perPlayer && !saver.full;) {
        const query = new URLSearchParams({
          ranked: 'true',
          custom: 'false',
          format,
          offset: String(offset),
        })
        const history = await getJson<GamesResponse>(
          `${API}/users/${userId}/match-history?${query}`,
        )
        await sleep(HISTORY_INTERVAL_MS)
        for (const user of history.users ?? []) {
          names.set(user.id, user.name)
        }
        const games = history.games ?? []
        const ofLadder = games
          .filter(game => game.config?.gameSourceExtra?.type === type)
          .slice(0, perPlayer - looked)
        looked += ofLadder.length
        const keep = new Set(ofLadder.map(game => game.id))
        await saver.savePage(history, game => keep.has(game.id), names, ratings)
        if (!history.hasMoreGames || !games.length) {
          break
        }
        offset += games.length
      }
    }
  }
}

/** Saves the newest games of every player, page by page. */
async function fetchEveryone(saver: ReplaySaver, format: string) {
  const source = args.source!
  const pages = Number(args.pages)
  if (!SOURCES.includes(source)) {
    fail(`--source is one of ${SOURCES.join(', ')}.`)
  }
  if (!(pages > 0)) {
    fail('--pages is how many pages of 40 games to look through.')
  }
  let offset = 0
  for (let page = 0; page < pages && !saver.full; page++) {
    const query = new URLSearchParams({
      sort: 'latest',
      format,
      offset: String(offset),
      ...(source !== 'all' ? { source } : {}),
    })
    const list = await getJson<GamesResponse>(`${API}/games/list?${query}`)
    const names = new Map((list.users ?? []).map(user => [user.id, user.name]))
    await saver.savePage(
      list,
      game => !args.type || game.config?.gameSourceExtra?.type === args.type,
      names,
    )
    if (!list.hasMoreGames || !list.games?.length) {
      break
    }
    offset += list.games.length
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
  const manifestPath = path.join(outDir, MANIFEST_FILE)
  const manifest = await readManifest(manifestPath)
  const saver = new ReplaySaver(
    outDir,
    manifestPath,
    manifest,
    args.max ? Number(args.max) : Infinity,
  )
  if (args.everyone) {
    await fetchEveryone(saver, format)
  } else {
    await fetchFromLadders(saver, format, types)
  }
  console.log(`\nKept ${saver.kept} new replays, ${Object.keys(manifest.games).length} in all.`)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
