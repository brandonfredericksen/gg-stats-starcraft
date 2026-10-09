/**
 * Downloads recent 1v1 ladder replays from players of every rank, for other players' numbers to
 * compare with: `pnpm run fetch-ladder-replays --out <folder> [--per-cell 40] [--per-map 25]
 * [--pages 40] [--port <port>] [--season <season>]`. It asks the StarCraft: Remastered that's
 * running and logged in, and has Battle.net start it when it isn't running or stops answering, so a
 * run left alone gets past a crash.
 *
 * It samples players from across the season's global leaderboard, looks through their latest
 * games and keeps the ones that fill something short of games: a matchup at a rank (PvT at C, say)
 * with fewer than `--per-cell`, or a matchup on a map with fewer than `--per-map`, at any rank. It
 * goes until every one is full or it runs out of players. Each replay is saved as `<md5>.rep`, and
 * `ladder-manifest.json` next to them records the map and both players' MMR and rank going into
 * the game. It picks up where it left off, from `fetch-state.json` in the same folder.
 *
 * Only the season's own games count toward the targets, so running it again in a new season adds
 * a full set for that season to the same folder. Ladder replays are only kept for about a month,
 * so this only ever finds recent games.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import {
  LADDER_MANIFEST_FILE,
  LADDER_MANIFEST_VERSION,
  LADDER_RANKS,
  LadderGame,
  LadderManifest,
  LadderPlayer,
  LadderRank,
  parseLadderManifest,
  rankFromBucket,
} from '../../common/games/ladder'
import { LADDER_PAUSE_FILE, LADDER_STOP_FILE } from '../../common/games/ladder-baseline'
import { getMapDisplayName, getMapKey } from '../../common/games/map-family'
import { AssignedRaceChar } from '../../common/races'
import { Bridge, ServerError } from './bridge'

const STATE_FILE = 'fetch-state.json'
const GAME_MODE_1V1 = 1
const PAGE_LENGTH = 100
const HISTORY_LENGTH = 15
const DOWNLOAD_INTERVAL_MS = 1000
const REPLAY_HOSTS = ['storage.googleapis.com', 's3-us-west-1.amazonaws.com']
/** StarCraft: Remastered replays have this at offset 12. */
const REPLAY_MAGIC = 'seRS'

interface SampledPlayer {
  toon: string
  gateway: number
  rank: LadderRank
}

interface FetchState {
  season: number
  players: SampledPlayer[]
  /** `toon@gateway` of each player whose games were looked through. */
  queried: string[]
  /** Matches already looked at, kept or not. */
  seenMatches: string[]
}

interface BridgePlayer {
  name?: string
  gateway_id?: number
  score?: { base?: number; bucket_old?: number }
  info_attributes?: { race?: string }
  game_result?: Record<string, { attributes?: { race?: string } } | undefined>
  game_info?: { attributes?: { map_name?: string } }
}

interface BridgeMatch {
  match_created?: string
  players?: Array<Record<string, BridgePlayer>>
}

interface BridgeReplay {
  url?: string
  md5?: string
  attributes?: { replay_humans?: string }
}

const { values: args } = parseArgs({
  options: {
    out: { type: 'string' },
    'per-cell': { type: 'string', default: '40' },
    'per-map': { type: 'string', default: '25' },
    pages: { type: 'string', default: '40' },
    port: { type: 'string' },
    season: { type: 'string' },
  },
})

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function toRaceChar(race: string | undefined): AssignedRaceChar | undefined {
  switch (race?.toLowerCase()) {
    case 'protoss':
      return 'p'
    case 'terran':
      return 't'
    case 'zerg':
      return 'z'
    default:
      return undefined
  }
}

