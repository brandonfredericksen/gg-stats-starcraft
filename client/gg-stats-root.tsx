import { Provider as JotaiProvider } from 'jotai'
import { LazyMotion, MotionConfig, Transition } from 'motion/react'
import * as React from 'react'
import { Suspense, useEffect, useLayoutEffect } from 'react'
import { Provider as ReduxProvider } from 'react-redux'
import { Store } from 'redux'
import styled, { StyleSheetManager } from 'styled-components'
import { Redirect, Route, Router, Switch } from 'wouter'
import { ConnectedDialogOverlay } from './dialogs/connected-dialog-overlay'
import './dom/window-focus'
import { FileDropZoneProvider } from './file-browser/file-drop-zone'
import { jotaiStore } from './jotai-store'
import { KeyListenerBoundary } from './keyboard/key-listener'
import { NavigationTrapProvider } from './navigation/navigation-trap'
import { LoadingDotsArea } from './progress/dots'
import { useAppSelector } from './redux-hooks'
import { RootErrorBoundary } from './root-error-boundary'
import { RootState } from './root-reducer'
import { SnackbarOverlay } from './snackbars/snackbar-overlay'
import GlobalStyle from './styles/global'
import ResetStyle from './styles/reset'
import { applyThemeMode } from './styles/theme-mode'
import { LastGamePage, MyStatsPage } from './system-bar/own-games-pages'
import { SystemBar } from './system-bar/system-bar'
import { WindowControls } from './system-bar/window-controls'

const JotaiDevTools = import.meta.env.PROD
  ? undefined
  : React.lazy(() => import('./debug/jotai-devtools').then(m => ({ default: m.JotaiDevTools })))

const ReduxDevToolsContainer = import.meta.env.DEV
  ? React.lazy(() => import('./debug/redux-devtools'))
  : undefined

const DevComponent = import.meta.env.PROD ? () => null : React.lazy(() => import('./dev'))
const DemoPlayerPill = import.meta.env.PROD
  ? () => null
  : React.lazy(async () => ({
      default: (await import('./my-stats/devonly/demo-player-pill')).DemoPlayerPill,
    }))

const BuildsPage = React.lazy(async () => ({
  default: (await import('./builds/builds-page')).BuildsPage,
}))
const CoachPage = React.lazy(async () => ({
  default: (await import('./coach/coach-page')).CoachPage,
}))
const GameStatsPage = React.lazy(async () => ({
  default: (await import('./games/game-stats-page')).GameStatsPage,
}))
const ReplaysRoot = React.lazy(async () => ({
  default: (await import('./replays/replays-root')).ReplaysRoot,
}))
const SettingsScreen = React.lazy(async () => ({
  default: (await import('./settings/settings')).SettingsScreen,
}))

const loadMotionFeatures = () => import('./motion-features').then(m => m.domMax)

const DEFAULT_MOTION_CONFIG: Transition = {
  default: { type: 'spring', duration: 0.4, bounce: 0.5 },
  opacity: { type: 'spring', duration: 0.3, bounce: 0 },
}

export interface GgStatsRootProps {
  reduxStore: Store<RootState>
}

export function GgStatsRoot({ reduxStore }: GgStatsRootProps) {
  return (
    <RootErrorBoundary isVeryTopLevel={true}>
      <JotaiProvider store={jotaiStore}>
        <ReduxProvider store={reduxStore}>
          <Suspense fallback={<LoadingDotsArea />}>
            <InnerApp />
            {ReduxDevToolsContainer ? <ReduxDevToolsContainer /> : null}
            {JotaiDevTools ? <JotaiDevTools /> : null}
          </Suspense>
        </ReduxProvider>
      </JotaiProvider>
    </RootErrorBoundary>
  )
}

function InnerApp() {
  useLayoutEffect(() => {
    // Calculate the scrollbar width and set it as a CSS variable so other styles can use it.
    const outer = document.createElement('div')
    outer.style.visibility = 'hidden'
    outer.style.position = 'fixed'
    outer.style.width = '100px'
    outer.style.overflow = 'scroll'
    document.body.appendChild(outer)

    const inner = document.createElement('div')
    inner.style.width = '100%'
    outer.appendChild(inner)
    const scrollbarWidth = outer.offsetWidth - inner.offsetWidth
    document.body.removeChild(outer)

    document.body.style.setProperty('--scrollbar-width', `${scrollbarWidth}px`)
  }, [])

  return (
    <Router>
      <StyleSheetManager enableVendorPrefixes={false}>
        <>
          <ResetStyle />
          <GlobalStyle />
          <KeyListenerBoundary>
            <LazyMotion strict={true} features={loadMotionFeatures}>
              <MotionConfig
                reducedMotion='user'
                nonce={(window as any).GGSTATS_CSP_NONCE}
                transition={DEFAULT_MOTION_CONFIG}>
                <RootErrorBoundary>
                  <NavigationTrapProvider>
                    <FileDropZoneProvider>
                      <SnackbarOverlay>
                        <React.Suspense fallback={<LoadingDotsArea />}>
                          <AppContent />
                        </React.Suspense>
                      </SnackbarOverlay>
                    </FileDropZoneProvider>
                  </NavigationTrapProvider>
                </RootErrorBoundary>
              </MotionConfig>
            </LazyMotion>
          </KeyListenerBoundary>
        </>
      </StyleSheetManager>
    </Router>
  )
}

function AppContent() {
  const themeMode = useAppSelector(s => s.settings.local.themeMode) ?? 'system'
  useEffect(() => {
    applyThemeMode(themeMode)
  }, [themeMode])

  return (
    <>
      <WindowControls />
      <SystemBar />
      <React.Suspense fallback={<LoadingDotsArea />}>
        <Switch>
          {import.meta.env.DEV ? <Route path='/dev/*?' component={DevComponent} /> : <></>}
          <Route>
            <Layout />
          </Route>
        </Switch>
      </React.Suspense>
      <ConnectedDialogOverlay />
      {import.meta.env.DEV ? (
        <React.Suspense fallback={null}>
          <DemoPlayerPill />
        </React.Suspense>
      ) : null}
    </>
  )
}

/** The window's content sits on an inset, rounded panel, with the window background as its frame. */
const LayoutRoot = styled.div`
  width: 100%;
  height: calc(100% - var(--gg-system-bar-height, 0px));
  padding: 0 16px 16px;
`

const ContentPanel = styled.div`
  width: 100%;
  height: 100%;
  overflow: auto;

  background-color: var(--theme-container-lowest);
  border: 1px solid var(--theme-outline-variant);
  border-radius: var(--radius-lg);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.03);

  /* Keep the scrollbar clear of the rounded corners, so its ends aren't cut off by the curve */
  &::-webkit-scrollbar-track:vertical {
    margin-block: var(--radius-lg);
  }
`

function Layout() {
  return (
    <LayoutRoot>
      <ContentPanel>
        <React.Suspense fallback={<LoadingDotsArea />}>
          <Switch>
            <Route path='/replays/stats/:gameId' component={GameStatsPage} />
            <Route path='/replays/*?' component={ReplaysRoot} />
            <Route path='/settings' component={SettingsScreen} />
            <Route path='/last-game' component={LastGamePage} />
            <Route path='/my-stats' component={MyStatsPage} />
            <Route path='/coach' component={CoachPage} />
            <Route path='/builds' component={BuildsPage} />
            <Route>
              <Redirect to='/replays' replace={true} />
            </Route>
          </Switch>
        </React.Suspense>
      </ContentPanel>
    </LayoutRoot>
  )
}
