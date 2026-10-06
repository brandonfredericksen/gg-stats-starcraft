import styled from 'styled-components'
import {
  CoachBucket,
  CoachChange,
  CoachFinding,
  CoachGame,
  CoachRecentForm,
  CoachResult,
  CoachScope,
} from '../../../common/my-stats/coach'
import { titleSmall } from '../../styles/typography'
import { CoachView } from '../coach-page'

const CaseLabel = styled.h2`
  ${titleSmall};
  max-width: 1180px;
  margin: 24px auto 0;
  padding: 0 32px;
  color: var(--theme-on-surface-variant);
`

const scopes: CoachScope[] = [
  { shape: '1v1', race: 'p', opponentRace: 'z', games: 42 },
  { shape: '3v3', race: 'p', games: 31 },
  { shape: '1v1', race: 'p', opponentRace: 't', games: 18 },
  { shape: '2v2', race: 'z', games: 7 },
  { shape: '1v1', race: 'p', opponentRace: 'p', games: 4 },
]

function compared(
  key: CoachFinding['key'],
  unit: CoachFinding['unit'],
  userValue: number,
  poolValue: number,
  beats: number,
): CoachFinding {
  return {
    key,
    unit,
    higherIsBetter: true,
    userValue,
    poolValue,
    beats,
    userGames: 40,
    poolGames: 180,
    sameOpening: false,
  }
}

const everything: CoachFinding[] = [
  compared('workers4', 'count', 14, 15, 0.42),
  compared('workers6', 'count', 21, 24, 0.33),
  compared('workers8', 'count', 31, 38, 0.12),
  compared('workers10', 'count', 44, 47, 0.38),
  compared('income6', 'perMinute', 980, 1040, 0.4),
  compared('income10', 'perMinute', 1850, 1910, 0.45),
  compared('production6', 'count', 3, 3, 0.5),
  compared('production8', 'count', 5, 7, 0.22),
  compared('secondBase', 'time', 205_000, 198_000, 0.44),
  compared('thirdBase', 'time', 455_000, 410_000, 0.31),
  compared('supply100', 'time', 560_000, 530_000, 0.38),
  compared('bankEarly', 'count', 280, 260, 0.46),
  compared('bankMid', 'count', 820, 460, 0.18),
  compared('supplyBlocked', 'share', 0.021, 0.068, 0.86),
  compared('army7', 'count', 1800, 1650, 0.58),
  compared('armyTrade', 'ratio', 1.12, 1.05, 0.55),
  compared('workersLost', 'count', 9, 7, 0.4),
  compared('eapm', 'count', 158, 146, 0.62),
  compared('eapmMid', 'count', 182, 151, 0.78),
  compared('apmMid', 'count', 240, 215, 0.66),
  compared('hotkeysMid', 'perMinute', 4.1, 6.4, 0.24),
  compared('productionCommandsMid', 'perMinute', 7.2, 7.9, 0.41),
]

const DAY_MS = 24 * 60 * 60_000
const recentResults = ['win', 'win', 'loss', 'win', 'win', 'loss', 'win', 'unknown', 'win', 'loss']
const recentGames: CoachGame[] = recentResults.map((result, i) => ({
  gameId: `recent-${i}`,
  gameTimeMs: Date.now() - (recentResults.length - i) * DAY_MS,
  mapName: ['Polypoid', 'Eclipse', 'Vermeer'][i % 3],
  result: result as CoachGame['result'],
}))

function change(
  key: CoachChange['key'],
  unit: CoachChange['unit'],
  earlierValue: number,
  recentValue: number,
  direction: CoachChange['direction'],
  higherIsBetter = true,
): CoachChange {
  return {
    key,
    unit,
    higherIsBetter,
    earlierValue,
    recentValue,
    recentGames: 10,
    earlierGames: 32,
    direction,
    size: 2,
  }
}

