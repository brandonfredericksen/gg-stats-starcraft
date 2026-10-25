import { describe, expect, test } from 'vitest'
import { toServerJson } from './chromium-cache-test-files'
import { parseLadderProfile, readCacheKey } from './scr-cache'

describe('readCacheKey', () => {
  test("reads the ladder's match screen", () => {
    expect(
      readCacheKey(
        'http://127.0.0.1:50072/gamedata/webui/dist/MatchmakingGameLoadingPanel/MatchmakingGameLoadingPanel.html?locale=enUS&port=50072&guid=1009',
        4,
        5,
      ),
    ).toEqual({ kind: 'matchPage', port: 50072, panelId: 1009, createdMs: 4, atMs: 5 })
  })

  test('reads a profile the match screen looked up', () => {
    expect(
      readCacheKey(
        'http://127.0.0.1:50072/web-api/v2/aurora-profile-by-toon/WelkeToParrty/30?request_flags=scr_mmgameloading',
        4,
        5,
      ),
    ).toEqual({
      kind: 'ladderProfile',
      name: 'WelkeToParrty',
      gatewayId: 30,
      createdMs: 4,
      atMs: 5,
    })
  })

  test('decodes names', () => {
    expect(
      readCacheKey(
        'http://127.0.0.1:1/web-api/v2/aurora-profile-by-toon/spaghetti%3Dwow/10?request_flags=scr_mmgameloading',
        4,
        5,
      ),
    ).toMatchObject({ name: 'spaghetti=wow' })
    expect(
      readCacheKey(
        'http://127.0.0.1:1/web-api/v2/aurora-profile-by-toon/%E0%A4/10?request_flags=scr_mmgameloading',
        4,
        5,
      ),
    ).toBeUndefined()
  })

  test('ignores other pages and lookups', () => {
    for (const key of [
      'http://127.0.0.1:50072/gamedata/webui/dist/GameLobbyPanel/GameLobbyPanel.html?locale=enUS&port=50072&guid=12382',
      'http://127.0.0.1:50072/gamedata/webui/dist/MatchmakingGameLoadingPanel/MatchmakingGameLoadingPanel.js',
      'http://127.0.0.1:50072/gamedata/webui/dist/ChatPanel/ChatPanel.html?locale=enUS&port=50072&guid=9961',
      'http://127.0.0.1:50072/web-api/v2/aurora-profile-by-toon/44.44/10?request_flags=scr_tooninfo',
      'http://127.0.0.1:50072/gamedata/webui/dist/MatchmakingGameLoadingPanel/MatchmakingGameLoadingPanel.html?locale=enUS&port=0&guid=1',
      'http://127.0.0.1:50072/gamedata/webui/dist/MatchmakingGameLoadingPanel/MatchmakingGameLoadingPanel.html?locale=enUS&port=50072',
      'https://example.com/gamedata/webui/dist/MatchmakingGameLoadingPanel/MatchmakingGameLoadingPanel.html?port=50072&guid=1',
    ]) {
      expect(readCacheKey(key, 4, 5)).toBeUndefined()
    }
  })
})

/** The shape of a profile StarCraft's server sent the match screen, trimmed. */
function profileJson(stats: object[]) {
  return Buffer.from(
    JSON.stringify(
      toServerJson({
        auroraId: 1,
        battleTag: '바보',
        matchmakedCurrentSeason: 20,
        matchmakedStats: stats,
      }),
    ),
  )
}

const OWN = {
  bucket: 3,
  gameModeId: 1,
  losses: 104,
  rating: 1430,
  seasonId: 20,
  toon: 'WelkeToParrty',
  wins: 97,
}

describe('parseLadderProfile', () => {
  test("reads the player's season and lists their other accounts", () => {
    const body = profileJson([
      OWN,
      { ...OWN, toon: '1sadxzc123', bucket: 0, rating: 0, wins: 3, losses: 1 },
      { ...OWN, toon: 'onhwa.1', seasonId: 19 },
      { ...OWN, toon: 'teamguy', gameModeId: 2 },
    ])
    expect(parseLadderProfile(body, 'welketoparrty', 30)).toEqual({
      battleTag: '바보',
      ladder: { rating: 1430, rank: 'd', wins: 97, losses: 104 },
      otherAccounts: ['1sadxzc123'],
    })
  })

  test("takes the season of the account on the player's gateway", () => {
    // The shape of a real profile: one name on two gateways, each its own account.
    const body = Buffer.from(
      JSON.stringify(
        toServerJson({
          matchmakedCurrentSeason: 20,
          toonGuidByGateway: { 10: { dhtjtks: 2 }, 11: { 'dhtjtks-east': 1 }, 30: { dhtjtks: 3 } },
          matchmakedStats: [
            {
              ...OWN,
              toon: 'dhtjtks',
              toonGuid: 2,
              rating: 1626,
              wins: 140,
              losses: 130,
              bucket: 4,
            },
            { ...OWN, toon: 'dhtjtks-east', toonGuid: 1, rating: 1505 },
            { ...OWN, toon: 'dhtjtks', toonGuid: 3, rating: 1535, wins: 94, losses: 95 },
          ],
        }),
      ),
    )
    expect(parseLadderProfile(body, 'dhtjtks', 30)).toEqual({
      battleTag: undefined,
      ladder: { rating: 1535, rank: 'd', wins: 94, losses: 95 },
      otherAccounts: ['dhtjtks-east'],
    })
    expect(parseLadderProfile(body, 'dhtjtks', 10)?.ladder).toMatchObject({
      rating: 1626,
      rank: 'c',
    })
  })

  test("leaves out the rating of an account that isn't ranked", () => {
    const body = profileJson([{ ...OWN, bucket: 0, rating: 0, wins: 2, losses: 1 }])
    expect(parseLadderProfile(body, 'WelkeToParrty', 30)?.ladder).toEqual({
      rating: undefined,
      rank: undefined,
      wins: 2,
      losses: 1,
    })
  })

  test("has no ladder season for someone who hasn't played one", () => {
    expect(parseLadderProfile(profileJson([]), 'WelkeToParrty', 30)).toEqual({
      battleTag: '바보',
      ladder: undefined,
      otherAccounts: [],
    })
  })

  test("is undefined for a body that isn't whole yet", () => {
    const body = profileJson([OWN])
    expect(
      parseLadderProfile(body.subarray(0, body.length - 5), 'WelkeToParrty', 30),
    ).toBeUndefined()
    expect(parseLadderProfile(Buffer.from('null'), 'WelkeToParrty', 30)).toBeUndefined()
  })
})
