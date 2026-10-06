import styled, { css } from 'styled-components'

/**
 * The surface treatment for panels: a fill that starts a little lighter at the top edge, as if lit
 * from above, a hairline highlight along that edge and a quiet border.
 */
export const panelSurface = css`
  background: linear-gradient(180deg, var(--theme-panel-sheen), var(--theme-container-low) 120px);
  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-lg);
  box-shadow: inset 0 1px 0 var(--theme-panel-highlight);
`

/** A panel that groups related content, like one session of games. */
export const Panel = styled.section`
  ${panelSurface};
  overflow: hidden;
`

/** A panel's header strip, slightly set apart from its content. */
export const PanelHeader = styled.div`
  padding: 12px 20px;

  display: flex;
  align-items: baseline;
  gap: 12px;

  background-color: var(--theme-container);
`

/** One row of a panel, separated from the one above by a hairline. */
export const PanelRow = styled.div`
  padding: 12px 20px;
  border-top: 1px solid var(--theme-outline-variant);

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.04);
  }
`
