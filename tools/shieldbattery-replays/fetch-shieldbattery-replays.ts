/**
 * Downloads recent team game replays from ShieldBattery, for the team game meta to learn from:
 * `pnpm run fetch-shieldbattery-replays --out <folder> [--format 3v3] [--type 3v3bgh]
 * [--source ranked] [--player <name>] [--pages 10] [--max <replays>]`. Add the folder to GG Stats' replay folders
 * and it analyzes them like any other replays.
 *
 * It pages through ShieldBattery's public list of games, newest first, 40 games a page, and saves
 * each replay it's allowed to download as `<sha256>.rep`. `--type` keeps only one matchmaking
 * type, like `3v3bgh`, `3v3fastest` or `2v2bgh`; `--source all` adds public lobby games, which
 * have no type. `shieldbattery-manifest.json` next to the replays records each one's game, type
 * and start time, and games seen before are skipped, so running it again only adds new ones.
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
/** Listing games is limited to 20 a minute, so this stays well under it. */
const LIST_INTERVAL_MS = 4000
const DOWNLOAD_INTERVAL_MS = 1000
/** How long to wait when the site says to slow down without saying how long. */
const DEFAULT_RETRY_MS = 60_000
const MAX_ATTEMPTS = 5
/** StarCraft: Remastered replays have this at offset 12. */
const REPLAY_MAGIC = 'seRS'
const FORMATS = ['2v2', '3v3', '4v4']
const SOURCES = ['ranked', 'custom', 'all']

interface ShieldBatteryGame {
  id: string
  /** When the game started, in milliseconds since the epoch. */
  startTime?: number
  config?: { gameSourceExtra?: { type?: string } }
}

interface ShieldBatteryReplay {
  gameId: string
  url: string
  hash: string
}

interface GamesResponse {
  games?: ShieldBatteryGame[]
  replays?: ShieldBatteryReplay[]
  hasMoreGames?: boolean
}

interface ManifestGame {
  gameId: string
  /** The matchmaking type, like `3v3bgh`, or none for a lobby game. */
  type?: string
  /** When the game started, in milliseconds since the epoch. */
  startTime?: number
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
    source: { type: 'string', default: 'ranked' },
    player: { type: 'string' },
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

async function downloadReplay(url: string): Promise<Buffer | undefined> {
  const response = await fetchPolitely(url)
  if (!response.ok) {
    console.log(`Couldn't download a replay: ${response.status}`)
    return undefined
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  return bytes.subarray(12, 16).toString('latin1') === REPLAY_MAGIC ? bytes : undefined
}

async function main() {
  const outDir = args.out ? path.resolve(args.out) : fail('Say where to save them with --out.')
  const format = args.format!
  const source = args.source!
  const pages = Number(args.pages)
  const max = args.max ? Number(args.max) : Infinity
  if (!FORMATS.includes(format)) {
    fail(`--format is one of ${FORMATS.join(', ')}.`)
  }
  if (!SOURCES.includes(source)) {
    fail(`--source is one of ${SOURCES.join(', ')}.`)
  }
  if (!(pages > 0)) {
    fail('--pages is how many pages of 40 games to look through.')
  }
  await mkdir(outDir, { recursive: true })
  const manifestPath = path.join(outDir, MANIFEST_FILE)
  const manifest = await readManifest(manifestPath)
  const seenGames = new Set(Object.values(manifest.games).map(game => game.gameId))

  let kept = 0
  let offset = 0
  for (let page = 0; page < pages && kept < max; page++) {
    const query = new URLSearchParams({
      sort: 'latest',
      format,
      offset: String(offset),
      ...(source !== 'all' ? { source } : {}),
      ...(args.player ? { playerName: args.player } : {}),
    })
    const response = await fetchPolitely(`${API}/games/list?${query}`)
    if (!response.ok) {
      fail(`Listing games answered ${response.status}.`)
    }
    const list = (await response.json()) as GamesResponse
    const games = list.games ?? []
    offset += games.length
    const replays = new Map((list.replays ?? []).map(replay => [replay.gameId, replay]))
    for (const game of games) {
      if (kept >= max) {
        break
      }
      const type = game.config?.gameSourceExtra?.type
      const replay = replays.get(game.id)
      if (seenGames.has(game.id) || !replay || (args.type && type !== args.type)) {
        continue
      }
      const fileName = `${replay.hash.toLowerCase()}.rep`
      seenGames.add(game.id)
      if (manifest.games[fileName]) {
        continue
      }
      const bytes = await downloadReplay(replay.url)
      await sleep(DOWNLOAD_INTERVAL_MS)
      if (!bytes) {
        continue
      }
      await writeFile(path.join(outDir, fileName), bytes)
      manifest.games[fileName] = { gameId: game.id, type, startTime: game.startTime }
      await writeJson(manifestPath, manifest)
      kept += 1
      const date = game.startTime ? new Date(game.startTime).toISOString().slice(0, 10) : '?'
      console.log(`${kept}: ${type ?? 'lobby'} game from ${date}`)
    }
    if (!list.hasMoreGames || !games.length || kept >= max) {
      break
    }
    await sleep(LIST_INTERVAL_MS)
  }

  console.log(`\nKept ${kept} new replays, ${Object.keys(manifest.games).length} in all.`)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
