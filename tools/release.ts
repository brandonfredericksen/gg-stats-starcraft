/**
 * Releases a new version: `pnpm run release <patch|minor|major|x.y.z>`. Naming the version main is
 * already at releases it as is, and finishes a release whose tag was already pushed.
 *
 * Checks that `main` is clean and matches origin, runs lint, typecheck and tests, bumps the version
 * in `package.json` and `app/package.json`, commits and tags it, and pushes both. Then it waits for
 * the Release workflow to upload the installer to a draft GitHub release, fills in notes from the
 * commits since the last release, and publishes the draft once you confirm. Publishing is what
 * ships the update to everyone's installed app, so `--yes` is the only way to skip that question.
 */
import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'

const ROOT = path.resolve(import.meta.dirname, '..')
const PACKAGE_FILES = ['package.json', path.join('app', 'package.json')]
const WORKFLOW = 'release.yml'

function run(cmd: string, args: string[]): void {
  console.log(`> ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' })
}

/** pnpm is a .cmd file on Windows, which only starts through a shell. */
function pnpm(command: string): void {
  console.log(`> pnpm ${command}`)
  execSync(`pnpm ${command}`, { cwd: ROOT, stdio: 'inherit' })
}

function read(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function nextVersion(current: string, bump: string): string {
  if (/^\d+\.\d+\.\d+$/.test(bump)) {
    return bump
  }
  const [major, minor, patch] = current.split('.').map(Number)
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
    default:
      return fail('Usage: pnpm run release <patch|minor|major|x.y.z> [--yes]')
  }
}

function setVersion(file: string, version: string): void {
  const fullPath = path.join(ROOT, file)
  const contents = readFileSync(fullPath, 'utf8')
  // A plain replace keeps the file's formatting and line endings as they are.
  const updated = contents.replace(/^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`)
  if (updated === contents) {
    fail(`Couldn't find the version in ${file}.`)
  }
  writeFileSync(fullPath, updated)
}

/**
 * The `owner/repo` of origin, which every gh call names. Left to itself, gh may pick the
 * `upstream` remote instead.
 */
function originRepo(): string {
  const url = read('git', ['remote', 'get-url', 'origin'])
  const match = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url)
  return match ? match[1] : fail(`origin (${url}) isn't a GitHub repo.`)
}

function previousTag(tag: string): string | undefined {
  try {
    return read('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*', `${tag}^`])
  } catch {
    return undefined
  }
}

async function waitForRun(repo: string, tag: string): Promise<string> {
  // The run takes a few seconds to show up after the push.
  for (let i = 0; i < 30; i++) {
    const id = read('gh', [
      'run',
      'list',
      '-R',
      repo,
      '--workflow',
      WORKFLOW,
      '--branch',
      tag,
      '--limit',
      '1',
      '--json',
      'databaseId',
      '--jq',
      '.[0].databaseId // ""',
    ])
    if (id) {
      return id
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  return fail(`The ${WORKFLOW} run for ${tag} didn't start. Check the Actions tab.`)
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`${question} [y/N] `)
  rl.close()
  return answer.trim().toLowerCase() === 'y'
}

async function main() {
  const args = process.argv.slice(2)
  const skipConfirm = args.includes('--yes')
  const bump = args.find(a => !a.startsWith('--')) ?? ''

  const current = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
  const version = nextVersion(current, bump)
  const tag = `v${version}`
  const repo = originRepo()

  if (read('git', ['branch', '--show-current']) !== 'main') {
    fail('Releases come from main. Switch to it first.')
  }
  if (read('git', ['status', '--porcelain'])) {
    fail('The working tree has changes. Commit or stash them first.')
  }
  run('git', ['fetch', 'origin', 'main', '--tags'])
  const head = read('git', ['rev-parse', 'HEAD'])
  if (head !== read('git', ['rev-parse', 'origin/main'])) {
    fail('main differs from origin/main. Pull or push first.')
  }

  // A tag for the current version means an earlier run pushed it and stopped after.
  const tagged = !!read('git', ['tag', '--list', tag])
  if (tagged && version !== current) {
    fail(`${tag} already exists.`)
  }

  if (tagged) {
    console.log(`\n${tag} is already pushed. Waiting for its build.\n`)
  } else {
    console.log(`\nReleasing ${version === current ? version : `${current} -> ${version}`}\n`)

    pnpm('run lint')
    pnpm('run typecheck')
    pnpm('test --run')

    if (version !== current) {
      for (const file of PACKAGE_FILES) {
        setVersion(file, version)
      }
      run('git', ['commit', '-m', `GG Stats ${version}.`, '--', ...PACKAGE_FILES])
    }
    run('git', ['tag', tag])
    run('git', ['push', '--atomic', 'origin', 'main', tag])
  }

  const runId = await waitForRun(repo, tag)
  run('gh', ['run', 'watch', runId, '-R', repo, '--exit-status'])

  const since = previousTag(tag)
  const notes = since
    ? read('git', [
        'log',
        `${since}..${tag}`,
        '--no-merges',
        '--invert-grep',
        '--grep=^GG Stats [0-9]',
        '--format=- %s',
      ])
    : ''
  console.log(`\nRelease notes${since ? ` (commits since ${since})` : ''}:\n${notes || '(none)'}\n`)

  if (!skipConfirm && !(await confirm(`Publish ${tag} to everyone?`))) {
    console.log(`Left ${tag} as a draft. Publish it on GitHub when it's ready.`)
    return
  }
  run('gh', ['release', 'edit', tag, '-R', repo, '--draft=false', '--latest', '--notes', notes])
  console.log(`\nPublished ${tag}.`)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
