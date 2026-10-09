import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { gzipSync } from 'node:zlib'
import { getErrorStack } from '../../common/errors'
import {
  LADDER_BASELINE_VERSION,
  LADDER_PAUSE_FILE,
  LADDER_STOP_FILE,
  LadderBaseline,
} from '../../common/games/ladder-baseline'
import { GAME_METRICS_VERSION, PlayerMetrics } from '../../common/games/player-metrics'
import { ReplayToAnalyze } from '../../common/ipc'
import { DatedGameMetrics } from '../../common/my-stats/my-stats'
import { AutoCaptureService } from '../auto-capture'
import { displayMatchup } from '../auto-capture/archive-naming'
import { CommandStatsBackfill } from '../game/command-stats-backfill'
import { GameStatsStore } from '../game/game-stats-store'
import log from '../logger'
import { LadderManifests, withLadder } from '../replay-library/ladder-manifests'
import { mapReplayHeaderToRecord, parseReplayMetadata } from '../replay-library/replay-parser'

const POLL_MS = 5000

/** What `--analyze-folder` and `--export-baseline` ask the app to do instead of opening. */
export interface LadderRunArgs {
  folder: string
  exportPath?: string
}

export function getLadderRunArgs(argv: ReadonlyArray<string>): LadderRunArgs | undefined {
  const valueOf = (name: string) =>
    argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1)
  const folder = valueOf('--analyze-folder')
  const exportPath = valueOf('--export-baseline')
  return folder ? { folder: path.resolve(folder), exportPath } : undefined
}

/** Printed for whoever started the run, and logged. */
function report(message: string) {
  console.log(message)
  log.info(message)
}

async function toReplayToAnalyze(replayPath: string): Promise<ReplayToAnalyze | undefined> {
  try {
    const { headerData, players, clientData } = await parseReplayMetadata(replayPath)
    const record = mapReplayHeaderToRecord(
      { path: replayPath, fileMtime: 0, fileSize: 0, contentHash: '' },
      headerData,
      players,
      clientData,
    )
    return {
      path: replayPath,
      name: path.basename(replayPath),
      linkedGameId: record.linkedGameId,
      gameTime: record.gameTime,
      mapName: record.mapName,
      matchup: record.matchup ? displayMatchup(record.matchup) : undefined,
    }
  } catch (err) {
    report(`Skipping ${replayPath}, which couldn't be read: ${getErrorStack(err)}`)
    return undefined
  }
}

/**
 * Analyzes every replay in a folder, one after another the same way the app analyzes replays in
 * the background, reads their commands, and returns once all of them are done or analyzing stopped
 * after too many failures in a row. Replays analyzed before are skipped, so a run that was stopped
 * picks up where it left off.
 *
 * A pause file in the folder holds off starting another replay until it's gone, and a stop file
 * returns once the replay being analyzed is done, with `quit` set.
 */
export async function analyzeFolder({
  folder,
  autoCapture,
  backfill,
}: {
  folder: string
  autoCapture: AutoCaptureService
  backfill: CommandStatsBackfill
}): Promise<{ total: number; failed: number; stopped: boolean; quit: boolean }> {
  const files = (await readdir(folder)).filter(f => f.toLowerCase().endsWith('.rep'))
  const replays = (
    await Promise.all(files.map(f => toReplayToAnalyze(path.join(folder, f))))
  ).filter((r): r is ReplayToAnalyze => !!r)
  report(`Analyzing the replays of ${replays.length} games in ${folder}.`)
  await autoCapture.analyze(replays)

  let lastLeft = -1
  let held = false
  for (;;) {
    const stop = existsSync(path.join(folder, LADDER_STOP_FILE))
    const hold = stop || existsSync(path.join(folder, LADDER_PAUSE_FILE))
    if (hold !== held) {
      autoCapture.setPaused(hold)
      held = hold
      if (!stop) {
        report(hold ? 'Paused, once the replay being analyzed is done.' : 'Going on.')
      }
    }
    const status = autoCapture.getStatus()
    if (stop && !status.running) {
      report('Stopped. Run the same command again to go on from here.')
      return { total: replays.length, failed: status.failed.length, stopped: false, quit: true }
    }
    const left = status.queued.length + (status.running ? 1 : 0)
    if (left !== lastLeft) {
      report(`${replays.length - left} of ${replays.length} done, ${status.failed.length} failed.`)
      lastLeft = left
    }
    if (!left || status.paused) {
      report('Reading the replays’ commands.')
      await backfill.readAll()
      return {
        total: replays.length,
        failed: status.failed.length,
        stopped: status.paused,
        quit: false,
      }
    }
    await sleep(POLL_MS)
  }
}

/**
 * A name for a player that can't be traced back to them: a hash of their name with a secret made
 * up for this one baseline and thrown away, so the same player has the same id throughout it.
 */
function makeAnonymizer() {
  const secret = randomBytes(32)
  return (name: string) =>
    `#${createHash('sha256').update(secret).update(name.toLowerCase()).digest('hex').slice(0, 12)}`
}

function anonymize(player: PlayerMetrics, idOf: (name: string) => string): PlayerMetrics {
  // Moments point to times in a replay that doesn't ship with the baseline.
  const { moments: _moments, ...rest } = player
  return { ...rest, names: [idOf(player.names[0] ?? '')] }
}

/**
 * Writes the 1v1 games analyzed from a folder of ladder replays, with each player's MMR and rank
 * from its ladder manifest, as a baseline the app ships. Games without a ladder game in the
 * manifest are left out.
 */
export async function exportLadderBaseline({
  folder,
  exportPath,
  gameStatsStore,
}: {
  folder: string
  exportPath: string
  gameStatsStore: GameStatsStore
}) {
  const folderKey = path.resolve(folder).toLowerCase() + path.sep
  const listings = (await gameStatsStore.listMetrics()).filter(
    l => l.replayPathKey?.startsWith(folderKey) && l.metrics.shape === '1v1',
  )
  const ladderGames = await new LadderManifests().getGames(listings.map(l => l.replayPathKey!))
  const idOf = makeAnonymizer()
  const games: DatedGameMetrics[] = []
  for (const { replayPathKey, metrics } of listings) {
    const ladder = ladderGames.get(replayPathKey!)
    if (!ladder) {
      continue
    }
    const withRanks = withLadder(metrics, ladder)
    games.push({
      ...withRanks,
      gameId: `ladder-${path.basename(replayPathKey!, '.rep')}`,
      gameTimeMs: ladder.createdMs,
      players: withRanks.players.map(p => anonymize(p, idOf)),
    })
  }
  games.sort((a, b) => a.gameTimeMs - b.gameTimeMs)
  const baseline: LadderBaseline = {
    version: LADDER_BASELINE_VERSION,
    metricsVersion: GAME_METRICS_VERSION,
    createdMs: Date.now(),
    games,
  }
  const compressed = gzipSync(JSON.stringify(baseline), { level: 9 })
  await writeFile(exportPath, compressed)
  report(
    `Wrote ${games.length} games to ${exportPath} (${Math.round(compressed.length / 1024)} KB).`,
  )
}
