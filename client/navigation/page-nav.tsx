import * as React from 'react'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from '../material/button-reset'
import { Tooltip } from '../material/tooltip'
import { labelLarge, singleLine } from '../styles/typography'
import { push } from './routing'
import { SectionHistory } from './section-history'

/** One step of the path to the current page. The last is the current page, so it has no link. */
export interface Crumb {
  label: string
  href?: string
}

const Root = styled.nav`
  min-height: 36px;

  display: flex;
  align-items: center;
  gap: 4px;
`

const ArrowButton = styled.button`
  ${buttonReset};
  width: 32px;
  height: 32px;
  flex-shrink: 0;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: var(--radius-full);
  color: var(--theme-on-surface);
  cursor: pointer;

  &:hover:not(:disabled) {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }

  &:disabled {
    color: var(--theme-on-surface-variant);
    opacity: 0.4;
    cursor: default;
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const HistoryRoot = styled.div`
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 2px;

  -webkit-app-region: no-drag;
`

/** Starts a little left, so the first link's text lines up with the page's edge. */
const Crumbs = styled.ol`
  min-width: 0;
  margin: 0 0 0 -6px;
  padding: 0;

  display: flex;
  align-items: center;
  gap: 4px;

  list-style: none;
`

const CrumbItem = styled.li`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
`

const CrumbLink = styled.button`
  ${buttonReset};
  ${labelLarge};
  height: 28px;
  padding: 0 6px;
  flex-shrink: 0;

  border-radius: var(--radius-sm);
  color: var(--theme-on-surface-variant);
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
    color: var(--theme-on-surface);
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const CurrentCrumb = styled.span`
  ${labelLarge};
  ${singleLine};
  padding: 0 6px;
  color: var(--theme-on-surface);
  font-weight: 600;
`

const Separator = styled(MaterialIcon).attrs({ icon: 'chevron_right', size: 18 })`
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

const Actions = styled.div`
  margin-left: auto;
  padding-left: 12px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 8px;
`

const sectionHistory = new SectionHistory()
const historyListeners = new Set<() => void>()

function onLocationChange() {
  sectionHistory.visit(window.location.pathname + window.location.search)
  for (const listener of historyListeners) {
    listener()
  }
}

onLocationChange()
// The Navigation API reports pushes and replaces as well as moves through the browser's history.
window.navigation?.addEventListener('currententrychange', onLocationChange)

function subscribeToHistory(onChange: () => void) {
  historyListeners.add(onChange)
  return () => {
    historyListeners.delete(onChange)
  }
}

/**
 * The section the app is showing, which for a game's page is the section it was opened from, so
 * the tab that opened it stays the active one.
 */
export function useCurrentSection() {
  return useSyncExternalStore(subscribeToHistory, () => sectionHistory.section)
}

/** Whether there's a page to go back or forward to within the current section. */
function useHistoryMoves() {
  const canGoBack = useSyncExternalStore(subscribeToHistory, () => sectionHistory.canGoBack())
  const canGoForward = useSyncExternalStore(subscribeToHistory, () => sectionHistory.canGoForward())
  return { canGoBack, canGoForward }
}

function goTo(url: string | undefined) {
  if (url !== undefined) {
    push(url)
  }
}

/** The top of a sub page: the path to it as links, and the page's own actions on the right. */
export function PageNav({
  crumbs,
  actions,
}: {
  crumbs: ReadonlyArray<Crumb>
  actions?: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Root aria-label={t('navigation.breadcrumb', 'Breadcrumb')}>
      <Crumbs>
        {crumbs.map((crumb, i) => (
          <CrumbItem key={i}>
            {i > 0 ? <Separator aria-hidden={true} /> : null}
            {crumb.href ? (
              <CrumbLink type='button' onClick={() => push(crumb.href!)}>
                {crumb.label}
              </CrumbLink>
            ) : (
              <CurrentCrumb aria-current='page' title={crumb.label}>
                {crumb.label}
              </CurrentCrumb>
            )}
          </CrumbItem>
        ))}
      </Crumbs>
      {actions ? <Actions>{actions}</Actions> : null}
    </Root>
  )
}

/**
 * Back and forward within the current section, like a browser's but kept apart for each top level
 * section, so going back in the library never leaves it. They're always there, dimmed while
 * there's nowhere to go, so nothing beside them moves.
 */
export function HistoryButtons() {
  const { t } = useTranslation()
  const { canGoBack, canGoForward } = useHistoryMoves()
  const backLabel = t('navigation.back', 'Back')
  const forwardLabel = t('navigation.forward', 'Forward')
  return (
    <HistoryRoot>
      <Tooltip text={backLabel} position='bottom' disabled={!canGoBack}>
        <ArrowButton
          type='button'
          aria-label={backLabel}
          disabled={!canGoBack}
          onClick={() => goTo(sectionHistory.back())}>
          <MaterialIcon icon='arrow_back' size={20} />
        </ArrowButton>
      </Tooltip>
      <Tooltip text={forwardLabel} position='bottom' disabled={!canGoForward}>
        <ArrowButton
          type='button'
          aria-label={forwardLabel}
          disabled={!canGoForward}
          onClick={() => goTo(sectionHistory.forward())}>
          <MaterialIcon icon='arrow_forward' size={20} />
        </ArrowButton>
      </Tooltip>
    </HistoryRoot>
  )
}
