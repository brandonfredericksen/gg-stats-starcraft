import * as React from 'react'
import { useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import logger from './logging/logger'
import { FilledButton, TextButton } from './material/button'
import { zIndexSystemBar } from './material/zindex'
import { DismissSplash } from './splash'
import GlobalStyle from './styles/global'
import ResetStyle from './styles/reset'
import { bodyLarge, bodySmall, TitleLarge } from './styles/typography'
import { WindowControls } from './system-bar/window-controls'

export interface RootErrorBoundaryProps {
  /** A class name that will be applied to the root container that displays errors. */
  className?: string
  children: React.ReactNode
  isVeryTopLevel?: boolean
}

interface RootErrorBoundaryState {
  error?: Error
}

// Dumb replacement for the system bar that doesn't need Redux to function
const SystemBarReplacementRoot = styled.header`
  flex-grow: 0;
  flex-shrink: 0;

  width: 100%;
  height: 32px;
  margin: 0;
  padding: 0;
  position: relative;

  display: flex;
  flex-direction: row;

  background-color: var(--theme-surface);
  overflow: hidden;
  z-index: ${zIndexSystemBar};

  -webkit-app-region: drag;
`

function SystemBarReplacement() {
  useLayoutEffect(() => {
    document.body.style.setProperty('--gg-system-bar-height', '32px')
    return () => {
      document.body.style.removeProperty('--gg-system-bar-height')
    }
  }, [])
  return <SystemBarReplacementRoot />
}

const Container = styled.div`
  width: 100%;
  height: calc(100% - var(--gg-system-bar-height, 0px));

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`

/** What broke, in a box of its own that scrolls, so a long stack never runs off the window. */
const ErrorInfo = styled.pre`
  ${bodySmall};
  width: min(960px, calc(100% - 32px));
  max-height: 40vh;
  margin: 16px;
  padding: 12px 16px;
  overflow: auto;

  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-md);
  background-color: var(--theme-container-low);
  color: var(--theme-on-surface-variant);
  font-family: ui-monospace, Consolas, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;

  &,
  & * {
    user-select: text;
  }
`

const Instructions = styled.div`
  ${bodyLarge};
  max-width: 960px;
  margin: 16px;
  text-align: center;
`

const Actions = styled.div`
  display: flex;
  gap: 8px;
`

function copyDetails(error: Error) {
  navigator.clipboard.writeText(String(error.stack ?? error)).catch(() => {})
}

/**
 * A React error boundary that is intended to be attached at the application root. This should be
 * considered the error boundary of last resort, and ideally errors would be caught deeper in the
 * tree (by adding more error boundaries).
 */
export class RootErrorBoundary extends React.Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  override state: RootErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error) {
    return {
      error,
    }
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error(`RootErrorBoundary caught an error: ${String(error.stack ?? error)}`)
    logger.error(`React stack:\n${errorInfo.componentStack}`)
  }

  override render() {
    if (this.state.error) {
      const { error } = this.state

      return (
        <>
          {this.props.isVeryTopLevel ? (
            <>
              <ResetStyle />
              <GlobalStyle />
              {IS_ELECTRON ? <WindowControls /> : undefined}
              {IS_ELECTRON ? <SystemBarReplacement /> : undefined}
            </>
          ) : undefined}
          <Container>
            <ContentsErrorBoundary rootError={error} />
          </Container>
          <DismissSplash />
        </>
      )
    }

    return this.props.children
  }
}

export interface ContentsErrorBoundaryProps {
  rootError: Error
}

interface ContentsErrorBoundaryState {
  hasTranslationError?: boolean
}

/**
 * A React error boundary that is specifically meant to catch the errors in calling
 * translation-related functions when displaying the error contents. If there are any errors in
 * displaying the translated version of the error contents, we fallback to displaying the static,
 * English version of the error contents.
 */
class ContentsErrorBoundary extends React.Component<
  ContentsErrorBoundaryProps,
  ContentsErrorBoundaryState
> {
  override state: ContentsErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error) {
    return {
      hasTranslationError: error,
    }
  }

  override render() {
    const { rootError } = this.props
    const { hasTranslationError } = this.state

    return hasTranslationError ? (
      <StaticErrorContents rootError={rootError} onReloadAppClick={this.reloadApp} />
    ) : (
      <TranslatedErrorContents rootError={rootError} onReloadAppClick={this.reloadApp} />
    )
  }

  reloadApp = () => {
    if (location.pathname === '/') {
      location.reload()
    } else {
      // Put them back at the root of the app in case the place they were was causing errors
      location.pathname = '/'
    }
  }
}

interface ErrorContentsProps {
  rootError: Error
  onReloadAppClick?: () => void
}

function TranslatedErrorContents({ rootError, onReloadAppClick }: ErrorContentsProps) {
  const { t } = useTranslation()

  return (
    <>
      <TitleLarge>{t('rootErrorBoundary.title', 'Something went wrong')}</TitleLarge>
      <Instructions>
        {t(
          'rootErrorBoundary.reloadHint',
          'Reloading usually fixes it. If it keeps happening, copy the details into a bug report.',
        )}
      </Instructions>
      <ErrorInfo>{String(rootError.stack ?? rootError)}</ErrorInfo>
      <Actions>
        <TextButton
          label={t('rootErrorBoundary.copyDetails', 'Copy details')}
          onClick={() => copyDetails(rootError)}
        />
        <FilledButton
          label={t('rootErrorBoundary.reloadApp', 'Reload app')}
          onClick={onReloadAppClick}
        />
      </Actions>
    </>
  )
}

function StaticErrorContents({ rootError, onReloadAppClick }: ErrorContentsProps) {
  return (
    <>
      <TitleLarge>Something went wrong</TitleLarge>
      <Instructions>
        Reloading usually fixes it. If it keeps happening, copy the details into a bug report.
      </Instructions>
      <ErrorInfo>{String(rootError.stack ?? rootError)}</ErrorInfo>
      <Actions>
        <TextButton label='Copy details' onClick={() => copyDetails(rootError)} />
        <FilledButton label='Reload app' onClick={onReloadAppClick} />
      </Actions>
    </>
  )
}