async function writeJson(filePath: string, value: unknown) {
  const temp = `${filePath}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 1))
  await rename(temp, filePath)
}

async function readJson(filePath: string): Promise<unknown> {
  return existsSync(filePath) ? JSON.parse(await readFile(filePath, 'utf8')) : undefined
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/** A matchup at a rank, from one player's side: `ptc` is a Protoss at C playing a Terran. */
function cellOf(player: LadderPlayer, opponent: LadderPlayer): string | undefined {
  return player.race && opponent.race && player.rank
    ? `${player.race}${opponent.race}${player.rank}`
    : undefined
}

function cellsOf(game: LadderGame): string[] {
  const [a, b] = game.players
  return [cellOf(a, b), cellOf(b, a)].filter((c): c is string => !!c)
}

const MATCHUPS = ['pp', 'pt', 'pz', 'tp', 'tt', 'tz', 'zp', 'zt', 'zz']

/** A matchup on a map, at any rank, from both players' sides: `pt@polypoid`. */
function mapCellsOf(game: LadderGame): string[] {
  const [a, b] = game.players
  if (!game.mapName || !a.race || !b.race) {
    return []
  }
  const map = getMapKey(game.mapName)
  return [`${a.race}${b.race}@${map}`, `${b.race}${a.race}@${map}`]
}

/** Map titles carry color codes, which are control characters. */
function cleanMapName(name: string | undefined) {
  // oxlint-disable-next-line no-control-regex
  return name?.replace(/[\u0000-\u001f]/g, '').trim() || undefined
}

async function findLeaderboard(bridge: Bridge, season?: number) {
  const list = (await bridge.get('web-api/v1/leaderboard')) as {
    matchmaked_current_season?: number
    leaderboards?: Record<
      string,
      { id: number; gamemode_id: number; gateway_id: number; season_id: number }
    >
  }
  const wanted = season ?? list.matchmaked_current_season
  const board = Object.values(list.leaderboards ?? {}).find(
    b => b.gamemode_id === GAME_MODE_1V1 && b.gateway_id === 0 && b.season_id === wanted,
  )
  if (!board || wanted === undefined) {
    fail(`Couldn't find the global 1v1 leaderboard for season ${wanted}.`)
  }
  return { id: board.id, season: wanted }
}

async function getLeaderboardRows(bridge: Bridge, id: number, offset: number, length: number) {
  const page = (await bridge.get(
    `web-api/v1/leaderboard/${id}?offset=${offset}&length=${length}`,
  )) as {
    rows?: Array<
      [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        string,
        string,
        string,
        string,
        number,
        number,
      ]
    >
  }
  return page.rows ?? []
}

/** How many players the leaderboard has, found by probing for its end. */
async function countLeaderboard(bridge: Bridge, id: number) {
  let low = 0
  let high = PAGE_LENGTH
  while ((await getLeaderboardRows(bridge, id, high, 1)).length) {
    low = high
    high *= 2
  }
  while (high - low > PAGE_LENGTH) {
    const mid = Math.floor((low + high) / 2)
    if ((await getLeaderboardRows(bridge, id, mid, 1)).length) {
      low = mid
    } else {
      high = mid
    }
  }
  return high
}

async function samplePlayers(bridge: Bridge, id: number, pages: number): Promise<SampledPlayer[]> {
  const total = await countLeaderboard(bridge, id)
  console.log(`The leaderboard has about ${total} players. Sampling ${pages} pages of it.`)
  // Spread from the top page to the last one, since F is only found at the very bottom.
  const last = Math.max(0, total - PAGE_LENGTH)
  const offsets = new Set(
    Array.from({ length: pages }, (_, i) => (pages > 1 ? Math.round((last * i) / (pages - 1)) : 0)),
  )
  const players: SampledPlayer[] = []
  for (const offset of offsets) {
    for (const row of await getLeaderboardRows(bridge, id, offset, PAGE_LENGTH)) {
      const rank = rankFromBucket(row[12])
      if (rank) {
        players.push({ toon: row[7], gateway: row[2], rank })
      }
    }
  }
  return players
}

function toLadderGame(matchId: string, match: BridgeMatch, season: number): LadderGame | undefined {
  const players = (match.players ?? []).flatMap(record => Object.values(record))
  if (players.length !== 2) {
    return undefined
  }
  // Any player's results say what race everyone ended up as, which matters for Random players.
  const results = Object.assign({}, ...players.map(p => p.game_result ?? {})) as NonNullable<
    BridgePlayer['game_result']
  >
  const ladderPlayers = players.map((p): LadderPlayer | undefined =>
    p.name && p.score?.base !== undefined
      ? {
          name: p.name,
          race: toRaceChar(results[p.name]?.attributes?.race ?? p.info_attributes?.race),
          mmr: p.score.base,
          rank: rankFromBucket(p.score.bucket_old),
        }
      : undefined,
  )
  if (ladderPlayers.some(p => !p)) {
    return undefined
  }
  const mapName = players.find(p => p.game_info?.attributes?.map_name)?.game_info?.attributes
    ?.map_name
  return {
    matchId,
    createdMs: Number(match.match_created) * 1000,
    season,
    mapName: cleanMapName(mapName),
    players: ladderPlayers as LadderPlayer[],
  }
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

/**
 * Gets a path, or nothing when the server keeps failing on it, so one player's or game's bad answer
 * is skipped rather than ending a run left alone.
 */
async function getOrSkip(bridge: Bridge, apiPath: string): Promise<unknown> {
  try {
    return await bridge.get(apiPath)
  } catch (err) {
    if (err instanceof ServerError) {
      console.warn(`Skipping it: ${err.message}`)
      return undefined
    }
    throw err
  }
}

/** Downloads a replay the bridge links to, if it's still there and really is a replay. */
async function downloadReplay(url: string): Promise<Uint8Array | undefined> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !REPLAY_HOSTS.includes(parsed.host)) {
    console.warn(`Skipping a replay on an unexpected host: ${parsed.host}`)
    return undefined
  }
  await sleep(DOWNLOAD_INTERVAL_MS)
  let bytes: Uint8Array
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) {
      return undefined
    }
    bytes = await res.bytes()
  } catch (err) {
    // The next game will do, rather than ending a run left alone over one download.
    console.warn(`Couldn't download ${url}: ${String(err)}`)
    return undefined
  }
  const magic = new TextDecoder().decode(bytes.subarray(12, 16))
  return magic === REPLAY_MAGIC ? bytes : undefined
}

