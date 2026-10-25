import styled from 'styled-components'
import { headlineMedium, labelSmall } from '../styles/typography'
import { PaddedPanel } from './my-stats-panels'

/** The page, as a container so its sections can stack in a narrow window. */
export const Root = styled.div`
  container: page / inline-size;
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-8) 48px;

  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`

export const Header = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-3);
`

export const Title = styled.h1`
  ${headlineMedium};
  margin: 0;
`

export const Badge = styled.span`
  ${labelSmall};
  height: 20px;
  padding: 0 var(--space-2);

  display: inline-flex;
  align-items: center;

  border: 1px solid var(--theme-outline-strong);
  border-radius: var(--radius-full);
  color: var(--theme-on-surface-variant);
  font-weight: 700;
`

/** A panel with a message in place of a page's content, like why there's nothing to show. */
export const Message = styled(PaddedPanel)`
  gap: var(--space-3);
`
