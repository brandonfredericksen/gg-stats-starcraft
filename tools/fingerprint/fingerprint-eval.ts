/**
 * Measures how well fingerprints tell players apart, and learns the model the app ships:
 * `pnpm run fingerprint-eval --dir <folder> [--dir <folder>...] [--keep <n>] [--write-model]`.
 *
 * Reads every replay under the folders (keeping what it read in `.local/fingerprints.json`, so a
 * second run takes seconds), takes each name as one person, and splits the names in two: half to
 * learn the model from, half to test it on. Each tested name with enough games has its oldest games
 * scored against its newest, and against every other tested name's newest, as one name would be
 * against the others on a player's page. It prints how often the right name comes out on top, and
 * how strangers' scores spread, which sets how sure each score can say a match is.
 *
 * `--write-model` learns the model from every name and writes it to
 * `common/games/fingerprint-model.json`.
 */
import { init, parseReplay } from '@shieldbattery/broodrep'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  FINGERPRINT_FEATURES,
  FINGERPRINT_VERSION,
  fingerprintReplay,
  GameFingerprint,
} from '../../common/games/fingerprint'
import {
  buildIdentityPrint,
  FingerprintModel,
  fitFingerprintModel,
  IdentityPrint,
  LabeledFingerprint,
  projectFingerprint,
  scoreAliases,
} from '../../common/games/fingerprint-match'

init()

interface CachedGame extends GameFingerprint {
  file: string
  startMs: number
  /** Everyone else in the game, who can't be the same person. */
  others: string[]
}

interface Cache {
  version: number
  features: number
  games: CachedGame[]
  files: string[]
}

function getArgs() {
  const dirs: string[] = []
  let keep: number | undefined
  let writeModel = false
  let showPairs = false
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') {
      dirs.push(argv[++i])
    } else if (argv[i] === '--keep') {
      keep = Number(argv[++i])
    } else if (argv[i] === '--write-model') {
      writeModel = true
    } else if (argv[i] === '--show-pairs') {
      showPairs = true
    }
  }
  if (!dirs.length) {
    throw new Error('Pass at least one --dir')
  }
  return { dirs, keep, writeModel, showPairs }
}

function listReplays(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return listReplays(full)
    }
    return entry.name.toLowerCase().endsWith('.rep') ? [full] : []
  })
}

function readGames(dirs: string[]): CachedGame[] {
  const cachePath = path.join(__dirname, '../../.local/fingerprints.json')
  let cache: Cache = { version: FINGERPRINT_VERSION, features: 0, games: [], files: [] }
  if (existsSync(cachePath)) {
    const read = JSON.parse(readFileSync(cachePath, 'utf8')) as Cache
    if (read.version === FINGERPRINT_VERSION && read.features === FINGERPRINT_FEATURES.length) {
      cache = read
    }
  }
  cache.features = FINGERPRINT_FEATURES.length
  const done = new Set(cache.files)
  const files = dirs.flatMap(listReplays).filter(f => !done.has(f))
  let read = 0
  const started = Date.now()
  for (const file of files) {
    try {
      const replay = parseReplay(readFileSync(file))
      try {
        const players = replay.players()
        const prints = fingerprintReplay(players, replay.getCommands() ?? [], replay.header.frames)
        const names = players
          .filter(p => p.playerType === 'human' && !p.isObserver)
          .map(p => p.name.toLowerCase())
        for (const print of prints) {
          cache.games.push({
            ...print,
            file,
            startMs: replay.header.startTime * 1000,
            others: names.filter(n => n !== print.name.toLowerCase()),
          })
        }
      } finally {
        replay.free()
      }
    } catch (err) {
      console.warn(`Couldn't read ${file}: ${String(err)}`)
    }
    cache.files.push(file)
    read += 1
    if (read % 500 === 0) {
      console.log(`Read ${read} of ${files.length} replays (${Date.now() - started} ms)`)
    }
  }
  if (files.length) {
    console.log(`Read ${files.length} replays in ${Date.now() - started} ms`)
    writeFileSync(cachePath, JSON.stringify(cache))
  }
  const roots = dirs.map(d => path.resolve(d).toLowerCase())
  return cache.games.filter(g => roots.some(r => path.resolve(g.file).toLowerCase().startsWith(r)))
}

function inTestHalf(identity: string) {
  return createHash('sha1').update(identity).digest()[0] % 2 === 0
}

/** Whose games are taken to be one fingerprint's: a name, playing one race. */
function identityOf(game: CachedGame) {
  return `${game.name.toLowerCase()}|${game.race}`
}

function toLabeled(games: ReadonlyArray<CachedGame>): LabeledFingerprint[] {
  return games.map(g => ({ identity: identityOf(g), race: g.race, features: g.features }))
}

function groupByIdentity(games: ReadonlyArray<CachedGame>) {
  const byIdentity = new Map<string, CachedGame[]>()
  for (const g of games) {
    const key = identityOf(g)
    const list = byIdentity.get(key)
    if (list) {
      list.push(g)
    } else {
      byIdentity.set(key, [g])
    }
  }
  for (const list of byIdentity.values()) {
    list.sort((a, b) => a.startMs - b.startMs)
  }
  return byIdentity
}

function printOf(model: FingerprintModel, identity: string, games: ReadonlyArray<CachedGame>) {
  return buildIdentityPrint(
    identity,
    games.map(g => projectFingerprint(model, g.race, g.features)),
  )!
}