function countCells(games: ReadonlyArray<LadderGame>) {
  const counts = new Map<string, number>()
  for (const game of games) {
    for (const cell of [...cellsOf(game), ...mapCellsOf(game)]) {
      counts.set(cell, (counts.get(cell) ?? 0) + 1)
    }
  }
  return counts
}

function printSummary(games: ReadonlyArray<LadderGame>, perCell: number, perMap: number) {
  const counts = countCells(games)
  const mmrs = new Map<LadderRank, number[]>()
  for (const game of games) {
    for (const p of game.players) {
      if (p.rank) {
        mmrs.set(p.rank, [...(mmrs.get(p.rank) ?? []), p.mmr])
      }
    }
  }
  console.log(`\nGames per matchup and rank (target ${perCell}):`)
  const races: AssignedRaceChar[] = ['p', 't', 'z']
  console.log(`      ${LADDER_RANKS.map(r => r.toUpperCase().padStart(4)).join('')}`)
  for (const race of races) {
    for (const opp of races) {
      const row = LADDER_RANKS.map(r => String(counts.get(`${race}${opp}${r}`) ?? 0).padStart(4))
      console.log(`  ${race.toUpperCase()}v${opp.toUpperCase()}${row.join('')}`)
    }
  }
  console.log('\nMMR seen at each rank:')
  for (const rank of LADDER_RANKS) {
    const values = mmrs.get(rank)
    if (values?.length) {
      console.log(`  ${rank.toUpperCase()}: ${Math.min(...values)} to ${Math.max(...values)}`)
    }
  }
  const maps = new Map<string, string>()
  for (const game of games) {
    if (game.mapName) {
      maps.set(getMapKey(game.mapName), getMapDisplayName(game.mapName))
    }
  }
  console.log(`\nGames per map and matchup, any rank (target ${perMap}):`)
  const width = Math.max(0, ...Array.from(maps.values(), name => name.length))
  const header = MATCHUPS.map(m => `${m[0]}v${m[1]}`.toUpperCase().padStart(5)).join('')
  console.log(`  ${''.padEnd(width)}${header}`)
  for (const [key, name] of maps) {
    const row = MATCHUPS.map(m => String(counts.get(`${m}@${key}`) ?? 0).padStart(5))
    console.log(`  ${name.padEnd(width)}${row.join('')}`)
  }
}