const recentForm: CoachRecentForm = {
  games: recentGames,
  wins: 6,
  losses: 3,
  earlierGames: 32,
  earlierWins: 14,
  earlierLosses: 18,
  newPartnerGames: 0,
  changes: [
    change('workers6', 'count', 20, 23, 'better'),
    change('workers8', 'count', 30, 32, 'better'),
    change('income6', 'perMinute', 950, 990, 'same'),
    change('secondBase', 'time', 215_000, 198_000, 'same', false),
    change('bankMid', 'count', 700, 880, 'worse', false),
    change('supplyBlocked', 'share', 0.025, 0.02, 'same', false),
    change('armyTrade', 'ratio', 1.05, 1.2, 'better'),
    change('workersLost', 'count', 8, 12, 'worse', false),
    change('eapm', 'count', 150, 162, 'same'),
    change('hotkeysMid', 'perMinute', 3.9, 4.4, 'same'),
  ],
}

const pvz: CoachBucket = {
  recentForm,
  anyAlly: false,
  poolFromUserGames: 64,
  goals: [
    {
      key: 'workers8',
      unit: 'count',
      higherIsBetter: true,
      basis: 'others',
      target: 37.5,
      userValue: 31,
      recentValue: 32,
      beats: 0.12,
      inLosses: true,
      checks: [true, true, true, true, false],
    },
    {
      key: 'bankMid',
      unit: 'count',
      higherIsBetter: false,
      basis: 'others',
      target: 460,
      userValue: 820,
      recentValue: 880,
      beats: 0.18,
      inLosses: false,
      checks: [true, false, false, false, false],
    },
    {
      key: 'buildTiming',
      buildKey: 'u163',
      unit: 'time',
      higherIsBetter: false,
      basis: 'others',
      target: 290_000,
      userValue: 335_000,
      recentValue: 330_000,
      inLosses: false,
      checks: [true, true, false, false, false],
    },
    {
      key: 'hotkeysMid',
      unit: 'perMinute',
      higherIsBetter: true,
      basis: 'others',
      target: 6.4,
      userValue: 4.1,
      beats: 0.24,
      inLosses: false,
      checks: [],
    },
  ],
  notes: [
    { kind: 'form', form: recentForm },
    {
      kind: 'inLosses',
      finding: {
        key: 'workers6',
        unit: 'count',
        higherIsBetter: true,
        winValue: 24,
        lossValue: 19,
        wins: 24,
        losses: 18,
        notable: true,
      },
    },
    { kind: 'slipping', change: change('bankMid', 'count', 700, 880, 'worse', false) },
    { kind: 'improving', change: change('workers6', 'count', 20, 23, 'better') },
    {
      kind: 'strength',
      finding: {
        key: 'supplyBlocked',
        unit: 'share',
        higherIsBetter: false,
        userValue: 0.021,
        poolValue: 0.068,
        beats: 0.86,
        userGames: 42,
        poolGames: 186,
        sameOpening: false,
      },
    },
    {
      kind: 'timing',
      timing: {
        buildKey: 'u154',
        userMs: 245000,
        poolMs: 205000,
        userGames: 40,
        poolGames: 180,
        sameOpening: true,
        notable: true,
      },
    },
  ],
  shape: '1v1',
  race: 'p',
  opponentRace: 'z',
  userGames: 42,
  skippedGames: 2,
  mapNames: ['Polypoid', 'Eclipse', 'Vermeer', 'Radeon'],
  wins: 24,
  losses: 18,
  poolGames: 186,
  opening: ['u156', 'u166', 'u154', 'u160'],
  gaps: [
    {
      key: 'workers8',
      unit: 'count',
      higherIsBetter: true,
      userValue: 31,
      poolValue: 38,
      beats: 0.12,
      userGames: 40,
      poolGames: 180,
      sameOpening: true,
    },
    {
      key: 'bankMid',
      unit: 'count',
      higherIsBetter: false,
      userValue: 820,
      poolValue: 460,
      beats: 0.18,
      userGames: 42,
      poolGames: 186,
      sameOpening: false,
      fewerProduction: 2,
    },
    {
      key: 'hotkeysMid',
      unit: 'perMinute',
      higherIsBetter: true,
      userValue: 4.1,
      poolValue: 6.4,
      beats: 0.24,
      userGames: 38,
      poolGames: 170,
      sameOpening: false,
    },
  ],
  strengths: [
    {
      key: 'supplyBlocked',
      unit: 'share',
      higherIsBetter: false,
      userValue: 0.021,
      poolValue: 0.068,
      beats: 0.86,
      userGames: 42,
      poolGames: 186,
      sameOpening: false,
    },
    {
      key: 'eapmMid',
      unit: 'count',
      higherIsBetter: true,
      userValue: 182,
      poolValue: 151,
      beats: 0.78,
      userGames: 30,
      poolGames: 120,
      sameOpening: false,
    },
  ],
  inLosses: [
    {
      key: 'workers6',
      unit: 'count',
      higherIsBetter: true,
      winValue: 24,
      lossValue: 19,
      wins: 24,
      losses: 18,
      notable: true,
    },
    {
      key: 'workersLost',
      unit: 'count',
      higherIsBetter: false,
      winValue: 4,
      lossValue: 11,
      wins: 24,
      losses: 18,
      notable: true,
    },
    {
      key: 'income6',
      unit: 'perMinute',
      higherIsBetter: true,
      winValue: 1010,
      lossValue: 985,
      wins: 24,
      losses: 18,
      notable: false,
    },
    {
      key: 'bankEarly',
      unit: 'count',
      higherIsBetter: false,
      winValue: 270,
      lossValue: 290,
      wins: 24,
      losses: 18,
      notable: false,
    },
    {
      key: 'eapmEarly',
      unit: 'count',
      higherIsBetter: true,
      winValue: 140,
      lossValue: 138,
      wins: 24,
      losses: 18,
      notable: false,
    },
  ],
  timings: [
    {
      buildKey: 'u160',
      userMs: 95000,
      poolMs: 92000,
      userGames: 40,
      poolGames: 180,
      sameOpening: true,
      notable: false,
    },
    {
      buildKey: 'u157',
      userMs: 118_000,
      poolMs: 115_000,
      userGames: 40,
      poolGames: 180,
      sameOpening: true,
      notable: false,
    },
    {
      buildKey: 'u164',
      userMs: 290000,
      poolMs: 262000,
      userGames: 40,
      poolGames: 180,
      sameOpening: true,
      notable: true,
    },
    {
      buildKey: 'u154',
      userMs: 245000,
      poolMs: 205000,
      userGames: 40,
      poolGames: 180,
      sameOpening: true,
      notable: true,
    },
    {
      buildKey: 'u166',
      userMs: 300_000,
      poolMs: undefined,
      userGames: 40,
      poolGames: 180,
      sameOpening: true,
      notable: false,
    },
    {
      buildKey: 'u163',
      userMs: 515000,
      poolMs: 540000,
      userGames: 40,
      poolGames: 180,
      sameOpening: true,
      notable: true,
    },
    {
      buildKey: 'u155',
      userMs: 560000,
      poolMs: 566000,
      userGames: 40,
      poolGames: 180,
      sameOpening: true,
      notable: false,
    },
    {
      buildKey: 'u165',
      userMs: 610000,
      poolMs: 575000,
      userGames: 40,
      poolGames: 180,
      sameOpening: true,
      notable: true,
    },
  ],
  compared: everything,
}

