/**
 * Builds the 1v1 ladder baseline the app ships, from start to end: `pnpm run ladder-baseline --dir
 * <folder> [--skip-fetch] [--retry-failed]`, with the fetch options of `fetch-ladder-replays.ts`
 * passed on.
 *
 * 1. Downloads ladder replays into the folder with `fetch-ladder-replays.ts`, which asks a logged
 *    in StarCraft: Remastered, starting it through Battle.net when it isn't running or crashes.
 *    `--skip-fetch` uses the replays already there.
 * 2. Starts the app with no window and its own data files (the `ladder` session) to analyze every
 *    replay in the folder, one at a time in a hidden StarCraft, the way it analyzes replays in the
 *    background. This is the slow part. Replays analyzed before are skipped, so it can be stopped
 *    and run again, and so are replays it gave up on before, like broken ones, unless
 *    `--retry-failed` asks for them again.
 * 3. Has the app write the analyzed games, with each player's MMR and rank and every name replaced
 *    by a made up id, to `app/assets/ladder-baseline.json.gz`.
 *
 * While it runs, P pauses it and goes on again, and Q (or Ctrl+C) stops it once what it's in the
 * middle of is done, like the replay being analyzed. Q again stops it right away.
 *
 * Each step picks up where it left off, and each fetch adds more games than the folder had, so
 * running this again with the same folder keeps growing the baseline.
 */
import { ChildProcess, spawn } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  LADDER_BASELINE_FILE,
  LADDER_PAUSE_FILE,
  LADDER_STOP_FILE,
} from '../../common/games/ladder-baseline'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const SESSION = 'ladder'
const DLL_PATH = path.join(ROOT, 'game', 'dist', 'ggstats_64.dll')
const EXPORT_PATH = path.join(ROOT, 'app', 'assets', LADDER_BASELINE_FILE)

const { values: args } = parseArgs({
  options: {
    dir: { type: 'string' },
    'skip-fetch': { type: 'boolean', default: false },
    'retry-failed': { type: 'boolean', default: false },
    'per-cell': { type: 'string' },
    'per-map': { type: 'string' },
    'add-per-cell': { type: 'string' },
    'add-per-map': { type: 'string' },
    pages: { type: 'string' },
    port: { type: 'string' },
  },
})

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

/** The step running now, which a second Q stops right away. */
let current: ChildProcess | undefined

/**
 * Runs a command with its output passed through, and fails if it does. It doesn't get the keyboard,
 * which is this script's, for pausing and stopping.
 */
function run(command: string, commandArgs: string[], env: NodeJS.ProcessEnv = {}, shell = false) {
  console.log(`> ${command} ${commandArgs.join(' ')}`)
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, ...env },
      shell,
    })
    current = child
    child.on('error', reject)
    child.on('exit', code => {
      current = undefined
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} exited with ${code}`))
      }
    })
  })
}

/**
 * Pausing and stopping from the keyboard, through files in the replay folder that each step
 * watches. Returns what takes the keyboard back and clears the files.
 */
function watchKeys(dir: string) {
  const pauseFile = path.join(dir, LADDER_PAUSE_FILE)
  const stopFile = path.join(dir, LADDER_STOP_FILE)
  const clear = () => {
    rmSync(pauseFile, { force: true })
    rmSync(stopFile, { force: true })
  }
  // Left from a run that ended without clearing them.
  clear()
  if (!process.stdin.isTTY) {
    return clear
  }
  console.log('Press P to pause or go on, Q to stop.')
  process.stdin.setRawMode(true)
  process.stdin.setEncoding('utf8')
  process.stdin.resume()
  let stopping = false
  process.stdin.on('data', (key: string) => {
    const lower = key.toLowerCase()
    // Ctrl+C comes in as a key, since the keyboard is read raw.
    if (key === '\u0003' || lower === 'q') {
      if (stopping) {
        console.log('Stopping right away.')
        current?.kill()
        clear()
        process.exit(130)
      }
      stopping = true
      writeFileSync(stopFile, '')
      console.log("Stopping once what's running is done. Press Q again to stop right away.")
    } else if (lower === 'p' && !stopping) {
      if (existsSync(pauseFile)) {
        rmSync(pauseFile, { force: true })
        console.log('Going on.')
      } else {
        writeFileSync(pauseFile, '')
        console.log("Pausing once what's running is done. Press P to go on.")
      }
    }
  })
  return () => {
    process.stdin.setRawMode(false)
    process.stdin.pause()
    clear()
  }
}

async function main() {
  if (!args.dir) {
    fail('Pass the folder for the replays with --dir.')
  }
  const dir = path.resolve(args.dir)
  if (!existsSync(DLL_PATH)) {
    fail(`Analyzing needs the game DLL at ${DLL_PATH}. Build it with: pnpm run build-game`)
  }
  const release = watchKeys(dir)
  const stopped = () => {
    if (!existsSync(path.join(dir, LADDER_STOP_FILE))) {
      return false
    }
    release()
    console.log('\nStopped. Run the same command again to go on from here.')
    return true
  }

  if (!args['skip-fetch']) {
    const passed = (
      ['per-cell', 'per-map', 'add-per-cell', 'add-per-map', 'pages', 'port'] as const
    ).flatMap(name => (args[name] !== undefined ? [`--${name}`, args[name]!] : []))
    await run(process.execPath, [
      '-r',
      '@swc-node/register',
      path.join(ROOT, 'tools', 'ladder-replays', 'fetch-ladder-replays.ts'),
      '--out',
      dir,
      ...passed,
    ])
    if (stopped()) {
      return
    }
  }

  // pnpm is a .cmd file on Windows, which only starts through a shell.
  await run('pnpm', ['run', 'build-app-main'], {}, true)

  const electronPath = createRequire(import.meta.url)('electron') as string
  await run(
    electronPath,
    [
      'app',
      '--hidden',
      `--analyze-folder=${dir}`,
      `--export-baseline=${EXPORT_PATH}`,
      ...(args['retry-failed'] ? ['--retry-failed'] : []),
    ],
    { GGSTATS_SESSION: SESSION },
  )
  if (stopped()) {
    return
  }
  release()
  console.log(`\nDone. Commit ${path.relative(ROOT, EXPORT_PATH)} to ship it.`)
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
