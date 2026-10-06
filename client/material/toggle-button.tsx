import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { labelLarge } from '../styles/typography'
import { buttonReset } from './button-reset'

const Root = styled.button<{ $pressed: boolean }>`
  ${buttonReset};
  ${labelLarge};
  height: 40px;
  padding: 0 14px 0 12px;

  display: inline-flex;
  align-items: center;
  gap: 8px;

  background-color: ${props =>
    props.$pressed ? 'var(--theme-container-highest)' : 'var(--theme-container-low)'};
  border: 1px solid
    ${props => (props.$pressed ? 'var(--theme-outline)' : 'var(--theme-outline-variant)')};
  border-radius: var(--radius-md);
  color: var(--theme-on-surface);
  cursor: pointer;
  font-weight: 600;

  &:hover {
    background-color: var(--theme-container-high);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

/**
 * A button that stays on or off, like hiding results. Its icon and label can change with its
 * state so it always says what's showing.
 */
export function ToggleButton({
  pressed,
  label,
  icon,
  onChange,
  className,
  testName,
}: {
  pressed: boolean
  label: string
  /** A Material Symbols icon name. */
  icon: string
  onChange: (pressed: boolean) => void
  className?: string
  testName?: string
}) {
  return (
    <Root
      type='button'
      $pressed={pressed}
      aria-pressed={pressed}
      className={className}
      data-testid={testName}
      onClick={() => onChange(!pressed)}>
      <MaterialIcon icon={icon} size={18} />
      {label}
    </Root>
  )
}
