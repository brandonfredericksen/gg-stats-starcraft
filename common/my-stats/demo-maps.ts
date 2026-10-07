import { GameShape } from '../games/player-metrics'

/** A map the demo player plays, with the titles it's seen under and how often each is. */
export interface DemoMap {
  weight: number
  titles: ReadonlyArray<{ title: string; weight: number }>
}

/**
 * A map and the titles replays have it under. The first title is the usual one, and the rest are
 * versions, league tags and Korean uploads, so the grouping has something to group.
 */
function map(weight: number, titles: ReadonlyArray<string>): DemoMap {
  return {
    weight,
    titles: titles.map((title, i) => ({ title, weight: i === 0 ? 5 : 2 / i })),
  }
}

/**
 * The most played maps in each game type, from the ladder pools of the last few years and what
 * public lobbies play, most played first, under the titles their uploads go by.
 */
const ONE_V_ONE: ReadonlyArray<DemoMap> = [
  map(14, [
    'Fighting Spirit 1.3',
    '| iCCup | Fighting Spirit 1.3',
    '투혼 1.3',
    'Fighting Spirit 1.4',
  ]),
  map(12, ['Polypoid 1.75', 'Polypoid 1.65', '폴리포이드 1.75']),
  map(8, ['Radeon 1.2', 'Radeon 1.1', '라데온 1.2']),
  map(6, ['Pole Star 1.1', 'Pole Star 1.0', '폴스타 1.1']),
  map(6, ['KnockOut 1.4', 'KnockOut 1.15', '녹아웃 1.4']),
  map(5, ['Dominator SE 2.0', 'Dominator 1.2', 'Dominator 1.01']),
  map(5, ['Attitude SE 2.1', 'Attitude 1.0']),
  map(4, ['Octagon SE 2.0', 'Octagon 1.0']),
  map(4, ['Metropolis 1.1', 'Metropolis 1.0', '메트로폴리스 1.1']),
  map(3.5, ['Deja Vu SE 2.0', 'Deja Vu 1.1', '데자뷰 1.1']),
  map(3, ['Eclipse 1.3', '| iCCup | Eclipse 1.2', 'Eclipse 1.21']),
  map(3, ['Neo Dark Origin 2.1', 'Neo Dark Origin 2.0']),
  map(2.5, ['Apocalypse 1.4', 'Apocalypse_1.32']),
  map(2.5, ['Retro 1.2', '(4)Retro 1.1']),
  map(2.5, ['Vermeer SE 2.1', 'Vermeer 1.3']),
  map(2, ['Neo Sylphid 3.0', 'Neo Sylphid 3.2']),
  map(2, ['| iCCup | Circuit Breakers 1.0', 'Circuit Breakers 1.1', '써킷브레이커 1.0']),
  map(2, ['MatchPoint 1.35', '| iCCup | Match Point 1.3', '매치포인트 1.35']),
  map(1.5, ['Jane Doe 1.2', 'Jane Doe 1.0']),
  map(1.5, ['Backrooms 1.1', 'Backrooms 1.0']),
  map(1, ['울돌목(鳴梁) 1.0', '울돌목 (鳴梁) 0.90']),
  map(1, ['Litmus 1.1', 'Litmus 1.0']),
  map(1, ['Death Valley 1.0', 'DeathValley 1.0']),
  map(1, ['Monty Hall_SE 2.3', '| iCCup | Monty Hall_SE 2.1']),
  map(1, ['KICK BACK 1.3', 'KICK BACK 1.0']),
]

const TWO_V_TWO: ReadonlyArray<DemoMap> = [
  map(14, ['Fighting Spirit 1.4', 'Fighting Spirit 1.3', '투혼 1.3']),
  map(11, ['Big Game Hunters', '(XB2) Big Game Hunters']),
  map(8, ['The Hunters', 'The Hunters - Remastered']),
  map(7, ['Fastest Possible Map', 'New Super◆빠른무한']),
  map(6, ['Polypoid 1.75', 'Polypoid 1.65']),
  map(5, ['Lost Temple 2.4', '| iCCup | Lost Temple 2.4', 'The Lost Temple']),
  map(4, ['Circuit Breakers 1.1', '| iCCup | Circuit Breakers 1.0']),
  map(4, ['| iCCup | Python 1.3', 'Python 1.3']),
  map(3.5, ['Radeon 1.2', 'Radeon 1.1']),
  map(3, ['KnockOut 1.4', 'KnockOut 1.15']),
  map(2.5, ['Andromeda 1.0', 'Andromeda 1.1']),
  map(2.5, ['Attitude SE 2.1', 'Attitude 1.0']),
  map(2, ['Octagon SE 2.0', 'Octagon 1.0']),
  map(2, ['Pole Star 1.1', 'Pole Star 1.0']),
  map(2, ['Metropolis 1.1', 'Metropolis 1.0']),
]

/** Big Game Hunters, as Blizzard's own copy and the uploads of it people play. */
const BGH = map(6, [
  'Big Game Hunters',
  'Big Game Hunters (Remastered)',
  '(XB2) Big Game Hunters',
  'Big Hunters미네랄2겹깔끔공생.',
  'Big Game Hunters_ST',
  '$$$Big Game Hunters$$$',
])

/** Fastest, as the Western Fastest Possible Map and the Korean 빠른무한 that most lobbies play. */
const FASTEST = map(4, [
  'Fastest Possible Map',
  'New Super◆빠른무한',
  'Fa§te§t Po§§ible Map Ever',
  'VGT30 Fastest Space Perfect 2',
  'Super ★ 빠른무한',
  'Fastest Possible Map ver 1.4',
])

export const DEMO_MAPS: Record<Exclude<GameShape, 'other'>, ReadonlyArray<DemoMap>> = {
  '1v1': ONE_V_ONE,
  '2v2': TWO_V_TWO,
  '3v3': [BGH, FASTEST],
  '4v4': [BGH, FASTEST],
  ffa: [map(1, ['Big Game Hunters']), map(1, ['Fastest Possible Map'])],
}
