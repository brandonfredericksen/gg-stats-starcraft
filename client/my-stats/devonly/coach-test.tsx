import styled from 'styled-components'
import { CoachBucket, CoachFinding, CoachResult, CoachScope } from '../../../common/my-stats/coach'
import { titleSmall } from '../../styles/typography'
import { CoachPanel } from '../coach-panel'

const Container = styled.div`
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px 32px;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

const CaseLabel = styled.h2`
  ${titleSmall};
  margin: 0;
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

const pvz: CoachBucket = {
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

const empty = { gaps: [], strengths: [], inLosses: [], timings: [], opening: [], compared: [] }

const cases: Array<[string, CoachResult]> = [
  ['Findings in 1v1', { status: 'ready', scopes, eapmFloor: 150, buckets: [pvz] }],
  [
    'Team games on two kinds of map, one still locked',
    {
      status: 'ready',
      scopes,
      eapmFloor: 100,
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
      scopes,
      eapmFloor: 200,
      buckets: [
        { ...pvz, ...empty, userGames: 14, skippedGames: 0, wins: 9, losses: 5, poolGames: 22 },
      ],
    },
  ],
  [
    'Ready, but nothing stands out and too few losses',
    {
      status: 'ready',
      scopes,
      eapmFloor: 100,
      buckets: [{ ...pvz, ...empty, wins: 12, losses: 3 }],
    },
  ],
  ['Nothing picked yet', { status: 'pickFilters', scopes, eapmFloor: 100 }],
  ['No games to pick from', { status: 'pickFilters', scopes: [], eapmFloor: 100 }],
  ['No games of the picked kind', { status: 'ready', scopes, eapmFloor: 100, buckets: [] }],
]

/** Every state of the coach, with made up numbers, since real ones need a lot of games. */
export function CoachTest() {
  return (
    <Container>
      {cases.map(([label, coach]) => (
        <section key={label}>
          <CaseLabel>{label}</CaseLabel>
          <CoachPanel coach={coach} />
        </section>
      ))}
    </Container>
  )
}
