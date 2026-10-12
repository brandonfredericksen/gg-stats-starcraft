import { createContext, ReactNode, useContext, useLayoutEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { CONTENT_PANEL_INSET, SYSTEM_BAR_HEIGHT } from '../../common/window-layout'
import { isSplashShowing } from '../splash'
import { LogoLoadingIndicator } from './loading-indicator'

/**
 * How long a page can take to load before its loader shows, so loading that's done by then never
 * flashes it.
 */
const LOADER_DELAY_MS = 500

/** How long a page takes to fade in once it's loaded. */
const REVEAL_MS = 120

interface PageLoading {
  /** Holds the page back until the function this returns is called. */
  hold: () => () => void
  /** Whether anything is holding the page back. */
  loading: boolean
}

const PageLoadingContext = createContext<PageLoading | undefined>(undefined)

const Frame = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
`

const Layer = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
`

/**
 * The box a page loads in. While anything in the page is loading (see `PageLoadingIndicator`), the
 * page stays hidden, with the loader in the middle of this box if it takes a moment, and then the
 * whole page fades in at once rather than in pieces as each part loads.
 */
export function PageLoadingFrame({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ holds: 0, delayed: true })
  const [hold] = useState(() => () => {
    // While the splash is up, its loader is already showing, so the page's takes over right away.
    const delayed = !isSplashShowing()
    setState(s => ({ holds: s.holds + 1, delayed: s.holds ? s.delayed : delayed }))
    return () => setState(s => ({ ...s, holds: s.holds - 1 }))
  })
  const loading = state.holds > 0

  return (
    <PageLoadingContext value={{ hold, loading }}>
      <Frame>
        {children}
        <Layer>
          {loading ? <LogoLoadingIndicator delayMs={state.delayed ? LOADER_DELAY_MS : 0} /> : null}
        </Layer>
      </Frame>
    </PageLoadingContext>
  )
}

const Content = styled.div<{ $hidden: boolean }>`
  height: 100%;

  ${props => (props.$hidden ? 'opacity: 0; pointer-events: none;' : '')}
`

/** Where the page goes in a `PageLoadingFrame`, hidden while it loads. */
export function PageContent({ children }: { children: ReactNode }) {
  const loading = useContext(PageLoadingContext)?.loading ?? false
  const contentRef = useRef<HTMLDivElement>(null)
  const wasLoading = useRef(loading)
  useLayoutEffect(() => {
    if (wasLoading.current && !loading) {
      contentRef.current?.animate({ opacity: [0, 1] }, { duration: REVEAL_MS, easing: 'ease-out' })
    }
    wasLoading.current = loading
  }, [loading])

  return (
    <Content ref={contentRef} $hidden={loading}>
      {children}
    </Content>
  )
}

/** Where the content panel goes, for a page loading before there is one. */
const UnframedArea = styled.div`
  position: fixed;
  inset: ${SYSTEM_BAR_HEIGHT}px ${CONTENT_PANEL_INSET}px ${CONTENT_PANEL_INSET}px;
  display: grid;
  place-items: center;
  pointer-events: none;
`

/**
 * What a page renders until it has something to show. It holds the whole page back while it's
 * mounted (see `PageLoadingFrame`), so only use it while a page first loads, not for a part that
 * reloads later.
 */
export function PageLoadingIndicator() {
  const hold = useContext(PageLoadingContext)?.hold
  useLayoutEffect(() => hold?.(), [hold])

  return hold ? null : (
    // Outside of a page frame, like while the app around the pages is still loading.
    <UnframedArea>
      <LogoLoadingIndicator />
    </UnframedArea>
  )
}