async function main() {
  if (!args.out) {
    fail('Pass the folder to download to with --out.')
  }
  const outDir = path.resolve(args.out)
  const perCell = Number(args['per-cell'])
  const perMap = Number(args['per-map'])
  const pages = Number(args.pages)
  await mkdir(outDir, { recursive: true })

  const manifestPath = path.join(outDir, LADDER_MANIFEST_FILE)
  const statePath = path.join(outDir, STATE_FILE)
  const manifest: LadderManifest = parseLadderManifest(await readJson(manifestPath)) ?? {
    version: LADDER_MANIFEST_VERSION,
    games: {},
  }

  const bridge = await Bridge.connect(args.port !== undefined ? Number(args.port) : undefined)
  console.log(`Connected to StarCraft on port ${bridge.port}.`)
  const board = await findLeaderboard(bridge, args.season ? Number(args.season) : undefined)

  let state = (await readJson(statePath)) as FetchState | undefined
  if (state?.season !== board.season) {
    state = {
      season: board.season,
      players: await samplePlayers(bridge, board.id, pages),
      queried: [],
      seenMatches: [],
    }
    await writeJson(statePath, state)
  }
  const queried = new Set(state.queried)
  const seenMatches = new Set([
    ...state.seenMatches,
    ...Object.values(manifest.games).map(g => g.matchId),
  ])

  const season = state.season
  const seasonGames = () => Object.values(manifest.games).filter(g => g.season === season)
  const counts = countCells(seasonGames())
  const needs = (cell: string) => (counts.get(cell) ?? 0) < (cell.includes('@') ? perMap : perCell)
  const rankNeeds = (rank: LadderRank) => MATCHUPS.some(m => needs(`${m}${rank}`))
  // The season's maps, as they show up in anyone's games, whether those were kept or not.
  const maps = new Set(seasonGames().flatMap(g => (g.mapName ? [getMapKey(g.mapName)] : [])))
  const mapNeeds = () => Array.from(maps).some(map => MATCHUPS.some(m => needs(`${m}@${map}`)))

  // Players are taken a rank at a time, in turn, so every rank fills up together.
  const queues = new Map<LadderRank, SampledPlayer[]>(
    LADDER_RANKS.map(rank => [
      rank,
      shuffle(state.players.filter(p => p.rank === rank && !queried.has(`${p.toon}@${p.gateway}`))),
    ]),
  )
  let kept = 0
  let stopped = false
  while (!stopped) {
    const ranks = LADDER_RANKS.filter(
      rank => (rankNeeds(rank) || mapNeeds()) && queues.get(rank)!.length,
    )
    if (!ranks.length) {
      break
    }
    for (const rank of ranks) {
      stopped = await shouldStop(outDir)
      if (stopped) {
        break
      }
      const player = queues.get(rank)!.pop()!
      const history = (await getOrSkip(
        bridge,
        `web-api/v1/matchmaker-gameinfo-by-toon/${encodeURIComponent(player.toon)}/${player.gateway}/${GAME_MODE_1V1}/${state.season}?offset=0&limit=${HISTORY_LENGTH}`,
      )) as Array<Record<string, BridgeMatch>> | undefined
      for (const [matchId, match] of (Array.isArray(history) ? history : []).flatMap(entry =>
        Object.entries(entry),
      )) {
        if (seenMatches.has(matchId)) {
          continue
        }
        seenMatches.add(matchId)
        const game = toLadderGame(matchId, match, state.season)
        if (game?.mapName) {
          maps.add(getMapKey(game.mapName))
        }
        if (!game || ![...cellsOf(game), ...mapCellsOf(game)].some(needs)) {
          continue
        }
        stopped = await shouldStop(outDir)
        if (stopped) {
          break
        }
        const info = (await getOrSkip(
          bridge,
          `web-api/v1/matchmaker-gameinfo-playerinfo/${encodeURIComponent(matchId)}`,
        )) as { replays?: BridgeReplay[] } | undefined
        const replay = (info?.replays ?? []).find(
          r => r.url && /^[0-9a-f]{32}$/i.test(r.md5 ?? '') && r.attributes?.replay_humans === '2',
        )
        const bytes = replay && (await downloadReplay(replay.url!))
        if (!bytes) {
          continue
        }
        const fileName = `${replay!.md5!.toLowerCase()}.rep`
        await writeFile(path.join(outDir, fileName), bytes)
        manifest.games[fileName] = game
        await writeJson(manifestPath, manifest)
        for (const cell of [...cellsOf(game), ...mapCellsOf(game)]) {
          counts.set(cell, (counts.get(cell) ?? 0) + 1)
        }
        kept += 1
        const [a, b] = game.players
        console.log(
          `${kept}: ${a.race?.toUpperCase() ?? '?'} ${a.rank?.toUpperCase() ?? '-'} ${a.mmr} vs ` +
            `${b.race?.toUpperCase() ?? '?'} ${b.rank?.toUpperCase() ?? '-'} ${b.mmr}`,
        )
      }
      if (stopped) {
        // Not marked as looked through, so their games are looked at again next time.
        break
      }
      queried.add(`${player.toon}@${player.gateway}`)
      state.queried = Array.from(queried)
      state.seenMatches = Array.from(seenMatches)
      await writeJson(statePath, state)
    }
  }

  printSummary(seasonGames(), perCell, perMap)
  if (stopped) {
    console.log('\nStopped. Run the same command again to go on from here.')
    return
  }
  const left = LADDER_RANKS.filter(rankNeeds).map(r => r.toUpperCase())
  if (mapNeeds()) {
    left.push('some maps')
  }
  if (left.length) {
    console.log(
      `\nRan out of sampled players before filling ${left.join(', ')}. ` +
        'Delete fetch-state.json and run again with more --pages to sample more.',
    )
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