const empty = {
  gaps: [],
  strengths: [],
  inLosses: [],
  timings: [],
  opening: [],
  compared: [],
  goals: [],
  notes: [],
}

const fewGamesForm: CoachRecentForm = {
  games: recentGames.slice(0, 7),
  wins: 4,
  losses: 3,
  earlierGames: 0,
  earlierWins: 0,
  earlierLosses: 0,
  newPartnerGames: 0,
  changes: [],
}

/** Goals from the user's own games, before there are enough other players to compare with. */
const ownGoals: CoachBucket['goals'] = [
  {
    key: 'army7',
    unit: 'count',
    higherIsBetter: true,
    basis: 'wins',
    target: 1400,
    userValue: 900,
    recentValue: 1150,
    inLosses: true,
    checks: [true, true, false, false, false],
  },
  {
    key: 'workersLost',
    unit: 'perTenMinutes',
    higherIsBetter: false,
    basis: 'earlier',
    target: 2.4,
    userValue: 3.1,
    recentValue: 4.2,
    inLosses: false,
    checks: [true, true, true, false, false],
  },
]

const recentWindow = {
  window: 'auto' as const,
  autoGames: 42,
  sinceMs: Date.UTC(2026, 7, 3),
  maps: [
    { key: 'polypoid', name: 'Polypoid', games: 31 },
    { key: 'fighting spirit', name: 'Fighting Spirit', games: 18 },
  ],
}

