import { describe, expect, test } from 'vitest'
import { LiveGame } from '../../common/live-game'
import {
  LiveGameTracker,
  MAX_GAME_MS,
  MAX_MATCH_FOUND_MS,
  PROFILE_LAG_MS,
  PROFILE_LEAD_MS,
} from './live-game-tracker'
import { ShieldBatteryProfile } from './sb-cache'
import { LadderProfile } from './scr-cache'

const PROFILE: LadderProfile = {
  battleTag: 'Them#1',
  ladder: { rating: 1430, rank: 'd', wins: 97, losses: 104 },
  otherAccounts: ['smurf'],
}

function setup() {
  const reports: Array<LiveGame | undefined> = []
  let now = 1_000_000
  const tracker = new LiveGameTracker(
    game => reports.push(game),
    () => now,
  )
  return {
    tracker,
    reports,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('LiveGameTracker', () => {
  test("fills in a ladder match's players, then their profiles", () => {
    const { tracker, reports } = setup()
    tracker.matchScreen(50072, 1009, 100_000, 100_000)
    tracker.ladderProfile({ name: 'Me', gatewayId: 10, atMs: 102_000 })
    tracker.ladderProfile({ name: 'Them', gatewayId: 30, atMs: 102_100 })
    tracker.profileRead('Them', 30, PROFILE)
    expect(reports.map(r => r?.players.map(p => p.name))).toEqual([
      [],
      ['Me'],
      ['Me', 'Them'],
      ['Me', 'Them'],
    ])
    expect(tracker.game).toMatchObject({
      id: 'ladder-50072-1009-100000',
      source: 'ladder',
      players: [
        { name: 'Me', gatewayId: 10 },
        {
          name: 'Them',
          gatewayId: 30,
          battleTag: 'Them#1',
          ladder: PROFILE.ladder,
          otherAccounts: ['smurf'],
        },
      ],
    })
  })

  test('takes profiles that came just before the match screen, with what was read for them', () => {
    const { tracker } = setup()
    tracker.ladderProfile({ name: 'Old', gatewayId: 10, atMs: 100_000 - PROFILE_LEAD_MS - 1 })
    tracker.ladderProfile({ name: 'Them', gatewayId: 30, atMs: 99_000 })
    tracker.profileRead('Them', 30, PROFILE)
    tracker.matchScreen(50072, 1, 100_000, 100_000)
    expect(tracker.game?.players).toMatchObject([{ name: 'Them', ladder: { rating: 1430 } }])
  })

  test('starts over for the next match, and leaves out lookups long after', () => {
    const { tracker } = setup()
    tracker.matchScreen(50072, 1, 100_000, 100_000)
    tracker.ladderProfile({ name: 'First', gatewayId: 10, atMs: 101_000 })
    tracker.ladderProfile({ name: 'Late', gatewayId: 10, atMs: 100_000 + PROFILE_LAG_MS + 1 })
    expect(tracker.game?.players.map(p => p.name)).toEqual(['First'])
    tracker.matchScreen(50072, 2, 400_000, 400_000)
    tracker.ladderProfile({ name: 'Second', gatewayId: 10, atMs: 401_000 })
    expect(tracker.game?.players.map(p => p.name)).toEqual(['Second'])
  })

  test("doesn't add the same player twice, or report what didn't change", () => {
    const { tracker, reports } = setup()
    tracker.matchScreen(50072, 1, 100_000, 100_000)
    tracker.matchScreen(50072, 1, 100_000, 100_000)
    tracker.ladderProfile({ name: 'Them', gatewayId: 30, atMs: 101_000 })
    tracker.ladderProfile({ name: 'them', gatewayId: 30, atMs: 102_000 })
    expect(reports).toHaveLength(2)
  })

  test('keeps a match whose page is used again, and the players it has', () => {
    const { tracker, reports } = setup()
    tracker.matchScreen(50072, 1, 100_000, 100_010)
    tracker.ladderProfile({ name: 'Them', gatewayId: 30, atMs: 101_000 })
    tracker.matchScreen(50072, 1, 100_000, 103_000)
    expect(tracker.game?.players.map(p => p.name)).toEqual(['Them'])
    expect(reports).toHaveLength(2)
  })

  test('ends a game when its replay is saved', () => {
    const { tracker, advance } = setup()
    tracker.matchScreen(50072, 1, 100_000, 100_000)
    advance(1000)
    tracker.gameEnded(1_002_000)
    expect(tracker.game).toBeUndefined()
  })

  test("doesn't end a game noticed after the replay was saved", () => {
    const { tracker } = setup()
    tracker.shieldBatteryGame([{ name: 'a' }])
    tracker.gameEnded(999_999)
    expect(tracker.game).toBeDefined()
  })

  test("keeps a player's profile for a rematch, however many others were read since", () => {
    const { tracker } = setup()
    tracker.profileRead('Me', 10, { otherAccounts: ['alt'] })
    for (let i = 0; i < 20; i++) {
      tracker.profileRead(`opp${i}`, 10, { otherAccounts: [] })
      tracker.profileRead('Me', 10, { otherAccounts: ['alt'] })
    }
    tracker.matchScreen(50072, 1, 100_000, 100_000)
    tracker.ladderProfile({ name: 'Me', gatewayId: 10, atMs: 100_500 })
    expect(tracker.game?.players[0].otherAccounts).toEqual(['alt'])
  })

  test('forgets a game noticed long ago', () => {
    const { tracker, advance } = setup()
    tracker.shieldBatteryGame([{ name: 'a' }])
    advance(MAX_GAME_MS)
    tracker.expire()
    expect(tracker.game).toBeDefined()
    advance(1)
    tracker.expire()
    expect(tracker.game).toBeUndefined()
  })

  test('reports a ShieldBattery game, then nothing once cleared', () => {
    const { tracker, reports } = setup()
    tracker.shieldBatteryGame([{ name: 'a' }, { name: 'b' }])
    expect(tracker.game).toMatchObject({ source: 'shieldBattery' })
    tracker.clear()
    expect(reports.at(-1)).toBeUndefined()
    expect(tracker.game).toBeUndefined()
  })

  test('turns a ShieldBattery match into its game when it loads, as the same game', () => {
    const { tracker, advance } = setup()
    tracker.shieldBatteryMatchFound({ playerCount: 6, accepted: 0, phase: 'accepting' })
    const found = tracker.game!
    expect(found.players).toEqual([])
    tracker.shieldBatteryMatchChanged({ playerCount: 6, accepted: 6, phase: 'drafting' })
    expect(tracker.game?.matchFound?.phase).toBe('drafting')
    advance(60_000)
    tracker.shieldBatteryGame([{ name: 'a' }, { name: 'b' }], { mapName: 'Fighting Spirit' })
    expect(tracker.game).toEqual({
      id: found.id,
      source: 'shieldBattery',
      noticedMs: found.noticedMs,
      players: [{ name: 'a' }, { name: 'b' }],
      mapName: 'Fighting Spirit',
    })
    // Too late to change a game that loaded.
    tracker.shieldBatteryMatchChanged({ playerCount: 6, accepted: 6, phase: 'starting' })
    expect(tracker.game?.matchFound).toBeUndefined()
  })

  test('drops a ShieldBattery match that fell through, but not a ladder game', () => {
    const { tracker } = setup()
    tracker.shieldBatteryMatchFound({ playerCount: 2, accepted: 1, phase: 'accepting' })
    tracker.shieldBatteryMatchCanceled()
    expect(tracker.game).toBeUndefined()
    tracker.matchScreen(50072, 1, 100_000, 100_000)
    tracker.shieldBatteryMatchCanceled()
    expect(tracker.game?.source).toBe('ladder')
  })

  test('forgets a match found long ago whose game never loaded', () => {
    const { tracker, advance } = setup()
    tracker.shieldBatteryMatchFound({ playerCount: 4, accepted: 4, phase: 'starting' })
    advance(MAX_MATCH_FOUND_MS)
    tracker.expire()
    expect(tracker.game).toBeDefined()
    advance(1)
    tracker.expire()
    expect(tracker.game).toBeUndefined()
  })

  test('shows the players opened in ShieldBattery while a match loads, then their records', () => {
    const { tracker, advance } = setup()
    tracker.shieldBatteryProfile(sbProfile(1, 'before'), 1_000_000)
    advance(60_000)
    tracker.shieldBatteryMatchFound({ playerCount: 6, accepted: 6, phase: 'drafting' })
    expect(tracker.game?.players).toEqual([])
    tracker.shieldBatteryProfile(sbProfile(2, 'teammate'), 1_065_000)
    expect(tracker.game?.players).toEqual([
      {
        name: 'teammate',
        shieldBatteryId: 2,
        shieldBattery: { rating: 1600, record: { mode: '3v3bgh', wins: 20, losses: 10 } },
      },
    ])

    tracker.shieldBatteryGame([
      { name: 'before', shieldBatteryId: 1, team: 0 },
      {
        name: 'teammate',
        shieldBatteryId: 2,
        team: 0,
        shieldBattery: { rating: 1650, division: 'gold1' },
      },
      { name: 'stranger', shieldBatteryId: 3, team: 1 },
      { name: 'a', team: 1 },
      { name: 'b', team: 1 },
      { name: 'c', team: 0 },
      { name: 'watcher', shieldBatteryId: 4, observer: true },
    ])
    const players = tracker.game!.players
    // Looked up before the match, filled in once it loads.
    expect(players[0].shieldBattery?.record).toEqual({ mode: '3v3bgh', wins: 20, losses: 10 })
    // The game's rating and division go over the profile's.
    expect(players[1].shieldBattery).toEqual({
      rating: 1650,
      division: 'gold1',
      record: { mode: '3v3bgh', wins: 20, losses: 10 },
    })
    expect(players[2].shieldBattery).toBeUndefined()

    tracker.shieldBatteryProfile(sbProfile(3, 'stranger'), 1_200_000)
    expect(tracker.game!.players[2].shieldBattery?.record?.wins).toBe(20)
  })

  test('takes the mode for the game size the player played last', () => {
    const { tracker } = setup()
    tracker.shieldBatteryMatchFound({ playerCount: 6, accepted: 0, phase: 'accepting' })
    tracker.shieldBatteryProfile(
      {
        userId: 1,
        name: 'p',
        seasons: {
          '2v2bgh': { rating: 1, wins: 1, losses: 1, lastPlayedMs: 9 },
          '3v3': { rating: 2, wins: 2, losses: 2, lastPlayedMs: 5 },
          '3v3bgh': { rating: 3, wins: 3, losses: 3, lastPlayedMs: 7 },
        },
      },
      1_000_000,
    )
    expect(tracker.game?.players[0].shieldBattery?.record?.mode).toBe('3v3bgh')
  })

  test("leaves out profiles opened during someone else's game", () => {
    const { tracker } = setup()
    tracker.matchScreen(50072, 1, 100_000, 100_000)
    tracker.shieldBatteryProfile(sbProfile(1, 'p'), 1_000_000)
    expect(tracker.game?.players).toEqual([])
  })
})

function sbProfile(userId: number, name: string): ShieldBatteryProfile {
  return {
    userId,
    name,
    seasons: { '3v3bgh': { rating: 1600, wins: 20, losses: 10, lastPlayedMs: 1 } },
  }
}
