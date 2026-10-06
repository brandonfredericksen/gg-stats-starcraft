import styled from 'styled-components'

const Outline = styled.div<{ $error?: boolean; $focused?: boolean }>`
  position: absolute;
  inset: 0;
  pointer-events: none;

  border-radius: inherit;
  box-shadow: inset 0 0 0 ${props => (props.$focused ? '2px' : '1px')}
    ${props => {
      if (props.$error) return 'var(--theme-error)'
      else if (props.$focused) return 'var(--theme-amber)'
      else return 'var(--theme-outline-variant)'
    }};

  *:hover > &[data-focused='false'] {
    box-shadow: inset 0 0 0 1px
      ${props => (props.$error ? 'var(--theme-error)' : 'var(--theme-outline)')};
  }
`

/** The rounded border around a text field or select, which thickens and takes the accent on focus. */
export function InputOutline({ error, focused }: { error?: boolean; focused?: boolean }) {
  return <Outline $error={error} $focused={focused} data-focused={!!focused} />
}
