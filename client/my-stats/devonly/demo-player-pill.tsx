import { useSetAtom } from 'jotai'
import styled from 'styled-components'
import { DEMO_PLAYER_NAME } from '../../../common/my-stats/demo-player'
import { buttonReset } from '../../material/button-reset'
import { zIndexMenu } from '../../material/zindex'
import { labelMedium } from '../../styles/typography'
import { demoPlayerAtom, useDemoPlayer } from '../demo-player'

const Root = styled.div`
  ${labelMedium};
  position: fixed;
  left: 24px;
  bottom: 24px;
  z-index: ${zIndexMenu};
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);

  display: flex;
  align-items: center;
  gap: var(--space-2);

  background-color: var(--theme-purple-container);
  border-radius: var(--radius-md);
  color: var(--theme-on-purple-container);
`

const StopButton = styled.button`
  ${buttonReset};
  ${labelMedium};
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-weight: 700;

  &:hover {
    background-color: rgb(255 255 255 / 0.12);
  }
`

/** Says that My stats and the coach are showing the made up player, with a way back. */
export function DemoPlayerPill() {
  const demo = useDemoPlayer()
  const setDemo = useSetAtom(demoPlayerAtom)
  if (!demo) {
    return null
  }
  return (
    <Root>
      <span>Showing {DEMO_PLAYER_NAME}</span>
      <StopButton type='button' onClick={() => setDemo(false)}>
        Stop
      </StopButton>
    </Root>
  )
}
