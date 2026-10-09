import styled from 'styled-components'
import {
  BuildSide,
  BuildStepSummary,
  CoachBuild,
  CoachTeamBuild,
} from '../../../common/my-stats/builds'
import { CoachBucket, CoachResult } from '../../../common/my-stats/coach'
import { pvz, pvzScope, recentWindow, scopes } from '../../coach/devonly/coach-test'
import { BuildsView } from '../builds-page'

const CaseLabel = styled.h2`
  margin: 24px 32px 0;
  color: var(--theme-on-surface-variant);
`

function time(text: string) {
  const [minutes, seconds] = text.split(':').map(Number)
  return (minutes * 60 + seconds) * 1000
}

function steps(list: Array<[key: string, supply: number, time: string, share?: number]>) {
  const seen = new Map<string, number>()
  return list.map(([key, supply, at, share = 0.9]): BuildStepSummary => {
    const nth = (seen.get(key) ?? 0) + 1
    seen.set(key, nth)
    return { key, nth, supply, ...spread(time(at)), share }
  })
}

/** A typical time, with the middle half of games a little either side of it. */
function spread(timeMs: number) {
  const width = 6000 + timeMs * 0.04
  return { timeMs, earlyMs: timeMs - width, lateMs: timeMs + width }
}

/**
 * Probes made one every 13 seconds, from the 5th, with a pause of some seconds after one of them,
 * then each army unit at the times given.
 */
function units(
  probes: number,
  pause: [afterNth: number, seconds: number],
  army: Array<[unitId: number, ...times: string[]]>,
): BuildStepSummary[] {
  const list: BuildStepSummary[] = []
  for (let nth = 5; nth < 5 + probes; nth++) {
    const timeMs = (nth - 5) * 13_000 + (nth > pause[0] ? pause[1] * 1000 : 0)
    list.push({ key: 'u64', nth, ...spread(timeMs), share: 0.95 })
  }
  for (const [unitId, ...times] of army) {
    times.forEach((at, i) =>
      list.push({ key: `u${unitId}`, nth: i + 1, ...spread(time(at)), share: 0.8 }),
    )
  }
  return list.sort((a, b) => a.timeMs - b.timeMs)
}

function side({
  games,
  wins,
  withUser = 0,
  stepList,
  unitList = [],
  stop,
  workersAt,
  army,
}: {
  games: number
  wins: number
  withUser?: number
  stepList: BuildStepSummary[]
  unitList?: BuildStepSummary[]
  stop?: [workers: number, at: string, stopped: number]
  workersAt: number[]
  army: Array<[number, number, number, number, number]>
}): BuildSide {
  return {
    games,
    wins,
    losses: games - wins,
    withUser,
    steps: stepList,
    unitSteps: unitList,
    workerStop: stop
      ? { workers: stop[0], atMs: time(stop[1]), stopped: stop[2], games }
      : undefined,
    workersAt,
    armyMix: army.map(([unitId, ...counts]) => ({ unitId, counts })),
  }
}

/** Forge, Nexus, Gateway against Zerg, the usual way to open, and the user's. */
const forgeExpand: CoachBuild = {
  family: 'p forgeExpand u167',
  players: 38,
  others: side({
    games: 61,
    wins: 33,
    withUser: 61,
    stepList: steps([
      ['u156', 8, '0:45'],
      ['u166', 10, '1:12'],
      ['u154', 14, '1:58'],
      ['u162', 15, '2:20'],
      ['u160', 16, '2:41'],
      ['u156', 18, '3:05'],
      ['u157', 20, '3:30'],
      ['u65', 21, '3:40', 0.7],
      ['u164', 22, '3:58'],
      ['u167', 30, '5:10', 0.6],
      ['u60', 36, '6:20', 0.6],
    ]),
    unitList: units(
      40,
      [12, 20],
      [
        [65, '3:40', '4:20', '5:30', '6:40'],
        [60, '6:20', '7:10', '7:40', '8:20', '9:30', '10:40', '11:50'],
        [66, '7:30', '8:15', '8:50'],
      ],
    ),
    stop: [44, '10:05', 19],
    workersAt: [17, 26, 34, 42],
    army: [
      [65, 1, 2.2, 3.4, 4.1],
      [60, 0, 0.2, 2.6, 4.5],
      [66, 0, 0, 1.4, 3.5],
    ],
  }),
  winners: side({
    games: 33,
    wins: 33,
    withUser: 33,
    stepList: steps([
      ['u156', 8, '0:44'],
      ['u166', 10, '1:10'],
      ['u154', 14, '1:55'],
      ['u162', 15, '2:18'],
      ['u160', 16, '2:38'],
      ['u156', 18, '3:01'],
      ['u157', 20, '3:22'],
      ['u65', 21, '3:35'],
      ['u164', 22, '3:49'],
      ['u167', 29, '4:58'],
      ['u60', 35, '6:05'],
    ]),
    unitList: units(
      42,
      [12, 14],
      [
        [65, '3:35', '4:15', '5:40'],
        [60, '6:05', '6:50', '7:20', '7:50', '8:30'],
        [66, '7:10', '8:00', '8:35', '9:10'],
      ],
    ),
    stop: [46, '10:20', 9],
    workersAt: [18, 27, 36, 44],
    army: [
      [65, 1, 2, 3, 3.8],
      [60, 0, 0.5, 3.1, 5.2],
      [66, 0, 0, 1.8, 4.2],
    ],
  }),
  user: side({
    games: 18,
    wins: 8,
    withUser: 18,
    stepList: steps([
      ['u156', 8, '0:46'],
      ['u166', 10, '1:15'],
      ['u154', 14, '2:06'],
      ['u162', 15, '2:31'],
      ['u160', 17, '3:02'],
      ['u156', 19, '3:20'],
      ['u157', 21, '3:58'],
      ['u65', 21, '3:40'],
      ['u164', 23, '4:31'],
      ['u60', 34, '6:40'],
    ]),
    unitList: units(
      36,
      [10, 35],
      [
        [65, '3:40', '4:05', '4:50', '5:30', '6:20'],
        [66, '8:10', '9:05'],
      ],
    ),
    stop: [36, '8:10', 14],
    workersAt: [16, 24, 31, 36],
    army: [
      [65, 2, 3.1, 4.2, 5],
      [66, 0, 0, 0.8, 2.4],
    ],
  }),
}

