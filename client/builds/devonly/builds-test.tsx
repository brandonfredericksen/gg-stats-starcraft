import styled from 'styled-components'
import { BuildSide, BuildStepSummary, CoachBuild } from '../../../common/my-stats/builds'
import { CoachResult } from '../../../common/my-stats/coach'
import { pvz, pvzScope, recentWindow, scopes } from '../../coach/devonly/coach-test'
import { BuildsView } from '../builds-page'

const CaseLabel = styled.h2`
  margin: 24px 32px 0;
  color: var(--theme-on-surface-variant);
`

function steps(list: Array<[key: string, supply: number, time: string, share?: number]>) {
  const seen = new Map<string, number>()
  return list.map(([key, supply, time, share = 0.9]): BuildStepSummary => {
    const nth = (seen.get(key) ?? 0) + 1
    seen.set(key, nth)
    const [minutes, seconds] = time.split(':').map(Number)
    return { key, nth, supply, timeMs: (minutes * 60 + seconds) * 1000, share }
  })
}

function side(
  games: number,
  wins: number,
  stepList: BuildStepSummary[],
  workers: [number, string, number] | undefined,
  army: Array<[number, number, number, number]>,
): BuildSide {
  const [count, time, stopped] = workers ?? [0, '0:00', 0]
  const [minutes, seconds] = time.split(':').map(Number)
  return {
    games,
    wins,
    losses: games - wins,
    steps: stepList,
    workerStop: workers
      ? { workers: count, atMs: (minutes * 60 + seconds) * 1000, stopped, games }
      : undefined,
    armyMix: army.map(([unitId, ...counts]) => ({ unitId, counts })),
  }
}

/** Forge, Nexus, Gateway against Zerg, the usual way to open, and the user's. */
const forgeExpand: CoachBuild = {
  family: 'expand:forge',
  players: 38,
  others: side(
    61,
    33,
    steps([
      ['u156', 8, '0:45'],
      ['u166', 10, '1:12'],
      ['u154', 14, '1:58'],
      ['u162', 15, '2:20'],
      ['u160', 16, '2:41'],
      ['u156', 18, '3:05'],
      ['u157', 20, '3:30'],
      ['u164', 22, '3:58'],
      ['u157', 28, '4:50', 0.6],
    ]),
    [42, '9:40', 19],
    [
      [65, 1, 2.2, 4.1],
      [66, 0, 1.4, 3.5],
      [60, 0, 0, 1.2],
    ],
  ),
  winners: side(
    33,
    33,
    steps([
      ['u156', 8, '0:44'],
      ['u166', 10, '1:10'],
      ['u154', 14, '1:55'],
      ['u162', 15, '2:18'],
      ['u160', 16, '2:38'],
      ['u156', 18, '3:01'],
      ['u157', 20, '3:22'],
      ['u164', 22, '3:49'],
      ['u157', 27, '4:35', 0.7],
    ]),
    [44, '10:05', 9],
    [
      [65, 1, 2, 3.8],
      [66, 0, 1.8, 4.2],
      [60, 0, 0, 1.5],
    ],
  ),
  user: side(
    18,
    8,
    steps([
      ['u156', 8, '0:46'],
      ['u166', 10, '1:15'],
      ['u154', 14, '2:06'],
      ['u162', 15, '2:31'],
      ['u160', 17, '3:02'],
      ['u156', 19, '3:20'],
      ['u157', 21, '3:58'],
      ['u164', 23, '4:31'],
    ]),
    [36, '8:10', 14],
    [
      [65, 2, 3.1, 5],
      [66, 0, 0.8, 2.4],
    ],
  ),
}

const oneGateCore: CoachBuild = {
  family: 'oneBase:gates1',
  players: 14,
  others: side(
    19,
    9,
    steps([
      ['u156', 8, '0:45'],
      ['u160', 10, '1:15'],
      ['u157', 11, '1:30'],
      ['u164', 13, '2:20'],
      ['u154', 20, '3:45'],
    ]),
    [30, '7:10', 12],
    [
      [65, 1, 1.5, 2],
      [66, 0.6, 3.1, 6.2],
    ],
  ),
}

const twoGate: CoachBuild = {
  family: 'oneBase:gates2',
  players: 6,
  others: side(
    7,
    4,
    steps([
      ['u156', 8, '0:45'],
      ['u160', 9, '1:05'],
      ['u160', 10, '1:22'],
    ]),
    [18, '4:30', 6],
    [[65, 5.4, 8.1, 9]],
  ),
}

const bucket = {
  ...pvz,
  builds: [forgeExpand, oneGateCore, twoGate],
  userBuild: 'expand:forge',
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

/** The Builds page with made up numbers, for a 1v1 with a map menu, which real data may not have. */
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
