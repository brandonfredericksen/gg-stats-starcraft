import { useSetAtom } from 'jotai'
import styled from 'styled-components'
import { LiveGame } from '../../../common/live-game'
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

/** Made up games of each kind, with made up people in them. */
function getSamples(): LiveGame[] {
  const noticedMs = Date.now()
  return [
    {
      id: `dev-ladder-${noticedMs}`,
      source: 'ladder',
      noticedMs,
      started: true,
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
      id: `dev-lobby-${noticedMs}`,
      source: 'lobby',
      noticedMs,
      started: false,
      players: [
        { name: 'Quarry', slot: 0, race: 'z', gatewayId: 10, battleTag: 'Quarry#2718' },
        { name: 'Thistle', slot: 1, race: 'r' },
        { name: ME, slot: 2, race: 'p' },
        { name: 'Ardent', slot: 4 },
        { name: 'Bramble', slot: 5, race: 't' },
        { name: 'Lookout', slot: 128, observer: true },
      ],
    },
    {
      id: `dev-shieldbattery-${noticedMs}`,
      source: 'shieldBattery',
      noticedMs,
      started: true,
      players: [{ name: ME }, { name: 'Bramble' }, { name: 'Cinder' }, { name: 'Dovetail' }],
    },
    {
      id: `dev-empty-ladder-${noticedMs}`,
      source: 'ladder',
      noticedMs,
      started: true,
      players: [],
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
  const [ladder, lobby, shieldBattery, empty] = getSamples()
  return (
    <Root>
      <TextButton label='Ladder match' onClick={() => show(ladder)} />
      <TextButton label='Custom lobby' onClick={() => show(lobby)} />
      <TextButton label='ShieldBattery game' onClick={() => show(shieldBattery)} />
      <TextButton label='Match found, no players yet' onClick={() => show(empty)} />
      <TextButton label='No game' onClick={() => show(undefined)} />
    </Root>
  )
}