const pvzScope = { shape: '1v1', race: 'p', opponentRace: 'z' } as const
const teamScope = { shape: '3v3', race: 'p', mapFamily: 'bgh' } as const

const cases: Array<[string, CoachResult | undefined]> = [
  [
    'Findings in 1v1',
    { status: 'ready', scopes, eapmFloor: 150, scope: pvzScope, ...recentWindow, buckets: [pvz] },
  ],
  [
    'Team games on two kinds of map, one still locked',
    {
      status: 'ready',
      ...recentWindow,
      scopes,
      eapmFloor: 100,
      scope: teamScope,
      buckets: [
        { ...pvz, shape: '3v3', opponentRace: undefined, mapFamily: 'bgh', userGames: 24 },
        {
          ...pvz,
          ...empty,
          shape: '3v3',
          opponentRace: undefined,
          mapFamily: 'fastest',
          userGames: 7,
          skippedGames: 1,
          recentForm: fewGamesForm,
          wins: 3,
          losses: 4,
          poolGames: 18,
        },
      ],
    },
  ],
  [
    'Enough of the user, too few other players, floor above the lowest',
    {
      status: 'ready',
      ...recentWindow,
      scopes,
      eapmFloor: 200,
      scope: pvzScope,
      buckets: [
        {
          ...pvz,
          ...empty,
          userGames: 14,
          skippedGames: 0,
          wins: 9,
          losses: 5,
          poolGames: 22,
          recentForm,
          goals: ownGoals,
        },
      ],
    },
  ],
  [
    'Ready, but nothing stands out and too few losses',
    {
      status: 'ready',
      ...recentWindow,
      scopes,
      eapmFloor: 100,
      scope: pvzScope,
      buckets: [{ ...pvz, ...empty, wins: 12, losses: 3 }],
    },
  ],
  [
    'A 2v2 pairing with too few other players like it, and a teammate who often falls first',
    {
      status: 'ready',
      ...recentWindow,
      scopes: [{ shape: '2v2', race: 'z', allyRace: 't', games: 24 }, ...scopes],
      eapmFloor: 100,
      scope: { shape: '2v2', race: 'z', allyRace: 't' },
      buckets: [
        {
          ...pvz,
          shape: '2v2',
          race: 'z',
          opponentRace: undefined,
          allyRace: 't',
          anyAlly: true,
          poolFromUserGames: 0,
          userGames: 24,
          goals: ownGoals,
          recentForm: { ...recentForm, newPartnerGames: 6 },
          firstOut: { losses: 11, firstOut: 7, poolShare: 0.48 },
          notes: [
            { kind: 'form', form: { ...recentForm, newPartnerGames: 6 } },
            {
              kind: 'inLosses',
              finding: {
                key: 'army7',
                unit: 'count',
                higherIsBetter: true,
                winValue: 1400,
                lossValue: 900,
                wins: 13,
                losses: 11,
                notable: true,
              },
            },
            { kind: 'firstOut', firstOut: { losses: 11, firstOut: 7, poolShare: 0.48 } },
          ],
        },
      ],
    },
  ],
  ['No games to coach', { status: 'noGames', scopes: [], eapmFloor: 100 }],
  [
    'No games of the picked kind',
    {
      status: 'ready',
      ...recentWindow,
      scopes,
      eapmFloor: 100,
      scope: { shape: '2v2', race: 't' },
      buckets: [],
    },
  ],
  ['Loading', undefined],
]

/** Every state of the coach, with made up numbers, since real ones need a lot of games. */
export function CoachTest() {
  return (
    <>
      {cases.map(([label, coach]) => (
        <section key={label}>
          <CaseLabel>{label}</CaseLabel>
          <CoachView coach={coach} />
        </section>
      ))}
    </>
  )
}
