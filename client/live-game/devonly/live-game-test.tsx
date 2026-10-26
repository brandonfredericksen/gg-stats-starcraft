import { useSetAtom } from 'jotai'
import { useState } from 'react'
import styled from 'styled-components'
import { LiveGame, LiveGamePlayer } from '../../../common/live-game'
import { RaceChar } from '../../../common/races'
import { TextButton } from '../../material/button'
import { push } from '../../navigation/routing'
import { liveGameAtom } from '../live-game-atoms'

const Root = styled.div`
  padding: var(--space-4);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
`

/** A made up name for the user, so the samples can be shown anywhere. */
const ME = 'Kestrel'

const RACES: RaceChar[] = ['p', 'z', 'r', 't']
const DIVISIONS = ['bronze2', 'silver1', 'gold1', 'platinum1', 'diamond3', 'champion']

/** A ShieldBattery game of these people, the first half on one team, with races and ratings. */
function teamGame(names: string[]): LiveGamePlayer[] {
  const size = Math.ceil(names.length / 2)
  return names.map((name, i) => ({
    name,
    slot: i,
    team: i < size ? 0 : 1,
    race: RACES[i % RACES.length],
    shieldBattery: {
      rating: 1300 + ((i * 137) % 500),
      division: DIVISIONS[i % DIVISIONS.length],
      // Some players were opened in ShieldBattery, so their records are known.
      record: i % 2 ? undefined : { mode: '3v3bgh', wins: 40 + i * 7, losses: 35 + i * 3 },
    },
  }))
}

/** Made up games of each kind, with made up people in them. */
function getSamples(): LiveGame[] {
  const noticedMs = Date.now()
  return [
    {
      id: `dev-ladder-${noticedMs}`,
      source: 'ladder',
      noticedMs,
      players: [
        { name: ME, gatewayId: 10, ladder: { rating: 1075, rank: 'f', wins: 3, losses: 6 } },
        {
          name: 'Mordant',
          gatewayId: 30,
          battleTag: 'Mordant#3141',
          ladder: { rating: 1430, rank: 'd', wins: 97, losses: 104 },
          otherAccounts: ['quietbunker', 'mordant.2'],
        },
      ],
    },
    {
      id: `dev-shieldbattery-${noticedMs}`,
      source: 'shieldBattery',
      noticedMs,
      mapName: 'Big Game Hunters 26.5',
      tileset: 'jungle',
      players: teamGame([ME, 'Bramble', 'Cinder', 'Dovetail', 'Ember', 'Foxglove']),
    },
    {
      id: `dev-shieldbattery-4v4-${noticedMs}`,
      source: 'shieldBattery',
      noticedMs,
      mapName: 'Fastest',
      tileset: 'badlands',
      players: [
        ...teamGame([ME, 'Bramble', 'Cinder', 'Dovetail', 'Ember', 'Foxglove', 'Gorse', 'Heath']),
        { name: 'Isolde', observer: true },
      ],
    },
    {
      id: `dev-empty-ladder-${noticedMs}`,
      source: 'ladder',
      noticedMs,
      players: [],
    },
    {
      id: `dev-match-found-${noticedMs}`,
      source: 'shieldBattery',
      noticedMs,
      matchFound: { playerCount: 6, accepted: 6, phase: 'drafting' },
      players: ['Bramble', 'Cinder'].map((name, i) => ({
        name,
        shieldBattery: {
          rating: 1500 + i * 90,
          record: { mode: '3v3bgh', wins: 60 + i * 20, losses: 50 + i * 4 },
        },
      })),
    },
  ]
}

/** Puts a made up game on the Live game page, to work on it without joining one. */
export function LiveGameTest() {
  const setLiveGame = useSetAtom(liveGameAtom)
  const show = (game: LiveGame | undefined) => {
    setLiveGame(game)
    push('/live-game')
  }
  const [ladder, shieldBattery, fourVFour, empty, matchFound] = getSamples()
  const [teamNames, setTeamNames] = useState('')
  const typedNames = teamNames
    .split(',')
    .map(n => n.trim())
    .filter(Boolean)
  const [name, setName] = useState('')
  // "Them", or "me, them" to play as someone else, each with a made up ladder standing.
  const withPlayer = (): LiveGame => {
    const [first, second] = name.split(',').map(n => n.trim())
    const me = second ? { ...ladder.players[0], name: first } : ladder.players[0]
    const them = second ?? first
    return {
      ...ladder,
      id: `dev-player-${name}`,
      players: [me, { ...ladder.players[1], name: them, battleTag: `${them}#1234` }],
    }
  }
  return (
    <Root>
      <input
        value={name}
        placeholder='A player to look up, or me, them'
        aria-label='A player to look up'
        onChange={event => setName(event.target.value)}
      />
      <TextButton
        label='Ladder match against them'
        disabled={!name.trim()}
        onClick={() => show(withPlayer())}
      />
      <input
        value={teamNames}
        placeholder='Players, comma separated, your team first'
        aria-label='Players, comma separated, your team first'
        onChange={event => setTeamNames(event.target.value)}
      />
      <TextButton
        label='ShieldBattery game with them'
        disabled={typedNames.length < 2}
        onClick={() =>
          show({ ...shieldBattery, id: `dev-team-${teamNames}`, players: teamGame(typedNames) })
        }
      />
      <TextButton label='Ladder match' onClick={() => show(ladder)} />
      <TextButton label='ShieldBattery 3v3' onClick={() => show(shieldBattery)} />
      <TextButton label='ShieldBattery 4v4' onClick={() => show(fourVFour)} />
      <TextButton label='Match found, no players yet' onClick={() => show(empty)} />
      <TextButton
        label='ShieldBattery match found, two players opened'
        onClick={() => show(matchFound)}
      />
      <TextButton
        label='ShieldBattery match found, none opened'
        onClick={() => show({ ...matchFound, id: `${matchFound.id}-none`, players: [] })}
      />
      <TextButton label='No game' onClick={() => show(undefined)} />
    </Root>
  )
}
