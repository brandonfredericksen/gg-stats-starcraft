/**
 * Writes `app/dist/THIRD_PARTY_NOTICES.md`: the license of every third party package, crate and
 * font the installed app ships, which their licenses require to go along with it. Run after the
 * renderer build (its bundled packages come from Vite's `license.md`) and before packaging.
 *
 * - Renderer: whatever Vite bundled, from the `license.md` it writes next to the bundle.
 * - Main process: the production dependencies of `app/`, from `pnpm licenses list`.
 * - Game DLL: every crate the `game/` workspace links on Windows, from `cargo metadata`.
 * - Fonts: the license files kept next to this script.
 *
 * A package that names a license without shipping its text gets the standard text from
 * `licenses/`, with its authors.
 */
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const DIST = path.join(ROOT, 'app', 'dist')
const RENDERER_LICENSES = path.join(DIST, 'renderer-licenses.md')
const OUTPUT = path.join(DIST, 'THIRD_PARTY_NOTICES.md')

const FONTS = [
  { name: 'Inter', file: 'inter-OFL.txt' },
  { name: 'Sofia Sans', file: 'sofiasans-OFL.txt' },
  { name: 'Sofia Sans Condensed', file: 'sofiasanscondensed-OFL.txt' },
  { name: 'Noto Color Emoji', file: 'notocoloremoji-OFL.txt' },
  { name: 'Material Symbols', file: 'material-symbols-LICENSE.txt' },
]

/**
 * The prebuilt `sb_init.dll` and `sb_init_64.dll` in `game/dist`, which hand the game DLL
 * StarCraft's code once it has started. They come from ShieldBattery's repo without source, and
 * their author (neivv) considers them under that repo's MIT license.
 */
function sbInitNotice(): string {
  const mit = readFileSync(path.join(import.meta.dirname, 'licenses', 'MIT.txt'), 'utf8')
    .replace(/^MIT License\s*/, '')
    .trim()
  return [
    '### sb_init.dll and sb_init_64.dll',
    'From ShieldBattery (https://github.com/ShieldBattery/ShieldBattery). License: MIT',
    '```\nMIT License\n\nCopyright (c) 2016 Travis Collins\n\n' + mit + '\n```',
  ].join('\n\n')
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)/i
/** Licenses with a standard text in `licenses/`, in the order they're preferred for dual licenses. */
const STANDARD_LICENSES = ['MIT', 'Apache-2.0']

/**
 * Crates whose Cargo.toml names no license. `addedLater` links the commit that added the license
 * when it came after the revision the game DLL pins; their author stated it covers the code before
 * it too.
 */
const UNDECLARED_LICENSES = new Map<string, { license: string; addedLater?: string }>([
  [
    'scarf',
    { license: 'Apache-2.0', addedLater: 'https://github.com/neivv/scarf/commit/ebc73c275' },
  ],
  ['samase_scarf', { license: 'Apache-2.0' }],
])

/**
 * Crates must never come from tec27's samase_scarf fork: its additions aren't licensed for this
 * project.
 */
const FORBIDDEN_SOURCE = /github\.com\/tec27\//i

interface Entry {
  name: string
  version: string
  license: string
  texts: string[]
}

/**
 * The license and notice files at the top of a package's folder, and the text files next to any
 * fonts it bundles (which is where font licenses live).
 */
function readLicenseFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  const read = (d: string, keep: (name: string) => boolean) =>
    readdirSync(d, { withFileTypes: true })
      .filter(e => e.isFile() && keep(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(e => readFileSync(path.join(d, e.name), 'utf8').trim())
  const fonts = path.join(dir, 'fonts')
  return [
    ...read(dir, name => LICENSE_FILE.test(name)),
    ...(existsSync(fonts) ? read(fonts, name => name.endsWith('.txt')) : []),
  ]
}

/**
 * A crate from a git repo can keep its license at the repo's root rather than in its own folder.
 * Cargo checks a repo out at `git/checkouts/<repo>/<rev>/`, so that's as far up as this looks.
 */
function readGitLicenseFiles(manifestDir: string): string[] {
  let dir = manifestDir
  while (!path.basename(path.dirname(path.dirname(dir))).startsWith('checkouts')) {
    const texts = readLicenseFiles(dir)
    if (texts.length) {
      return texts
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      return []
    }
    dir = parent
  }
  return readLicenseFiles(dir)
}

/** The standard text of a license the expression allows, with who it's from. */
function standardLicenseText(expression: string, authors: string[]): string | undefined {
  const ids = expression.split(/[^A-Za-z0-9.-]+/)
  const id = STANDARD_LICENSES.find(l => ids.includes(l))
  if (!id) {
    return undefined
  }
  const text = readFileSync(path.join(import.meta.dirname, 'licenses', `${id}.txt`), 'utf8').trim()
  return authors.length
    ? `Copyright: ${authors.join(', ')}

${text}`
    : text
}

function appEntries(): Entry[] {
  const json = execSync('pnpm licenses list --prod --json', {
    cwd: path.join(ROOT, 'app'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const byLicense: Record<
    string,
    Array<{ name: string; versions: string[]; paths: string[]; license: string }>
  > = JSON.parse(json)
  return Object.values(byLicense)
    .flat()
    .flatMap(pkg =>
      pkg.versions.map((version, i) => {
        const texts = readLicenseFiles(pkg.paths[i] ?? pkg.paths[0])
        const standard = texts.length ? undefined : standardLicenseText(pkg.license, [])
        return {
          name: pkg.name,
          version,
          license: pkg.license,
          texts: standard ? [standard] : texts,
        }
      }),
    )
}

interface CargoPackage {
  id: string
  name: string
  version: string
  license: string | null
  license_file: string | null
  manifest_path: string
  source: string | null
  authors: string[]
}

interface CargoNode {
  id: string
  deps: Array<{ pkg: string; dep_kinds: Array<{ kind: string | null }> }>
}

/** The crates linked into the DLL: normal dependencies of the workspace, not build or dev ones. */
function gameEntries(target: string): Entry[] {
  const metadata = JSON.parse(
    execFileSync(
      'cargo',
      ['metadata', '--format-version', '1', '--locked', '--filter-platform', target],
      { cwd: path.join(ROOT, 'game'), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    ),
  ) as {
    packages: CargoPackage[]
    workspace_members: string[]
    resolve: { nodes: CargoNode[] }
  }
  const packages = new Map(metadata.packages.map(p => [p.id, p]))
  const nodes = new Map(metadata.resolve.nodes.map(n => [n.id, n]))
  const linked = new Set<string>()
  const queue = [...metadata.workspace_members]
  while (queue.length) {
    const node = nodes.get(queue.pop()!)
    for (const dep of node?.deps ?? []) {
      if (dep.dep_kinds.some(k => k.kind === null) && !linked.has(dep.pkg)) {
        linked.add(dep.pkg)
        queue.push(dep.pkg)
      }
    }
  }

  const forbidden = Array.from(linked, id => packages.get(id)!).filter(p =>
    FORBIDDEN_SOURCE.test(p.source ?? ''),
  )
  if (forbidden.length) {
    throw new Error(
      `These crates come from tec27's samase_scarf fork, which isn't licensed for GG Stats: ` +
        forbidden.map(p => `${p.name} (${p.source})`).join(', '),
    )
  }

  return Array.from(linked, id => packages.get(id)!)
    .filter(p => p.source !== null)
    .map(p => {
      const dir = path.dirname(p.manifest_path)
      const texts = p.source?.startsWith('git+') ? readGitLicenseFiles(dir) : readLicenseFiles(dir)
      if (!texts.length && p.license_file) {
        texts.push(readFileSync(path.join(dir, p.license_file), 'utf8').trim())
      }
      const undeclared = p.license ? undefined : UNDECLARED_LICENSES.get(p.name)
      const license = p.license ?? undeclared?.license
      const standard = texts.length ? undefined : standardLicenseText(license ?? '', p.authors)
      if (standard) {
        texts.push(standard)
      }
      return {
        name: p.name,
        version: p.version,
        license:
          (undeclared?.addedLater ? `${license} (${undeclared.addedLater})` : license) ??
          (p.license_file ? 'See license text' : 'No license given'),
        texts,
      }
    })
}

function dedupe(entries: Entry[]): Entry[] {
  const seen = new Map<string, Entry>()
  for (const entry of entries) {
    seen.set(`${entry.name}@${entry.version}`, entry)
  }
  return Array.from(seen.values()).sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  )
}

function renderEntries(entries: Entry[]): string {
  return entries
    .map(e => {
      const body = e.texts.length
        ? e.texts.map(t => '```\n' + t + '\n```').join('\n\n')
        : '_No license file in the package._'
      return `### ${e.name} ${e.version}\n\nLicense: ${e.license}\n\n${body}`
    })
    .join('\n\n')
}

function main() {
  if (!existsSync(RENDERER_LICENSES)) {
    throw new Error(`${RENDERER_LICENSES} is missing. Build the renderer first.`)
  }
  // Vite's file starts with its own title and a line of intro, then a `##` heading per package.
  const renderer = readFileSync(RENDERER_LICENSES, 'utf8')
    .replace(/^# .*\n+.*\n/, '')
    .replace(/^## /gm, '### ')
    .trim()
  const app = dedupe(appEntries())
  const game = dedupe([
    ...gameEntries('i686-pc-windows-msvc'),
    ...gameEntries('x86_64-pc-windows-msvc'),
  ])
  const fonts = FONTS.map(
    f =>
      `### ${f.name}\n\n` +
      '```\n' +
      readFileSync(path.join(import.meta.dirname, f.file), 'utf8').trim() +
      '\n```',
  ).join('\n\n')

  const output = [
    '# Third party notices',
    'GG Stats includes the software and fonts below. Each is under its own license, shown with it.',
    '## Fonts',
    fonts,
    '## Interface',
    renderer,
    '## App',
    renderEntries(app),
    '## Game integration',
    renderEntries(game),
    sbInitNotice(),
  ].join('\n\n')
  writeFileSync(OUTPUT, output + '\n')
  rmSync(RENDERER_LICENSES)

  const missing = [...app, ...game].filter(e => !e.texts.length)
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)}: ${app.length + game.length} packages.`)
  if (missing.length) {
    console.log(`Without a license file: ${missing.map(e => `${e.name} ${e.version}`).join(', ')}`)
  }
}

main()
