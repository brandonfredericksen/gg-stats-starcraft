/**
 * Talks to the web server StarCraft: Remastered runs on localhost while it's logged in, which the
 * game's own ladder and profile screens use. It isn't documented; dxrsz/bw-web-api describes what's
 * known of it. Every call goes out over the player's Battle.net session, so calls are spaced out,
 * and when the server says it's rate limited, they stop for a while instead of pushing on. When
 * StarCraft isn't running, or stops answering like after a crash, Battle.net is asked to start it.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

/** Bursts of calls are what risk the session, so there's never more than one per this. */
const CALL_INTERVAL_MS = 2000
const COOLDOWN_BASE_MS = 15 * 60_000
const COOLDOWN_MAX_MS = 2 * 60 * 60_000
const PROBE_TIMEOUT_MS = 2000
const CALL_TIMEOUT_MS = 30_000
/** How long a StarCraft that stopped answering gets to come back on its own, before it's started. */
const COME_BACK_MS = 30_000
/** How long StarCraft gets to start and log in, after Battle.net is asked to start it. */
const START_MS = 5 * 60_000
const START_ATTEMPTS = 3
const FIND_INTERVAL_MS = 10_000
/** Waits before asking again after the server failed to answer a call, one per try. */
const SERVER_RETRY_DELAYS_MS = [10_000, 30_000, 60_000]
/** Battle.net's code for StarCraft: Remastered. */
const STARCRAFT_PRODUCT = 'S1'

/** The ports StarCraft processes listen on at 127.0.0.1. */
function listStarCraftPorts(): number[] {
  const tasks = execFileSync(
    'tasklist',
    ['/FI', 'IMAGENAME eq StarCraft.exe', '/FO', 'CSV', '/NH'],
    { encoding: 'utf8' },
  )
  const pids = new Set(
    tasks
      .split(/\r?\n/)
      .map(line => line.split('","')[1])
      .filter((pid): pid is string => !!pid && /^\d+$/.test(pid)),
  )
  if (!pids.size) {
    return []
  }
  const netstat = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' })
  const ports = new Set<number>()
  for (const line of netstat.split(/\r?\n/)) {
    const match = /^\s*TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/.exec(line)
    if (match && pids.has(match[2])) {
      ports.add(Number(match[1]))
    }
  }
  return Array.from(ports)
}

/**
 * The server's JSON can carry raw control characters and bytes that aren't UTF-8 in map titles and
 * player names, which `JSON.parse` won't take as they are.
 */
function parseBridgeJson(bytes: Uint8Array): unknown {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  // oxlint-disable-next-line no-control-regex
  return JSON.parse(text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''))
}

export class RateLimitedError extends Error {}
/**
 * The server kept failing to answer one call, like with a 500 for one player's history, while
 * answering others. Skipping what it was for is enough.
 */
export class ServerError extends Error {}
/** StarCraft didn't answer at all, rather than answering with an error. */
class NotAnsweringError extends Error {}

/**
 * The port of a logged in StarCraft's web server: the given port, or any port a StarCraft process
 * listens on that answers like it. A StarCraft that isn't logged in, like the one GG Stats starts
 * to analyze replays, doesn't answer.
 */
async function findPort(port?: number): Promise<number | undefined> {
  const candidates = port !== undefined ? [port] : listStarCraftPorts()
  for (const candidate of candidates) {
    try {
      const res = await fetch(`http://127.0.0.1:${candidate}/web-api/v1/gateway`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      if (res.ok && typeof parseBridgeJson(await res.bytes()) === 'object') {
        return candidate
      }
    } catch {
      // Not the web server, or not answering yet.
    }
  }
  return undefined
}

async function waitForPort(timeoutMs: number): Promise<number | undefined> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const port = await findPort()
    if (port !== undefined || Date.now() >= until) {
      return port
    }
    await sleep(FIND_INTERVAL_MS)
  }
}

