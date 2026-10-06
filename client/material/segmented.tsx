import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { labelLarge } from '../styles/typography'
import { buttonReset } from './button-reset'
import { MenuList } from './menu/menu'
import { SelectableMenuItem } from './menu/selectable-item'
import { Popover, usePopoverController, useRefAnchorPosition } from './popover'

const Root = styled.div`
  flex-shrink: 0;
  padding: 4px;

  display: inline-flex;
  gap: 2px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-md);
  background-color: var(--theme-container-low);
`

const Segment = styled.button<{ $on: boolean }>`
  ${buttonReset};
  ${labelLarge};
  height: 30px;
  padding: 0 12px;

  border-radius: var(--radius-sm);
  background-color: ${props => (props.$on ? 'var(--theme-container-highest)' : 'transparent')};
  color: ${props => (props.$on ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)')};
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    color: var(--theme-on-surface);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 1px;
  }
`

export interface SegmentOption<T> {
  value: T
  label: string
  /** A longer description, for when the label is short, like a race's letter. */
  title?: string
}

/** A row of buttons picking one of a few options, like a game type to filter by. */
export function Segmented<T>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** Says what's being picked, for screen readers. */
  label: string
  options: ReadonlyArray<SegmentOption<T>>
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <Root role='group' aria-label={label} className={className}>
      {options.map(option => (
        <Segment
          key={option.label}
          type='button'
          title={option.title}
          aria-label={option.title}
          $on={option.value === value}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}>
          {option.label}
        </Segment>
      ))}
    </Root>
  )
}

/** The same height and frame as `Segmented`, so the two can stand in for each other in a bar. */
const MenuButton = styled.button`
  ${buttonReset};
  ${labelLarge};
  flex-shrink: 0;
  height: 40px;
  padding: 0 10px 0 12px;

  display: inline-flex;
  align-items: center;
  gap: 6px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-md);
  background-color: var(--theme-container-low);
  color: var(--theme-on-surface);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background-color: var(--theme-container);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const MenuButtonLabel = styled.span`
  color: var(--theme-on-surface-variant);
  font-weight: 500;
`

const Chevron = styled(MaterialIcon).attrs({ icon: 'expand_more', size: 18 })`
  color: var(--theme-on-surface-variant);
`

/**
 * The same choice as `Segmented`, as a button that opens a menu, for a bar without room for every
 * segment. Shows what's being picked and the current option.
 */
export function SegmentMenu<T>({
  label,
  showLabel = true,
  options,
  value,
  onChange,
}: {
  label: string
  /** Whether the button says what's being picked, or only the current option, for a captioned field. */
  showLabel?: boolean
  options: ReadonlyArray<SegmentOption<T>>
  value: T
  onChange: (value: T) => void
}) {
  const [anchor, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('left', 'bottom')
  const [open, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })
  const current = options.find(o => o.value === value) ?? options[0]

  return (
    <>
      <MenuButton
        ref={anchor}
        type='button'
        aria-haspopup='menu'
        aria-label={showLabel ? undefined : `${label}: ${current.title ?? current.label}`}
        onClick={openMenu}>
        {showLabel ? <MenuButtonLabel>{label}</MenuButtonLabel> : null}
        {current.title ?? current.label}
        <Chevron />
      </MenuButton>
      <Popover
        open={open}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='left'
        originY='top'>
        <MenuList dense={true}>
          {options.map(option => (
            <SelectableMenuItem
              key={option.label}
              text={option.title ?? option.label}
              selected={option.value === value}
              onClick={() => {
                closeMenu()
                onChange(option.value)
              }}
            />
          ))}
        </MenuList>
      </Popover>
    </>
  )
}