function quantile(sorted: ReadonlyArray<number>, q: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

function evaluate(
  model: FingerprintModel,
  test: Map<string, CachedGame[]>,
  cohort: IdentityPrint[],
  showPairs: boolean,
) {
  const sizes = [1, 2, 3, 5, 8]
  for (const k of sizes) {
    const eligible = Array.from(test).filter(([, games]) => games.length >= 2 * k)
    if (eligible.length < 10) {
      continue
    }
    // The oldest games are named apart from the newest, so scoring doesn't skip the true match.
    const probes = eligible.map(([id, games]) => printOf(model, `${id}#old`, games.slice(0, k)))
    const targets = eligible.map(([id, games]) => printOf(model, id, games.slice(-k)))
    const cache = new Map()
    const genuine: number[] = []
    const impostor: number[] = []
    const worst: Array<[number, string, string]> = []
    let top1 = 0
    for (const probe of probes) {
      const own = probe.identity.slice(0, -'#old'.length)
      const scores = scoreAliases(probe, targets, cohort, { cohortSumsCache: cache })
      if (scores[0]?.identity === own) {
        top1 += 1
      }
      for (const s of scores) {
        if (s.identity === own) {
          genuine.push(s.score)
        } else if (s.identity.split('|')[0] === own.split('|')[0]) {
          // The same name playing another race is the same person, not a stranger.
          continue
        } else {
          impostor.push(s.score)
          worst.push([s.score, own, s.identity])
        }
      }
    }
    if (showPairs) {
      worst.sort((a, b) => b[0] - a[0])
      for (const [score, a, b] of worst.slice(0, 15)) {
        const race = (id: string) =>
          test
            .get(id)!
            .map(g => g.race)
            .join('')
        console.log(`  ${score.toFixed(2)} ${a} (${race(a)}) ~ ${b} (${race(b)})`)
      }
    }
    genuine.sort((a, b) => a - b)
    impostor.sort((a, b) => a - b)
    const tprAt = (fpr: number) => {
      const threshold = quantile(impostor, 1 - fpr)
      return genuine.filter(s => s > threshold).length / genuine.length
    }
    let eer = 1
    for (const t of genuine) {
      const fnr = genuine.filter(s => s < t).length / genuine.length
      const fpr = impostor.filter(s => s >= t).length / impostor.length
      eer = Math.min(eer, Math.max(fnr, fpr))
    }
    console.log(
      [
        `${k} game${k > 1 ? 's' : ''} each: ${eligible.length} players`,
        `top1 ${((top1 / probes.length) * 100).toFixed(1)}%`,
        `EER ${(eer * 100).toFixed(2)}%`,
        `TPR@1e-2 ${(tprAt(1e-2) * 100).toFixed(1)}%`,
        `TPR@1e-3 ${(tprAt(1e-3) * 100).toFixed(1)}%`,
        `over 4.5/5.5/6.5 ${[4.5, 5.5, 6.5].map(t => ((genuine.filter(s => s >= t).length / genuine.length) * 100).toFixed(0) + '%/' + impostor.filter(s => s >= t).length).join(' ')}`,
        `genuine median ${quantile(genuine, 0.5).toFixed(2)} p10 ${quantile(genuine, 0.1).toFixed(2)}`,
        `impostor p99 ${quantile(impostor, 0.99).toFixed(2)} p99.9 ${quantile(impostor, 0.999).toFixed(2)} p99.95 ${quantile(impostor, 0.9995).toFixed(2)} p99.99 ${quantile(impostor, 0.9999).toFixed(2)} max ${impostor.at(-1)!.toFixed(2)}`,
      ].join(' | '),
    )
  }
}

function main() {
  const { dirs, keep, writeModel, showPairs } = getArgs()
  const games = readGames(dirs)
  const byIdentity = groupByIdentity(games)
  console.log(
    `${games.length} player-games, ${byIdentity.size} names, ` +
      `${Array.from(byIdentity.values()).filter(g => g.length >= 2).length} with 2+ games, ` +
      `${Array.from(byIdentity.values()).filter(g => g.length >= 10).length} with 10+`,
  )

  const trainGames = games.filter(g => !inTestHalf(g.name.toLowerCase()))
  const model = fitFingerprintModel(toLabeled(trainGames), keep)
  const train = groupByIdentity(trainGames)
  const cohort = Array.from(train, ([id, list]) => printOf(model, id, list))
  const test = new Map(Array.from(byIdentity).filter(([id]) => inTestHalf(id.split('|')[0])))
  evaluate(model, test, cohort, showPairs)

  if (writeModel) {
    const full = fitFingerprintModel(toLabeled(games), keep)
    const round = (values: number[]) => values.map(v => Number(v.toPrecision(5)))
    const out = {
      version: full.version,
      byRace: Object.fromEntries(
        Object.entries(full.byRace).map(([race, stats]) => [
          race,
          { mean: round(stats.mean), std: round(stats.std) },
        ]),
      ),
      weights: round(full.weights),
    }
    const file = path.join(__dirname, '../../common/games/fingerprint-model.json')
    writeFileSync(file, JSON.stringify(out) + '\n')
    console.log(`Wrote ${file} (${statSync(file).size} bytes)`)
  }
}

main()
