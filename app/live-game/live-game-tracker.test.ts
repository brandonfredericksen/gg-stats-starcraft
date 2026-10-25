import { describe, expect, test } from 'vitest'
import { LiveGame } from '../../common/live-game'
import { LiveGameTracker, MAX_GAME_MS, PROFILE_LAG_MS, PROFILE_LEAD_MS } from './live-game-tracker'
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
})
