import { useAtom } from 'jotai'
import styled from 'styled-components'
import { Link } from 'wouter'
import { DEMO_PLAYER_NAME } from '../../../common/my-stats/demo-player'
import { ToggleButton } from '../../material/toggle-button'
import { bodyMedium, titleLarge } from '../../styles/typography'
import { demoPlayerAtom } from '../demo-player'

const Root = styled.div`
  max-width: 720px;
  padding: 32px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Title = styled.h1`
  ${titleLarge};
  margin: 0;
`

const Text = styled.p`
  ${bodyMedium};
  margin: 0;
  color: var(--theme-on-surface-variant);
`

const Links = styled.div`
  ${bodyMedium};
  display: flex;
  gap: 16px;
`

/** Turns the made up player on and off for My stats and the coach. */
export function DemoPlayerTest() {
  const [on, setOn] = useAtom(demoPlayerAtom)
  return (
    <Root>
      <Title>Demo player</Title>
      <Text>
        Shows My stats and the coach for {DEMO_PLAYER_NAME}, a made up player with two years of
        analyzed games of every type: 1v1 and 2v2 on the most played maps under the names they're
        uploaded with, and 3v3 and 4v4 on Big Game Hunters and Fastest. Nothing is saved. It stays
        on until it's turned off here, from the pill at the bottom of the window or the app
        restarts.
      </Text>
      <div>
        <ToggleButton
          pressed={on}
          label={on ? 'Showing the demo player' : 'Show the demo player'}
          icon={on ? 'check' : 'person'}
          onChange={setOn}
        />
      </div>
      <Links>
        <Link href='/my-stats'>My stats</Link>
        <Link href='/coach'>Coach</Link>
      </Links>
    </Root>
  )
}
