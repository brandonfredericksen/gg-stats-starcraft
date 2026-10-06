import * as React from 'react'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from './button-reset'
import { Tooltip } from './tooltip'

/** The play button's width and height, matching the status button beside it in lists. */
export const PLAY_BUTTON_SIZE = 32

const Root = styled.button`
  ${buttonReset};
  width: ${PLAY_BUTTON_SIZE}px;
  height: ${PLAY_BUTTON_SIZE}px;
  flex-shrink: 0;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  background: linear-gradient(180deg, var(--theme-panel-sheen), var(--theme-container-low));
  border: 1px solid var(--theme-outline);
  border-radius: var(--radius-full);
  box-shadow: inset 0 1px 0 var(--theme-panel-highlight);
  color: var(--theme-on-surface);
  cursor: pointer;

  &:hover {
    background: var(--theme-container-highest);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

/** A small round button that plays something, like watching a replay. */
export function PlayButton({
  label,
  onClick,
  className,
}: {
  /** Describes what plays, for the tooltip and screen readers. */
  label: string
  onClick?: (event: React.MouseEvent) => void
  className?: string
}) {
  return (
    <Tooltip text={label} position='top' tabIndex={-1}>
      <Root type='button' className={className} aria-label={label} onClick={onClick}>
        <MaterialIcon icon='play_arrow' size={18} />
      </Root>
    </Tooltip>
  )
}