function findBattleNet(): string | undefined {
  return [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .flatMap(dir => (dir ? [path.join(dir, 'Battle.net', 'Battle.net.exe')] : []))
    .find(exe => existsSync(exe))
}

/** What `cmd /s /c` runs to have Battle.net start StarCraft. */
export function launchCommand(battleNet: string) {
  return `""${battleNet}" --exec="launch ${STARCRAFT_PRODUCT}""`
}

/**
 * Asks Battle.net to start StarCraft, the same as pressing Play, so it logs in as whoever is logged
 * in to Battle.net. Never touches a StarCraft that's running.
 */
function startStarCraft() {
  const battleNet = findBattleNet()
  if (!battleNet) {
    throw new Error("Couldn't find Battle.net to start StarCraft with.")
  }
  spawn('cmd.exe', ['/d', '/s', '/c', launchCommand(battleNet)], {
    detached: true,
    stdio: 'ignore',
    // Battle.net reads the quotes inside `--exec="..."`, which Node would put around all of it.
    windowsVerbatimArguments: true,
  }).unref()
}

/**
 * Finds a logged in StarCraft, and if there isn't one, has Battle.net start it and waits for it to
 * log in, a few times over before giving up.
 */
async function findOrStartStarCraft(): Promise<number> {
  for (let attempt = 1; attempt <= START_ATTEMPTS; attempt++) {
    console.warn(`Starting StarCraft through Battle.net (try ${attempt} of ${START_ATTEMPTS}).`)
    startStarCraft()
    const port = await waitForPort(START_MS)
    if (port !== undefined) {
      return port
    }
  }
  throw new Error(
    "StarCraft didn't start and log in. Start StarCraft: Remastered and log in, then try again.",
  )
}

export class Bridge {
  private lastCallMs = 0
  private cooldowns = 0

  private constructor(private currentPort: number) {}

  get port() {
    return this.currentPort
  }

  /** Connects to the given port, or finds a logged in StarCraft, starting one if there isn't. */
  static async connect(port?: number): Promise<Bridge> {
    const found =
      (await findPort(port)) ?? (port === undefined ? await findOrStartStarCraft() : undefined)
    if (found === undefined) {
      throw new Error(`StarCraft's web server isn't answering on port ${port}.`)
    }
    return new Bridge(found)
  }

  /**
   * Gets StarCraft back after it stopped answering, like after a crash: it gets a little while to
   * come back on its own, and is started again if it doesn't.
   */
  private async reconnect() {
    console.warn('StarCraft stopped answering.')
    this.currentPort = (await waitForPort(COME_BACK_MS)) ?? (await findOrStartStarCraft())
    console.warn(`Connected to StarCraft again on port ${this.currentPort}.`)
  }

  /**
   * Gets a `web-api/...` path, waiting out the server's rate limiting and asking again a few times
   * when it fails to answer. Throws a {@link ServerError} when it keeps failing.
   */
  async get(path: string): Promise<unknown> {
    let serverFailures = 0
    for (;;) {
      const wait = this.lastCallMs + CALL_INTERVAL_MS - Date.now()
      if (wait > 0) {
        await sleep(wait)
      }
      this.lastCallMs = Date.now()
      try {
        const result = await this.call(path)
        this.cooldowns = 0
        return result
      } catch (err) {
        if (err instanceof NotAnsweringError) {
          await this.reconnect()
          continue
        }
        if (err instanceof ServerError) {
          const delayMs = SERVER_RETRY_DELAYS_MS[serverFailures]
          serverFailures += 1
          if (delayMs === undefined) {
            throw err
          }
          console.warn(`${err.message}. Trying again in ${delayMs / 1000} seconds.`)
          await sleep(delayMs)
          continue
        }
        if (!(err instanceof RateLimitedError)) {
          throw err
        }
        const cooldownMs = Math.min(COOLDOWN_BASE_MS * 2 ** this.cooldowns, COOLDOWN_MAX_MS)
        this.cooldowns += 1
        console.warn(`Rate limited. Waiting ${Math.round(cooldownMs / 60_000)} minutes.`)
        await sleep(cooldownMs)
      }
    }
  }

  private async call(path: string): Promise<unknown> {
    let res: Response
    try {
      res = await fetch(`http://127.0.0.1:${this.currentPort}/${path}`, {
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      })
    } catch (err) {
      throw new NotAnsweringError(`${path}: ${String(err)}`)
    }
    const bytes = await res.bytes()
    const text = new TextDecoder().decode(bytes.subarray(0, 200))
    if (res.status === 429 || /rate limited/i.test(text)) {
      throw new RateLimitedError(path)
    }
    if (!res.ok) {
      throw new ServerError(`${path}: ${res.status} ${text}`.trim())
    }
    try {
      return parseBridgeJson(bytes)
    } catch {
      throw new ServerError(`${path}: an answer that isn't JSON`)
    }
  }
}
