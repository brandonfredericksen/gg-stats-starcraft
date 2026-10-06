import { resolve } from 'node:path'
import { defineConfig, type UserConfig } from 'vite'
import {
  ASSET_NAMING,
  NONCE_TOKEN,
  ROOT,
  sharedDefines,
  sharedOxc,
  sharedPlugins,
  sharedResolve,
  shellPlugin,
} from './vite.shared'

/**
 * The shell the Electron client loads, relative to {@link ROOT}. Doubles as the build entry and,
 * in development, as the path the main process fetches from the dev server to get a shell with
 * Vite's client and React Refresh preamble already injected. The main process has its own copy of
 * that URL, since it cannot import from a Vite config.
 */
const SHELL_ENTRY = 'app/index.html'
/**
 * Everything the renderer needs, in the directory the packager copies wholesale. The built shell
 * lands here too, as `index.html`; the main process reads it and fills its slots per request.
 *
 * The main process, its preload and the replay DB worker are built into here too (see
 * `rolldown.app.config.ts`), which is why this build must not empty the directory.
 */
const OUT_DIR = 'app/dist'
/**
 * URL prefix the built shell's asset URLs carry. The `ggstats://` protocol handler already
 * serves this path out of {@link OUT_DIR}, and since there is only ever one origin here, the same
 * absolute base is correct for the shell and for references the bundle resolves itself.
 */
const ASSET_BASE = '/dist/'

/** Must agree with the origin `app/app.ts` fetches the dev shell from and admits in its CSP. */
const DEV_SERVER_PORT = 5566
const DEV_SERVER_ORIGIN = `http://localhost:${DEV_SERVER_PORT}`

export default defineConfig(({ command, mode }): UserConfig => {
  const isProd = mode === 'production'

  return {
    root: ROOT,
    // Only meaningful for the build. Vite reduces a base with an origin in it to its pathname when
    // serving, so there is no way to point the dev server's URLs at itself from here; the main
    // process rewrites them instead (see `app/client-shell.ts`).
    base: command === 'build' ? ASSET_BASE : '/',

    // Unlike the web client, nothing is put in front of this dev server -- it serves the shell
    // itself, and the main process asks it for one. See DEV_SHELL_URL.
    html: command === 'serve' ? { cspNonce: NONCE_TOKEN } : undefined,

    resolve: sharedResolve(isProd),
    define: sharedDefines({ isElectron: true }),
    oxc: sharedOxc(isProd),

    plugins: [
      ...sharedPlugins(),
      shellPlugin({ emittedAt: SHELL_ENTRY, destination: resolve(ROOT, OUT_DIR, 'index.html') }),
    ],

    server: {
      port: DEV_SERVER_PORT,
      // The app has this port baked into its CSP and its dev shell URL, so quietly moving to
      // another one would just produce a blank window.
      strictPort: true,
      // Makes asset URLs generated from module code absolute, so they resolve against this server
      // rather than against `ggstats://app`. It does *not* cover the tags the HTML transform
      // injects into the shell, which stay root-relative -- `app/client-shell.ts` handles those.
      origin: DEV_SERVER_ORIGIN,
      // The renderer's document is on a different origin than this server, so its module requests
      // are cross-origin. Vite's default only admits localhost origins, which the app's scheme is
      // not; without this every module request fails CORS and the window stays blank.
      cors: { origin: ['ggstats://app', /^https?:\/\/localhost(?::\d+)?$/] },
      // The page can't derive this: it would infer the HMR endpoint from its own location, which
      // is a `ggstats://` URL with no port.
      hmr: { protocol: 'ws', host: 'localhost', port: DEV_SERVER_PORT },
      // Vite's root is the repo root and its default ignores cover only .git, node_modules,
      // test-results and outDir. Without these the watcher also walks the game DLL's crate, whose
      // build directory holds tens of thousands of files rewritten on every build, and the
      // packager's output in `dist/`. Both hold DLLs that are locked while they're written, and a
      // busy file crashes the watcher.
      watch: {
        ignored: ['**/game/**', '**/dist/**'],
      },
      // Vite serves anything under the workspace root on this port, so the denylist matters.
      //
      // This *replaces* Vite's default rather than extending it, so the default has to be
      // restated here or `.env`, keys and `.git` stop being protected. The only deliberate change
      // is `.env*` in place of `.env` + `.env.*`, which additionally covers the `.env-build` at
      // the repo root. Re-check this list when upgrading Vite.
      fs: {
        deny: ['.env*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**'],
      },
    },

    build: {
      outDir: OUT_DIR,
      rollupOptions: { input: resolve(ROOT, SHELL_ENTRY), output: ASSET_NAMING },
      // Whatever Electron ships is the only runtime this bundle ever sees, and it is always newer
      // than anything worth lowering for.
      target: 'esnext',
      // The main process, preload and replay DB worker bundles live in this directory too, and
      // are built separately -- emptying it would delete them.
      emptyOutDir: false,
      // 'hidden' rather than true: the packaged app excludes *.map, so a sourceMappingURL comment
      // would point every chunk at a file that isn't there.
      sourcemap: 'hidden',
      // Read by tools/notices/gen-notices.ts, which folds it into the notices the app ships.
      license: { fileName: 'renderer-licenses.md' },
    },
  }
})
