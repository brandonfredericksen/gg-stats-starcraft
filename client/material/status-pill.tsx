import * as React from 'react'
import styled, { css } from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from './button-reset'
import { Tooltip } from './tooltip'

/**
 * The status is a round button the same size as the play button beside it, so a column of them
 * lines up row after row.
 */
export const STATUS_PILL_WIDTH = 32

const round = css`
  ${buttonReset};
  width: ${STATUS_PILL_WIDTH}px;
  height: ${STATUS_PILL_WIDTH}px;
  flex-shrink: 0;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: var(--radius-full);

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const ReadyRoot = styled.button`
  ${round};
  background-color: var(--theme-info-container);
  color: var(--theme-info);
  cursor: pointer;

  &:hover {
    background-color: rgb(from var(--theme-info) r g b / 0.24);
  }
`

const RunningRoot = styled.span`
  ${round};
  border: 1px solid rgb(from var(--theme-info) r g b / 0.5);
  color: var(--theme-info);
`

const Spinner = styled.span`
  width: 12px;
  height: 12px;

  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: var(--radius-full);
  animation: status-pill-spin 0.8s linear infinite;

  @keyframes status-pill-spin {
    to {
      transform: rotate(360deg);
    }
  }
`

const IdleRoot = styled.button`
  ${round};
  border: 1px dashed var(--theme-outline-strong);
  color: var(--theme-on-surface-variant);
  cursor: pointer;

  &:hover {
    border-color: var(--theme-on-surface-variant);
    color: var(--theme-on-surface);
  }
`

export type AnalysisStatus = 'ready' | 'running' | 'none'

interface StatusPillProps {
  status: AnalysisStatus
  readyLabel: string
  runningLabel: string
  noneLabel: string
  /** Opens the stats when they're ready, or starts an analysis when there are none. */
  onClick?: (event: React.MouseEvent) => void
  className?: string
}

/**
 * Where a game's analysis stands, as a round button: a soft blue chart when its stats are ready, a
 * spinner while it's analyzed, and a dashed bolt when it can be analyzed. Its label shows in a
 * tooltip and is read out by screen readers.
 */
export function StatusPill(props: StatusPillProps) {
  const { status, readyLabel, runningLabel, noneLabel } = props
  const label = { ready: readyLabel, running: runningLabel, none: noneLabel }[status]
  return (
    <Tooltip text={label} position='top' tabIndex={-1}>
      <StatusButton {...props} />
    </Tooltip>
  )
}

function StatusButton({
  status,
  readyLabel,
  runningLabel,
  noneLabel,
  onClick,
  className,
}: StatusPillProps) {
  switch (status) {
    case 'ready':
      return (
        <ReadyRoot type='button' className={className} aria-label={readyLabel} onClick={onClick}>
          <MaterialIcon icon='bar_chart' size={18} />
        </ReadyRoot>
      )
    case 'running':
      return (
        <RunningRoot className={className} role='status' aria-label={runningLabel}>
          <Spinner />
        </RunningRoot>
      )
    case 'none':
      return (
        <IdleRoot type='button' className={className} aria-label={noneLabel} onClick={onClick}>
          <svg
            width='16'
            height='16'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2.2'
            strokeLinecap='round'
            strokeLinejoin='round'
            aria-hidden={true}>
            <path d='M13 3L5 13h6l-1 8 8-10h-6z' />
          </svg>
        </IdleRoot>
      )
    default:
      return status satisfies never
  }
}
