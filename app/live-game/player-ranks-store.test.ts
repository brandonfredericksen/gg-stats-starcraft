import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PlayerRanksStore } from './player-ranks-store'

vi.mock('../logger', () => ({ default: { warning: vi.fn() } }))

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'player-ranks-'))
})

afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

describe('PlayerRanksStore', () => {
  test('keeps each gateway and every ShieldBattery mode played, and finds them by any account', async () => {
    const onChange = vi.fn()
    const store = new PlayerRanksStore(path.join(folder, 'ranks.json'), onChange)
    store.ladderProfile(
      'Alpha',
      10,
      { ladder: { rank: 'b', rating: 1900, wins: 3, losses: 1 }, otherAccounts: [] },
      1,
    )
    store.ladderProfile(
      'alpha',
      30,
      { ladder: { rank: 'a', rating: 2100, wins: 5, losses: 0 }, otherAccounts: [] },
      2,
    )
    // Nothing to keep without a season on the ladder.
    store.ladderProfile('Beta', 10, { otherAccounts: [] }, 3)
    store.shieldBatteryProfile(
      {
        userId: 7,
        name: 'ALPHA',
        seasons: {
          '1v1': { rating: 1500, wins: 2, losses: 2, lastPlayedMs: 0, division: 'gold1' },
          '3v3bgh': { rating: 1600, wins: 20, losses: 10, lastPlayedMs: 0, division: 'silver2' },
          '2v2': { rating: 1500, wins: 0, losses: 0, lastPlayedMs: 0, division: 'unrated' },
        },
      },
      4,
    )

    expect(onChange).toHaveBeenCalledTimes(3)
    expect(await store.get(['Beta'])).toEqual([])
    const [alpha] = await store.get(['nobody', 'Alpha', 'ALPHA'])
    expect(alpha.name).toBe('ALPHA')
    expect(alpha.battleNet.map(s => [s.gatewayId, s.rank, s.seenMs])).toEqual([
      [30, 'a', 2],
      [10, 'b', 1],
    ])
    expect(alpha.shieldBattery?.modes.map(m => [m.mode, m.division])).toEqual([
      ['3v3bgh', 'silver2'],
      ['1v1', 'gold1'],
    ])
  })

  test('saves to its file and reads it back', async () => {
    const filePath = path.join(folder, 'ranks.json')
    const store = new PlayerRanksStore(filePath, () => {})
    store.ladderProfile(
      'Alpha',
      10,
      { ladder: { rank: 'b', rating: 1900, wins: 3, losses: 1 }, otherAccounts: [] },
      1,
    )
    await store.flush()
    expect(JSON.parse(await readFile(filePath, 'utf8')).players).toHaveLength(1)

    const reread = new PlayerRanksStore(filePath, () => {})
    expect((await reread.get(['alpha']))[0]?.battleNet[0]?.rating).toBe(1900)
  })

  test("keeps what its file has for a player seen before it's read", async () => {
    const filePath = path.join(folder, 'ranks.json')
    const store = new PlayerRanksStore(filePath, () => {})
    store.ladderProfile(
      'Alpha',
      10,
      { ladder: { rank: 'b', rating: 1900, wins: 3, losses: 1 }, otherAccounts: [] },
      1,
    )
    await store.flush()

    const reread = new PlayerRanksStore(filePath, () => {})
    reread.shieldBatteryProfile({ userId: 7, name: 'alpha', seasons: {} }, 2)
    const [alpha] = await reread.get(['alpha'])
    expect(alpha.battleNet[0]?.rating).toBe(1900)
    expect(alpha.shieldBattery?.userId).toBe(7)
  })

  test('skips a ShieldBattery profile no newer than the one it has', async () => {
    const onChange = vi.fn()
    const store = new PlayerRanksStore(path.join(folder, 'ranks.json'), onChange)
    const profile = (rating: number) => ({
      userId: 7,
      name: 'Alpha',
      seasons: { '1v1': { rating, wins: 1, losses: 0, lastPlayedMs: 0 } },
    })
    store.shieldBatteryProfile(profile(1500), 5)
    store.shieldBatteryProfile(profile(1400), 3)
    store.shieldBatteryProfile(profile(1500), 5)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect((await store.get(['alpha']))[0]?.shieldBattery?.modes[0]?.rating).toBe(1500)
  })
})
