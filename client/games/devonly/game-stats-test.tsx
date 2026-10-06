import { useSetAtom } from 'jotai'
import styled from 'styled-components'
import { FilledButton } from '../../material/button'
import { push } from '../../navigation/routing'
import { showGameStatsAtom } from '../game-stats-atoms'
import { SAMPLE_GAME_STATS } from './sample-game-stats'

const Root = styled.div`
  padding: 16px;
`

const SAMPLE_GAME_ID = 'dev-sample'

export function GameStatsTest() {
  const showGameStats = useSetAtom(showGameStatsAtom)

  return (
    <Root>
      <FilledButton
        label='Open sample stats'
        onClick={() => {
          showGameStats({
            gameId: SAMPLE_GAME_ID,
            source: { kind: 'replay', name: 'Sample PvZ', path: 'C:\\sample.rep' },
            stats: SAMPLE_GAME_STATS,
          })
          push(`/replays/stats/${SAMPLE_GAME_ID}`)
        }}
      />
    </Root>
  )
}
