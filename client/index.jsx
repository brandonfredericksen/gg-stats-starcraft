import { enableArrayMethods, enableMapSet } from 'immer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TypedIpcRenderer } from '../common/ipc'
import createStore from './create-store'
import { registerDispatch } from './dispatch-registry'
import './dom/window-focus'
import { GgStatsRoot } from './gg-stats-root'
import { initI18next } from './i18n/i18next'
import { registerIpcHandlers } from './ipc-handlers'
import log from './logging/logger'
import { installHistoryEntryKeys } from './navigation/history-entry-key'

const isDev = import.meta.env.DEV

// eslint-disable-next-line eslint-core/camelcase
window.__webpack_nonce__ = window.GGSTATS_CSP_NONCE

enableArrayMethods()
enableMapSet()
installHistoryEntryKeys()

window.addEventListener('error', event => {
  const messageText = event.error?.message ?? event.message
  if (messageText === 'ResizeObserver loop limit exceeded') {
    // NOTE(tec27): This error is not really an error and is something that unavoidably happens
    // with ResizeObservers in Chromium sometimes, *shrug*
    return
  }
  log.error(`JavaScript error in Renderer: ${messageText}\nStack: ${event.error?.stack}`)
})
window.addEventListener('unhandledrejection', event => {
  log.warning(
    `Unhandled rejection in Renderer: ${event.reason?.message}\n${
      event.reason?.stack ?? event.reason
    }`,
  )
})

if (isDev) {
  // The panel library behind jotai-devtools injects a `<style>` for its drag cursor without a
  // nonce, which our style-src blocks. It appends the element empty and fills it afterwards, so the
  // violation names an empty-content hash and points at whoever appended it rather than at the
  // library.
  //
  // Every un-nonced style gets one, rather than identifying the source from the call stack: a dev
  // server that pre-bundles dependencies puts the package inside a bundled chunk, so the stack
  // names the chunk and matching on a package name silently stops working.
  const headAppendChild = document.head.appendChild.bind(document.head)
  document.head.appendChild = elem => {
    if (elem.tagName === 'STYLE' && !elem.getAttribute('nonce')) {
      elem.setAttribute('nonce', window.GGSTATS_CSP_NONCE)
    }
    return headAppendChild(elem)
  }
  // Remove annoying log
  const consoleWarn = console.warn.bind(console)
  console.warn = (...args) => {
    if (args.length > 0) {
      const firstArg = args[0]
      if (
        typeof firstArg === 'string' &&
        firstArg.startsWith('[jotai-devtools]: automatic tree-shaking')
      ) {
        return
      }
    }

    consoleWarn(...args)
  }
}

const rootElemPromise = new Promise((resolve, reject) => {
  const elem = document.getElementById('app')
  if (elem) {
    resolve(elem)
    return
  }

  document.addEventListener('DOMContentLoaded', e => {
    const elem = document.getElementById('app')
    if (elem) {
      resolve(elem)
    } else {
      reject(new Error('app element could not be found'))
    }
  })
})

rootElemPromise
  .then(async elem => {
    // Loaded here rather than at module scope so the import can be dynamic: the bundler drops it
    // from production builds, where this branch is statically false.
    let ReduxDevTools
    if (import.meta.env.DEV) {
      ReduxDevTools = (await import('./debug/redux-devtools')).DevTools
    }

    const reduxStore = createStore(ReduxDevTools)
    if (import.meta.env.DEV) {
      // Expose these for dev verification tooling (CDP-driven assertions on app state, and
      // driving the debug-only commands of a running game process); compiled out of production
      // bundles.
      window.__ggReduxStore = reduxStore
      window.__ggDebugGame = {
        crash: (gameId, kind) =>
          new TypedIpcRenderer().invoke('activeGameDebugCrash', gameId, kind),
        forceQuit: gameId => new TypedIpcRenderer().invoke('activeGameForceQuit', gameId),
        screenshot: gameId => new TypedIpcRenderer().invoke('activeGameDebugScreenshot', gameId),
      }
    }
    registerDispatch(reduxStore.dispatch)
    registerIpcHandlers()

    try {
      await initI18next()
    } catch (err) {
      log.error(`Error initializing i18next: ${err?.stack ?? err}`)
    }

    return { elem, reduxStore }
  })
  .then(({ elem, reduxStore }) => {
    const root = createRoot(elem)
    root.render(
      <StrictMode>
        <GgStatsRoot reduxStore={reduxStore} />
      </StrictMode>,
    )

    // The main process holds back startup-sensitive events (e.g. replay files passed as launch
    // args) until this, since anything it sends before our IPC listeners exist is dropped.
    new TypedIpcRenderer().send('rendererReady')
  })
