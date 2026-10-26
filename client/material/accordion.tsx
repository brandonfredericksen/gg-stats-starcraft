import * as m from 'motion/react-m'
import * as React from 'react'
import { useId, useState } from 'react'
import styled from 'styled-components'
import { useIsDocumentVisible } from '../dom/document-visibility'
import { MaterialIcon } from '../icons/material/material-icon'
import { labelMedium, singleLine, titleSmall } from '../styles/typography'
import { buttonReset } from './button-reset'

const Root = styled.section`
  min-width: 0;
  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-md);
  background: var(--theme-container-low);
`

/** Lets screen readers jump from section to section by heading. */
const HeaderHeading = styled.h3`
  margin: 0;
  font: inherit;
`

const Header = styled.button`
  ${buttonReset};
  width: 100%;
  min-height: 48px;
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);

  display: flex;
  align-items: center;
  gap: var(--space-3);

  border-radius: var(--radius-md);
  color: var(--theme-on-surface);
  text-align: left;
  cursor: pointer;

  &:hover {
    background: rgb(from var(--theme-on-surface) r g b / 0.04);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: -3px;
  }
`

const Title = styled.span`
  ${titleSmall};
  flex-shrink: 0;
  font-weight: 700;
`

/** What's inside, in a few words, so a closed section still says something. */
const Summary = styled.span`
  ${labelMedium};
  ${singleLine};
  min-width: 0;
  flex: 1 1 auto;
  color: var(--theme-on-surface-variant);
`

const Chevron = styled(MaterialIcon).attrs({ icon: 'expand_more', size: 20 })<{ $open: boolean }>`
  flex-shrink: 0;
  margin-left: auto;
  color: var(--theme-on-surface-variant);
  transform: rotate(${props => (props.$open ? 180 : 0)}deg);
  transition: transform 150ms ease;
`

const Content = styled(m.div)`
  overflow: hidden;
`

const Inner = styled.div`
  padding: var(--space-1) var(--space-4) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
`

/**
 * A section that shows only its title and a short summary until it's opened, for details most
 * people want only some of the time. What's inside stays mounted while it's closed, so anything
 * typed or opened up in it is still there when it opens again.
 */
export function Accordion({
  title,
  summary,
  defaultOpen = false,
  children,
  testName,
}: {
  title: string
  summary?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
  testName?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const headerId = useId()
  const summaryId = useId()
  const contentId = useId()
  const visible = useIsDocumentVisible()
  return (
    <Root data-testid={testName}>
      <HeaderHeading>
        <Header
          id={headerId}
          type='button'
          aria-expanded={open}
          aria-controls={contentId}
          aria-describedby={summary ? summaryId : undefined}
          onClick={() => setOpen(!open)}>
          <Title>{title}</Title>
          {summary ? (
            <Summary id={summaryId} aria-hidden={true}>
              {summary}
            </Summary>
          ) : null}
          <Chevron $open={open} />
        </Header>
      </HeaderHeading>
      <Content
        id={contentId}
        role='region'
        aria-labelledby={headerId}
        inert={!open}
        initial={false}
        animate={open ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
        // With the window hidden, animation frames don't run: it opens and closes at once.
        transition={visible ? { type: 'spring', duration: 0.25, bounce: 0 } : { duration: 0 }}>
        <Inner>{children}</Inner>
      </Content>
    </Root>
  )
}