const oneGateCore: CoachBuild = {
  family: 'p gates1 expand u163',
  players: 14,
  others: side({
    games: 19,
    wins: 9,
    withUser: 19,
    stepList: steps([
      ['u156', 8, '0:45'],
      ['u160', 10, '1:15'],
      ['u157', 11, '1:30'],
      ['u164', 13, '2:20'],
      ['u154', 20, '3:45'],
      ['u163', 26, '4:40', 0.7],
    ]),
    unitList: units(
      20,
      [11, 25],
      [
        [65, '2:10'],
        [66, '3:30', '4:10', '4:45', '5:30', '6:40'],
        [61, '7:20', '8:30'],
      ],
    ),
    stop: [30, '7:10', 12],
    workersAt: [15, 22, 28, 30],
    army: [
      [65, 1, 1.5, 1.8, 2],
      [66, 0.6, 3.1, 5, 6.2],
      [61, 0, 0, 1.6, 2.1],
    ],
  }),
}

const twoGate: CoachBuild = {
  family: 'p gates2',
  players: 6,
  others: side({
    games: 7,
    wins: 4,
    withUser: 7,
    stepList: steps([
      ['u156', 8, '0:45'],
      ['u160', 9, '1:05'],
      ['u160', 10, '1:22'],
      ['u65', 12, '1:58'],
    ]),
    stop: [18, '4:30', 6],
    workersAt: [13, 18, 18, 19],
    army: [[65, 5.4, 8.1, 8.8, 9]],
  }),
}

const bucket: CoachBucket = {
  ...pvz,
  builds: [forgeExpand, oneGateCore, twoGate],
  userBuild: forgeExpand.family,
}

const teamBuilds: CoachTeamBuild[] = [
  {
    families: ['p forgeExpand u167', 'z overpool muta2'],
    games: 14,
    wins: 9,
    losses: 5,
    userGames: 6,
    userWins: 4,
    userLosses: 2,
  },
  {
    families: ['p gates2', 'z pool9 speed'],
    games: 8,
    wins: 3,
    losses: 5,
    userGames: 0,
    userWins: 0,
    userLosses: 0,
  },
]

const teamBucket: CoachBucket = {
  ...bucket,
  shape: '2v2',
  opponentRace: undefined,
  allyRace: 'z',
  anyAlly: false,
  buildsAgainst: [
    { opponents: 'tz', games: 24, builds: [forgeExpand, twoGate], userBuild: forgeExpand.family },
    { opponents: 'pp', games: 12, builds: [twoGate] },
  ],
  teamBuilds,
}

const cases: Array<[string, CoachResult]> = [
  [
    'PvZ on every map',
    {
      status: 'ready',
      scopes,
      eapmFloor: 150,
      scope: pvzScope,
      ...recentWindow,
      buckets: [bucket],
    },
  ],
  [
    '2v2 with a Zerg teammate, picking who the builds were against',
    {
      status: 'ready',
      scopes: [{ shape: '2v2', race: 'p', allyRace: 'z', games: 40 }, ...scopes],
      eapmFloor: 120,
      scope: { shape: '2v2', race: 'p', allyRace: 'z' },
      ...recentWindow,
      buckets: [teamBucket],
    },
  ],
  [
    'PvZ on one map, too few games to tell builds apart',
    {
      status: 'ready',
      scopes,
      eapmFloor: 150,
      scope: pvzScope,
      ...recentWindow,
      mapKey: 'polypoid',
      buckets: [{ ...bucket, builds: [] }],
    },
  ],
]

/** The Builds page with made up numbers, for game types real data may not have. */
export function BuildsTest() {
  return (
    <>
      {cases.map(([label, coach]) => (
        <section key={label}>
          <CaseLabel>{label}</CaseLabel>
          <BuildsView coach={coach} />
        </section>
      ))}
    </>
  )
}
