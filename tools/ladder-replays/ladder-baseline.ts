/**
 * Builds the ladder baseline the app ships, from start to end: `pnpm run ladder-baseline --dir
 * <folder> [--team-dir <folder>] [--skip-fetch] [--skip-ladder-fetch] [--retry-failed]
 * [--reanalyze] [--skip-analysis]`, with the fetch options of
 * `fetch-ladder-replays.ts` passed on, and `--team-top`, `--team-per-player` and
 * `--team-since-days` passed to `fetch-shieldbattery-replays.ts` as `--top`, `--per-player` and
 * `--since-days` for 2v2.
 *
 * 1. Downloads 1v1 ladder replays into `--dir` with `fetch-ladder-replays.ts`, which asks a logged
 *    in StarCraft: Remastered, starting it through Battle.net when it isn't running or crashes.
 * 2. With `--team-dir`, downloads ShieldBattery replays into its `2v2` and `3v3` folders with
 *    `fetch-shieldbattery-replays.ts`: every ranked 3v3 game the site has, and 2v2 games of the
 *    best rated players, since 2v2 has years of games and 3v3 a few thousand. `--skip-fetch` skips
 *    both downloads and uses the replays already there, and `--skip-ladder-fetch` only the first,
 *    which needs StarCraft.
 * 3. Starts the app with no window and its own data files (the `ladder` session) to analyze every
 *    replay in the folders, one at a time in a hidden StarCraft, the way it analyzes replays in the
 *    background. This is the slow part. Replays analyzed before are skipped, so it can be stopped
 *    and run again, and so are replays it gave up on before, like broken ones, unless
 *    `--retry-failed` asks for them again. `--reanalyze` analyzes replays again whose analysis is
 *    older than the game DLL, for numbers a new DLL collects. Numbers worked out from what's
 *    already saved, or from the replays' commands, don't need it: the app works them out again
 *    when their version changes. `--skip-analysis` does only that, in minutes, using the games
 *    analyzed before and fetching nothing.
 * 4. Has the app write the analyzed games, with each player's MMR and rank, or rating for
 *    ShieldBattery's, and every name replaced by a made up id, to
 *    `app/assets/ladder-baseline.json.gz`. A copy with the real names goes into the app data of the
 *    dev app and of an installed GG Stats, so the apps on this computer can look up the players in
 *    it by name.
 *
 * While it runs, P pauses it and goes on again, and Q (or Ctrl+C) stops it once what it's in the
 * middle of is done, like the replay being analyzed. Q again stops it right away.
 *
 * Each step picks up where it left off, and each fetch adds games the folders don't have yet, so
 * running this again with the same folders keeps growing the baseline.
 */
import { ChildProcess, spawn } from 'node:child_process'
import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
/**
 * The ShieldBattery ladders' formats, each in its own folder of `--team-dir`, and whether to take
 * every ranked game of it rather than the best players' games.
 */
const TEAM_FORMATS = [
  { format: '2v2', everyone: false },
  { format: '3v3', everyone: true },
]
const EXPORT_PATH = path.join(ROOT, 'app', 'assets', LADDER_BASELINE_FILE)

const { values: args } = parseArgs({
  options: {
    dir: { type: 'string' },
    'team-dir': { type: 'string' },
    'team-top': { type: 'string' },
    'team-per-player': { type: 'string' },
    'team-since-days': { type: 'string' },
    'skip-fetch': { type: 'boolean', default: false },
    'skip-ladder-fetch': { type: 'boolean', default: false },
    'retry-failed': { type: 'boolean', default: false },
    reanalyze: { type: 'boolean', default: false },
    'skip-analysis': { type: 'boolean', default: false },
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
  const teamDirs = args['team-dir']
    ? TEAM_FORMATS.map(({ format }) => path.join(path.resolve(args['team-dir']!), format))
    : []
  const skipAnalysis = args['skip-analysis']
  // Replays fetched now couldn't get into a baseline that analyzes nothing.
  const skipFetch = args['skip-fetch'] || skipAnalysis
  if (skipAnalysis && args.reanalyze) {
    fail('Pass either --reanalyze or --skip-analysis, not both.')
  }
  if (!skipAnalysis && !existsSync(DLL_PATH)) {
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

  if (!skipFetch && !args['skip-ladder-fetch']) {
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
  if (!skipFetch) {
    const teamPassed = (['top', 'per-player', 'since-days'] as const).flatMap(name =>
      args[`team-${name}`] !== undefined ? [`--${name}`, args[`team-${name}`]!] : [],
    )
    for (const [i, teamDir] of teamDirs.entries()) {
      await run(process.execPath, [
        '-r',
        '@swc-node/register',
        path.join(ROOT, 'tools', 'shieldbattery-replays', 'fetch-shieldbattery-replays.ts'),
        '--out',
        teamDir,
        '--format',
        TEAM_FORMATS[i].format,
        '--control',
        dir,
        ...(TEAM_FORMATS[i].everyone ? ['--everyone'] : teamPassed),
      ])
      if (stopped()) {
        return
      }
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
      ...[dir, ...teamDirs].map(folder => `--analyze-folder=${folder}`),
      `--export-baseline=${EXPORT_PATH}`,
      ...(args['retry-failed'] ? ['--retry-failed'] : []),
      ...(args.reanalyze ? [`--reanalyze-before=${statSync(DLL_PATH).mtimeMs}`] : []),
      ...(skipAnalysis ? ['--skip-analysis'] : []),
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
