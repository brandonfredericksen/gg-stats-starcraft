import { rmSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import { getErrorStack } from '../../../common/errors'
import { AliasFinder } from '../alias-finder'
import { FingerprintBackfill } from '../fingerprint-backfill'
import { ReplayDb } from '../replay-db'
import {
  hashReplayContents,
  IndexedReplay,
  makeParseErrorRecord,
  parseReplayBuffer,
  parseReplayContents,
  readReplayCommandStats,
  readReplayFingerprints,
  ReplayFileInfo,
} from '../replay-parser'
import { ReplayLibraryLogger, ReplayWatcher } from '../replay-watcher'
import {
  FromWorkerMessage,
  ReplayDbCalls,
  ReplayDbWorkerData,
  ToWorkerMessage,
  WorkerLibraryStatus,
} from './messages'

// Owns the SQLite index and the folder watcher, in a utility process of its own. All the
// synchronous better-sqlite3 work (queries plus the per-file writes a backfill does) and the WASM
// replay parsing happen here, so they never block Electron's main thread. The main process talks to
// this worker purely through the message protocol in `./messages`.

const parentPort = process.parentPort
if (!parentPort) {
  throw new Error('db-worker must be run as a utility process')
}

const { dbPath, watchedFolders } = JSON.parse(process.argv.at(-1)!) as ReplayDbWorkerData

function post(message: FromWorkerMessage): void {
  parentPort.postMessage(message)
}

const logger: ReplayLibraryLogger = {
  error: message => post({ type: 'log', level: 'error', message }),
  warning: message => post({ type: 'log', level: 'warning', message }),
  verbose: message => post({ type: 'log', level: 'verbose', message }),
}

// Indexing can wait, so it only gets CPU time nothing else wants, like a game the user is playing
// or the analysis of one.
try {
  os.setPriority(os.constants.priority.PRIORITY_LOW)
} catch (err) {
  logger.warning(`Couldn't lower the replay index's priority: ${getErrorStack(err)}`)
}

/**
 * Opens the replay index, rebuilding it from scratch if the existing file can't be opened or
 * migrated. The index is a pure cache of the on-disk replay folder, so a corrupt/unreadable file
 * (power loss mid-write, a schema written by an incompatible build, ...) is discarded and
 * re-created rather than crash-looping the worker forever against the same bad file. A second
 * failure is a real problem (e.g. the directory isn't writable) and is left to propagate.
 */
function openReplayDb(path: string): ReplayDb {
  try {
    return new ReplayDb(path)
  } catch (err) {
    // A busy/locked error means another process (e.g. a second app instance) is holding the file,
    // not that it's corrupt — deleting it would destroy a healthy shared index. Let the error
    // propagate; the worker supervisor's restarts serve as the retry.
    const code = (err as { code?: string }).code
    if (code?.startsWith('SQLITE_BUSY') || code?.startsWith('SQLITE_LOCKED')) {
      throw err
    }

    logger.warning(`Recreating unreadable replay index at ${path}: ${getErrorStack(err)}`)
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        rmSync(path + suffix, { force: true })
      } catch {
        // Best-effort; if a file genuinely can't be removed, the retry below surfaces it.
      }
    }
    return new ReplayDb(path)
  }
}

const db = openReplayDb(dbPath)
const aliasFinder = new AliasFinder(db)
const watcher = new ReplayWatcher(watchedFolders, db, logger, {
  onProgress: progress => post({ type: 'backfillProgress', progress }),
  onChange: () => {
    aliasFinder.invalidate()
    fingerprints.schedule()
    post({ type: 'changed' })
  },
})
const fingerprints = new FingerprintBackfill(
  db,
  readReplayFingerprints,
  () => !!watcher.getBackfillProgress(),
  () => aliasFinder.invalidate(),
  logger,
)

function getStatus(): WorkerLibraryStatus {
  return {
    backfill: watcher.getBackfillProgress(),
    watchedFolders: watcher.getWatchedFolders(),
  }
}

/**
 * Parses and (re)indexes a single file right away, sharing the same parse-or-parse-error-record
 * shape the watcher's own `indexFile` step produces, then returns the file's index id. Unlike the
 * watcher's reconcile, this doesn't consult the existing index state first (no mtime/size
 * short-circuit) since it's only called for a file whose content is already known to be new or
 * freshly verified (a just-saved replay).
 */
async function indexFile(path: string): Promise<number | undefined> {
  const stats = await stat(path)
  const contents = await readFile(path)
  const fileInfo: ReplayFileInfo = {
    path,
    fileMtime: Math.floor(stats.mtimeMs),
    fileSize: stats.size,
    contentHash: hashReplayContents(contents),
  }

  let record: IndexedReplay
  try {
    record = parseReplayContents(fileInfo, contents)
  } catch {
    record = makeParseErrorRecord(fileInfo)
  }
  db.upsertReplay(record)
  return db.getIdByPath(path)
}

/**
 * Reads the tileset of an indexed replay that doesn't have one yet, like one indexed before
 * tilesets were read. Resolves to whether one was saved.
 */
async function fillTileset(path: string): Promise<boolean> {
  if (!db.lacksTileset(path)) {
    return false
  }
  const { tileset } = parseReplayBuffer(await readFile(path))
  if (tileset === null) {
    return false
  }
  db.setTileset(path, tileset)
  return true
}

/** Implementations of the operations the main process can request (see `ReplayDbCalls`). */
const calls: ReplayDbCalls = {
  query: filters => db.query(filters),
  status: () => getStatus(),
  setBookmarked: (replayIds, bookmarked) => db.setBookmarked(replayIds, bookmarked),
  suggestOwnNames: knownNames => db.suggestOwnNames(knownNames),
  findAliases: (names, excludeNames) => aliasFinder.find(names, excludeNames),
  getFrequentMaps: limit => db.getFrequentMaps(limit),
  getMapTilesets: () => db.getMapTilesets(),
  getGameTimes: pathKeys => db.getGameTimes(pathKeys),
  readCommandStats: path => readReplayCommandStats(path),
  indexFile: path => indexFile(path),
  fillTileset: path => fillTileset(path),
  setWatchedFolders: folders => watcher.setWatchedFolders(folders),
}

parentPort.on('message', ({ data: message }: { data: ToWorkerMessage }) => {
  // `message.method`/`message.args` aren't correlated after transfer (see `CallRequest`), so the
  // invocation goes through an untyped signature; `calls` itself is fully typed. Wrapping the call
  // in `Promise.resolve()` lets a synchronous method's result and a `Promise`-returning one's
  // (e.g. `indexFile`) both flow through the same await-then-post path.
  const method = calls[message.method] as (...args: unknown[]) => unknown
  Promise.resolve()
    .then(() => method(...message.args))
    .then(result => post({ type: 'callResult', id: message.id, result }))
    .catch(error => post({ type: 'callResult', id: message.id, error: error as Error }))
})

watcher.start()
fingerprints.schedule()
post({ type: 'ready' })
