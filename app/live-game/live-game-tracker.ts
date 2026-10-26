import { LiveGame, LiveGamePlayer, LiveMatchFound } from '../../common/live-game'
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
/**
 * A match found is forgotten this long after, if its game never loaded and nothing said it fell
 * through. Accepting and the draft take a couple of minutes at most.
 */
export const MAX_MATCH_FOUND_MS = 10 * 60_000
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
    this.set({ id, source: 'ladder', noticedMs: this.now(), players })
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

  /** A ShieldBattery match was found. Who's in it is only known once its game loads. */
  shieldBatteryMatchFound(matchFound: LiveMatchFound) {
    const noticedMs = this.now()
    this.set({
      id: `shieldBattery-${noticedMs}`,
      source: 'shieldBattery',
      noticedMs,
      players: [],
      matchFound,
    })
  }

  /** The ShieldBattery match that was found got further along. */
  shieldBatteryMatchChanged(matchFound: LiveMatchFound) {
    if (this.current?.matchFound) {
      this.set({ ...this.current, matchFound })
    }
  }

  /** The ShieldBattery match fell through before its game started, or while it loaded. */
  shieldBatteryMatchCanceled() {
    if (this.current?.source === 'shieldBattery') {
      this.set(undefined)
    }
  }

  /**
   * A ShieldBattery game is loading with these people in it. The match it came from, if it was
   * found, is the same game.
   */
  shieldBatteryGame(players: LiveGamePlayer[], map?: Pick<LiveGame, 'mapName' | 'tileset'>) {
    const match = this.current?.matchFound ? this.current : undefined
    const noticedMs = match?.noticedMs ?? this.now()
    this.set({
      id: match?.id ?? `shieldBattery-${noticedMs}`,
      source: 'shieldBattery',
      noticedMs,
      players,
      ...map,
    })
  }

  /**
   * A game ended at `endedMs`, like when its replay was saved. Only a game noticed before then can
   * be the one that ended: a game noticed after is the next one.
   */
  gameEnded(endedMs: number) {
    if (this.current && this.current.noticedMs < endedMs) {
      this.set(undefined)
    }
  }

  /** Forgets a game noticed long ago, in case nothing said it ended. */
  expire() {
    const limit = this.current?.matchFound ? MAX_MATCH_FOUND_MS : MAX_GAME_MS
    if (this.current && this.now() - this.current.noticedMs > limit) {
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
    // Only a change is worth telling the window.
    const reported = JSON.stringify(game ?? null)
    if (reported !== this.reported) {
      this.reported = reported
      this.onChange(game)
    }
  }
}
