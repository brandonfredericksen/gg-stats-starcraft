import React from 'react'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from '../material/button-reset'
import { LoadingDotsArea } from '../progress/dots'
import {
  bodyLarge,
  bodyMedium,
  headlineMedium,
  labelLarge,
  labelMedium,
  titleLarge,
  titleMedium,
} from '../styles/typography'

/** Holds a settings page's sections, with a divider between each. */
export const FormContainer = styled.div`
  width: 100%;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

export const SectionOverline = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

export const SectionContainer = styled.div`
  display: flex;
  flex-direction: column;

  & + & {
    padding-top: 24px;
    border-top: 1px solid var(--theme-outline-variant);
  }
`

/**
 * A prominent section header, for settings pages organized as titled sections with descriptions.
 * Adds a small gap before whatever follows; when that's a `SettingsSectionDescription`, the two
 * sit flush against each other instead (the description provides its own spacing below).
 */
export const SettingsSectionHeader = styled.div`
  ${titleMedium};
  margin-bottom: 8px;
`

/** A muted description line following a `SettingsSectionHeader`. */
export const SettingsSectionDescription = styled.div`
  ${bodyMedium};
  margin-bottom: 12px;
  color: var(--theme-on-surface-variant);

  ${SettingsSectionHeader} + & {
    margin-top: -4px;
  }
`

export const Root = styled.div`
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  /* Room at the end so the last sections can scroll up to the top when jumped to */
  padding: 32px 32px 40vh;

  display: flex;
  align-items: flex-start;
  gap: 40px;
`

export const SideNav = styled.nav`
  position: sticky;
  top: 32px;
  width: 220px;
  flex-shrink: 0;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

export const NavTitle = styled.h1`
  ${headlineMedium};
  margin: 0;
  padding-left: 12px;
`

export const NavVersion = styled.div`
  ${labelMedium};
  padding-left: 12px;
  color: var(--theme-on-surface-variant);
`

export const NavList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

export const NavItem = styled.button<{ $active: boolean; $hasError?: boolean }>`
  ${buttonReset};
  ${labelLarge};
  height: 40px;
  padding: 0 12px;

  display: flex;
  align-items: center;
  gap: 10px;

  background-color: ${props => (props.$active ? 'var(--theme-container-high)' : 'transparent')};
  border-radius: var(--radius-md);
  color: ${props => {
    if (props.$hasError) return 'var(--theme-error)'
    else if (props.$active) return 'var(--theme-on-surface)'
    else return 'var(--theme-on-surface-variant)'
  }};
  cursor: pointer;
  font-weight: 600;
  text-align: left;

  &:hover {
    background-color: var(--theme-container-high);
    color: ${props => (props.$hasError ? 'var(--theme-error)' : 'var(--theme-on-surface)')};
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

export const Main = styled.div`
  flex: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 48px;
`

export const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

export const SectionTitle = styled.h2`
  ${titleLarge};
  margin: 0;
`

export const SectionDescription = styled.span`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

export const SectionNote = styled.div`
  ${bodyLarge};
  padding: 20px 24px;

  background-color: var(--theme-container-low);
  border: 1px dashed var(--theme-outline-variant);
  border-radius: var(--radius-lg);
  color: var(--theme-on-surface-variant);
`

export const CollapseButton = styled.button`
  ${buttonReset};
  width: 100%;
  padding: 18px 20px 18px 24px;

  display: flex;
  align-items: center;
  gap: 16px;

  background-color: var(--theme-container-low);
  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-lg);
  color: var(--theme-on-surface);
  cursor: pointer;
  text-align: left;

  &:hover {
    background-color: var(--theme-container);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

export const CollapseText = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

export const CollapseChevron = styled(MaterialIcon)<{ $open: boolean }>`
  color: var(--theme-on-surface-variant);
  transform: rotate(${props => (props.$open ? '180deg' : '0deg')});
  transition: transform 150ms ease;
`

const CardRoot = styled.div`
  padding: 24px 28px 28px;

  display: flex;
  flex-direction: column;
  gap: 16px;

  background-color: var(--theme-container-low);
  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-lg);
`

const CardTitle = styled.h3`
  ${titleMedium};
  margin: 0;
`

/** One group of settings, on a card with an optional title. */
export function SettingsCard({
  children,
  title,
  testName,
}: {
  children: React.ReactNode
  title?: string
  testName?: string
}) {
  return (
    <CardRoot data-testid={testName}>
      {title ? <CardTitle>{title}</CardTitle> : null}
      <React.Suspense fallback={<LoadingDotsArea />}>{children}</React.Suspense>
    </CardRoot>
  )
}
