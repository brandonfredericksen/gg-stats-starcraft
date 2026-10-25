import { LiveGame, LiveGamePlayer } from '../../common/live-game'
import { LadderProfile } from './scr-cache'

/**
 * How long before the match screen's page a profile can be cached and still belong to its match.
 * Lookups follow the page by a second or two, but both can land in the same read.
 */
export const PROFILE_LEAD_MS = 5000
/** How long after the match screen's page its lookups can come. */
export const PROFILE_LAG_MS = 60_000
/** A game is forgotten this long after it was noticed, if nothing said it ended. */
export const MAX_GAME_MS = 2 * 60 * 60_000
/** Profiles kept while waiting for a match screen they might belong to. */
const MAX_WAITING_PROFILES = 8

interface ProfileSighting {
  name: string
  gatewayId: number
  atMs: number
}

function playerKey(name: string, gatewayId: number | undefined) {
  return `${name.toLowerCase()}@${gatewayId ?? ''}`
}

/**
 * Keeps track of the game the user is in from what the watchers see, and reports it whenever it
 * changes. A new game replaces the one before.
 */
export class LiveGameTracker {
  private current: LiveGame | undefined
  private reported = 'null'
  /** The ladder match being filled in, and when its screen opened. */
  private ladder: { id: string; atMs: number } | undefined
  /** Profiles that came before a match screen, newest last. */
  private waitingProfiles: ProfileSighting[] = []
  /**
   * Profiles read for players, by player, the most recently read last. Kept across matches, so in
   * a rematch the profile is there at once, until a fresh one is read.
   */
  private profiles = new Map<string, LadderProfile>()

  constructor(
    private readonly onChange: (game: LiveGame | undefined) => void,
    private readonly now: () => number = Date.now,
  ) {}

  get game() {
    return this.current
  }

  /**
   * The ladder's match screen opened at `atMs`. Its page was made at `createdMs`, which tells it
   * from another page on the same panel id.
   */
  matchScreen(port: number, panelId: number, createdMs: number, atMs: number) {
    const id = `ladder-${port}-${panelId}-${createdMs}`
    if (this.ladder?.id === id) {
      return
    }
    this.ladder = { id, atMs }
    const players = this.waitingProfiles
      .filter(p => p.atMs >= atMs - PROFILE_LEAD_MS)
      .map(p => this.toPlayer(p))
    this.waitingProfiles = []
    this.set({ id, source: 'ladder', noticedMs: this.now(), started: true, players })
  }

  /** The match screen looked up someone's profile. */
  ladderProfile(sighting: ProfileSighting) {
    const { ladder } = this
    if (
      !ladder ||
      this.current?.id !== ladder.id ||
      sighting.atMs < ladder.atMs - PROFILE_LEAD_MS ||
      sighting.atMs > ladder.atMs + PROFILE_LAG_MS
    ) {
      this.waitingProfiles.push(sighting)
      this.waitingProfiles = this.waitingProfiles
        .filter(p => p.atMs >= sighting.atMs - PROFILE_LAG_MS)
        .slice(-MAX_WAITING_PROFILES)
      return
    }
    const key = playerKey(sighting.name, sighting.gatewayId)
    if (this.current.players.some(p => playerKey(p.name, p.gatewayId) === key)) {
      return
    }
    this.set({ ...this.current, players: [...this.current.players, this.toPlayer(sighting)] })
  }

  /** A profile was read: what it says goes on the player, now or once they show up. */
  profileRead(name: string, gatewayId: number, profile: LadderProfile) {
    const key = playerKey(name, gatewayId)
    this.profiles.delete(key)
    this.profiles.set(key, profile)
    if (this.profiles.size > MAX_WAITING_PROFILES * 2) {
      this.profiles.delete(this.profiles.keys().next().value!)
    }
    const game = this.current
    if (
      game?.source !== 'ladder' ||
      !game.players.some(p => playerKey(p.name, p.gatewayId) === key)
    ) {
      return
    }
    this.set({
      ...game,
      players: game.players.map(p =>
        playerKey(p.name, p.gatewayId) === key ? this.toPlayer({ name: p.name, gatewayId }) : p,
      ),
    })
  }

  /** The user is in a lobby, with these people in it so far. */
  lobby(id: string, players: LiveGamePlayer[]) {
    const started = this.current?.id === id && this.current.started
    const noticedMs = this.current?.id === id ? this.current.noticedMs : this.now()
    this.set({ id, source: 'lobby', noticedMs, started, players })
  }

  /** The lobby's host started the game. */
  lobbyStarting(id: string) {
    if (this.current?.id === id && !this.current.started) {
      this.set({ ...this.current, started: true })
    }
  }

  /** The lobby's page is gone. Unless its game started, the user left, and there's no game. */
  lobbyEnded(id: string) {
    if (this.current?.id === id && !this.current.started) {
      this.set(undefined)
    }
  }

  /** A ShieldBattery game is loading with these people in it. */
  shieldBatteryGame(players: LiveGamePlayer[]) {
    const noticedMs = this.now()
    this.set({
      id: `shieldBattery-${noticedMs}`,
      source: 'shieldBattery',
      noticedMs,
      started: true,
      players,
    })
  }

  /**
   * A game ended at `endedMs`, like when its replay was saved. Only a started game noticed before
   * then can be the one that ended: a lobby that hasn't started is still open, and a game noticed
   * after is the next one.
   */
  gameEnded(endedMs: number) {
    if (this.current?.started && this.current.noticedMs < endedMs) {
      this.set(undefined)
    }
  }

  /** Forgets a game noticed long ago, in case nothing said it ended. */
  expire() {
    if (this.current && this.now() - this.current.noticedMs > MAX_GAME_MS) {
      this.set(undefined)
    }
  }

  /** Forgets the game, like when watching is turned off. */
  clear() {
    this.ladder = undefined
    this.waitingProfiles = []
    this.profiles.clear()
    this.set(undefined)
  }

  private toPlayer({ name, gatewayId }: { name: string; gatewayId: number }): LiveGamePlayer {
    const profile = this.profiles.get(playerKey(name, gatewayId))
    return {
      name,
      gatewayId,
      battleTag: profile?.battleTag,
      ladder: profile?.ladder,
      otherAccounts: profile?.otherAccounts.length ? profile.otherAccounts : undefined,
    }
  }

  private set(game: LiveGame | undefined) {
    if (game?.source !== 'ladder') {
      this.ladder = undefined
    }
    this.current = game
    // A lobby resends the same thing often; only a change is worth telling the window.
    const reported = JSON.stringify(game ?? null)
    if (reported !== this.reported) {
      this.reported = reported
      this.onChange(game)
    }
  }
}
