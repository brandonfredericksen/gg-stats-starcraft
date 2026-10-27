import { readFile, rename, writeFile } from 'node:fs/promises'
import { getErrorStack } from '../../common/errors'
import { SeenPlayerRanks } from '../../common/player-ranks'
import log from '../logger'
import { ShieldBatteryProfile } from './sb-cache'
import { LadderProfile } from './scr-cache'

/** Players kept. Past this, whoever was seen longest ago is forgotten. */
export const MAX_PLAYERS = 2000
/** How long after a change the file is written, so a burst of profiles makes one write. */
const SAVE_DELAY_MS = 5000

interface SavedRanks {
  version: 1
  players: SeenPlayerRanks[]
}

function lastSeenMs(player: SeenPlayerRanks) {
  return Math.max(player.battleNet[0]?.seenMs ?? 0, player.shieldBattery?.seenMs ?? 0)
}

/**
 * The Battle.net and ShieldBattery ranks of every player whose profile the live game watchers read,
 * so a player's page can show them after the game. Kept in a small file, by name, ignoring case.
 */
export class PlayerRanksStore {
  private readonly players = new Map<string, SeenPlayerRanks>()
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private loaded: Promise<void> | undefined

  constructor(
    private readonly filePath: string,
    private readonly onChange: () => void,
  ) {}

  load(): Promise<void> {
    this.loaded ??= readFile(this.filePath, 'utf8')
      .then(text => {
        const saved = JSON.parse(text) as Partial<SavedRanks>
        for (const player of Array.isArray(saved.players) ? saved.players : []) {
          const key = typeof player?.name === 'string' ? player.name.toLowerCase() : undefined
          // A profile seen while the file was read is newer than what the file has.
          if (key && Array.isArray(player.battleNet) && !this.players.has(key)) {
            this.players.set(key, player)
          }
        }
      })
      .catch(err => {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          log.warning(`Couldn't read the saved player ranks: ${getErrorStack(err)}`)
        }
      })
    return this.loaded
  }

  /** What's been seen of each of `accounts` that has been seen. */
  async get(accounts: ReadonlyArray<string>): Promise<SeenPlayerRanks[]> {
    await this.load()
    const found = new Set<SeenPlayerRanks>()
    for (const account of accounts) {
      const player = this.players.get(account.toLowerCase())
      if (player) {
        found.add(player)
      }
    }
    return Array.from(found)
  }

  /** StarCraft's match screen looked up `name` on gateway `gatewayId` at `atMs`. */
  ladderProfile(name: string, gatewayId: number, profile: LadderProfile, atMs: number) {
    if (!profile.ladder) {
      return
    }
    const player = this.playerFor(name)
    player.battleNet = [
      { ...profile.ladder, gatewayId, seenMs: atMs },
      ...player.battleNet.filter(s => s.gatewayId !== gatewayId),
    ]
    this.changed(player)
  }

  /** ShieldBattery looked up a profile at `atMs`. */
  shieldBatteryProfile(profile: ShieldBatteryProfile, atMs: number) {
    const modes = Object.entries(profile.seasons)
      .map(([mode, season]) => ({ mode, ...season }))
      .filter(mode => mode.wins + mode.losses > 0)
      .sort((a, b) => b.wins + b.losses - (a.wins + a.losses))
    const player = this.playerFor(profile.name)
    player.shieldBattery = { userId: profile.userId, seenMs: atMs, modes }
    this.changed(player)
  }

  /** Writes what's waiting to be written, like when the app quits. */
  async flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
      await this.save()
    }
  }

  private playerFor(name: string) {
    const key = name.toLowerCase()
    const player = this.players.get(key) ?? { name, battleNet: [] }
    player.name = name
    this.players.set(key, player)
    return player
  }

  private changed(player: SeenPlayerRanks) {
    if (this.players.size > MAX_PLAYERS) {
      const oldest = Array.from(this.players).sort(([, a], [, b]) => lastSeenMs(a) - lastSeenMs(b))
      for (const [key, p] of oldest.slice(0, this.players.size - MAX_PLAYERS)) {
        if (p !== player) {
          this.players.delete(key)
        }
      }
    }
    this.onChange()
    this.saveTimer ??= setTimeout(() => {
      this.saveTimer = undefined
      this.save().catch(() => {})
    }, SAVE_DELAY_MS)
    this.saveTimer.unref?.()
  }

  private async save() {
    await this.load()
    const saved: SavedRanks = { version: 1, players: Array.from(this.players.values()) }
    const tempPath = `${this.filePath}.tmp`
    try {
      await writeFile(tempPath, JSON.stringify(saved))
      await rename(tempPath, this.filePath)
    } catch (err) {
      log.warning(`Couldn't save the player ranks: ${getErrorStack(err)}`)
    }
  }
}
