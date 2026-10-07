import styled from 'styled-components'
import { Link } from 'wouter'
import { CoachTest } from './coach/devonly/coach-test'
import { DevSection } from './debug/dev-section'
import { GameStatsTest } from './games/devonly/game-stats-test'
import DevMaterial from './material/devonly/routes'
import { DemoPlayerTest } from './my-stats/devonly/demo-player-test'
import { DotsTest } from './progress/devonly/dots-test'
import { DevReplays } from './replays/devonly/routes'
import { DevSettings } from './settings/devonly/routes'
import { DevStarcraft } from './starcraft/devonly/dev-starcraft'

const Container = styled.div`
  width: 100%;
  height: calc(100% - var(--gg-system-bar-height, 0px));
  overflow: hidden;
`

const HomeLink = styled.div`
  width: 100%;
  height: 32px;
  padding-left: 16px;
  line-height: 32px;
  border-bottom: 1px solid var(--theme-outline);
`

const Content = styled.div`
  height: calc(100% - 32px);
  overflow-y: auto;
`

export default function Dev() {
  return (
    <Container>
      <HomeLink>
        <Link href='/replays'>Replays</Link>
      </HomeLink>
      <Content>
        <DevSection
          baseUrl='/dev'
          routes={[
            ['Demo player', 'demo-player', DemoPlayerTest],
            ['Game stats', 'game-stats', GameStatsTest],
            ['Material components', 'material', DevMaterial],
            ['My stats coach', 'coach', CoachTest],
            ['Progress indicators', 'progress', DotsTest],
            ['Replay components', 'replays', DevReplays],
            ['Settings components', 'settings', DevSettings],
            ['Starcraft', 'starcraft', DevStarcraft],
          ]}
        />
      </Content>
    </Container>
  )
}
