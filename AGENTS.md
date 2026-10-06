# AGENTS.md

Guidance for AI agents working in this repository.

## Project Overview

GG Stats ("GG Stats for StarCraft") shows post game stats for StarCraft: Remastered games by
analyzing their replays: a replay library, replay analysis and the stats pages. There is no server
and no account; the app's only network request is the update check against GitHub releases
(`app/updater.ts`), which the user can turn off. Keep it that way.

| Directory | Description                                  | Stack                                       |
| --------- | -------------------------------------------- | ------------------------------------------- |
| `client/` | React renderer (replay library, stats)       | TypeScript, Redux, Jotai, styled-components |
| `app/`    | Electron main process                        | TypeScript, native OS integration           |
| `common/` | Shared TypeScript code                       | Types, utilities, IPC definitions           |
| `game/`   | Rust DLL injected into the StarCraft it runs | Windows API, egui                           |

**Architecture Rule**: `client/` and `app/` must not depend on each other. Both can depend on
`common/`.

Analysis runs in a second StarCraft the app starts itself, invisibly (`-background`), with the DLL
reading the game's numbers while the replay fast forwards. The app only ever launches replays
(`ActiveGameManager.setGameConfig` rejects anything else) and never touches a StarCraft it didn't
start.

`game/` started as [ShieldBattery](https://github.com/ShieldBattery/ShieldBattery)'s game DLL
without its online play, so fixes from the `upstream` remote are ported by hand rather than merged.
It finds StarCraft's internals with neivv's samase_scarf, and support for a new StarCraft patch
comes from updating that pin. `game/scr-analysis` must only depend on `neivv/samase_scarf`, never
tec27's fork, whose additions have no license; `pnpm run gen-notices` fails if any crate resolves
from it.

## Quick Reference

| Task               | Pattern                                     | Location                                |
| ------------------ | ------------------------------------------- | --------------------------------------- |
| Add IPC call       | Add to `IpcInvokeables` etc., handle in app | `common/ipc.ts`, `app/app.ts`           |
| Add Redux state    | `immerKeyedReducer` + actions               | `client/<feature>/<feature>-reducer.ts` |
| Add local UI state | Jotai atom                                  | `client/<feature>/<feature>-atoms.ts`   |
| Add shared type    | Interface in `common/`                      |                                         |
| Add a page         | Route in the shell                          | `client/gg-stats-root.tsx`              |
| Test component     | Create devonly page                         | `client/<feature>/devonly/`             |

### Key File Locations

```
client/index.jsx                     - Renderer entry: store, IPC handlers, i18n, then the shell
client/gg-stats-root.tsx             - App shell: layout, routes, settings overlay, dialogs
client/ipc-handlers.ts               - Everything the main process sends the renderer
client/redux-hooks.ts                - useAppDispatch, useAppSelector (use instead of base hooks)
client/jotai-store.ts                - Global Jotai store instance
client/dispatch-registry.ts          - Global dispatch for non-React code
client/styles/colors.ts              - Theme CSS custom properties
client/material/                     - UI component library
common/ipc.ts                        - Electron IPC type definitions
common/urls.ts                       - urlPath tagged template (auto-encodes URLs)
common/games/replay-analysis-config.ts - Builds the launch config for watching/analyzing a replay
app/game/active-game-manager.ts      - Launches StarCraft for a replay and tracks it
app/game/game-stats-store.ts         - Saved stats on disk
app/replay-library/                  - Replay index (SQLite in a worker thread) and folder watcher
app/assets/locales/                  - Translations, served to the renderer by the app
```

## Common Development Commands

```bash
pnpm run local-dev             # Renderer dev server + Electron app together (run-pty)
pnpm run dev                   # Renderer dev server only (port 5566)
pnpm run app                   # Build the main process and start Electron against the dev server
pnpm run test                  # Unit tests (Vitest)
pnpm run lint                  # oxlint (type-aware) + oxfmt check
pnpm run lint:fix              # oxlint + oxfmt autofix (also sorts imports, drops unused ones)
pnpm run typecheck             # TypeScript type checking
pnpm run gen-translations      # Regenerate app/assets/locales/en from the strings in code

# Rust game DLL
game\build.bat                 # Debug 64-bit
game\build.bat x86             # Debug 32-bit
```

Set `GGSTATS_SESSION=<name>` when starting the app to give it its own settings, logs, replay index
and saved stats files, so a dev instance never shares them with another.

## Key Development Guidelines

### General

- Preserve `TODO(context)` and `NOTE(context)` comments unless completing the TODO
- **Comments must stand alone.** Don't write _deictic_ comments — ones whose meaning points at
  context outside the repo's current state: review findings ("Finding A3"), design docs, handoffs,
  tickets, chat threads, project phases, or before/after narrative ("previously...", "the new
  path", "today's behavior"). Those artifacts drift or get deleted, and the next reader wasn't
  there. The test: would this comment still be true and fully comprehensible after every document,
  conversation, and branch around the change is gone? If not, rewrite it to state the invariant,
  hazard, or constraint in the code's own terms. Provenance and review trail belong in commit
  messages, where such references are welcome. (`TODO(context)`/`NOTE(context)` tags are the one
  sanctioned forward pointer.)
- Delete unused code during refactoring
- Commit messages: one short action-oriented imperative subject sentence ending with a period
  (e.g. "Analyze replays at low priority."), then a body with only as much detail as the change
  warrants — often none, never an essay
- Don't edit translation files (`global.json`) manually - run `pnpm run gen-translations`

### Project-Specific Patterns

- Use the `urlPath` tagged template for URL construction (auto-encodes variables)
- Use `ReadonlyDeep` from type-fest for immutable objects
- IDs and canonical strings use Tagged types: `MatchupString`, `EncodedMatchupString`
- Events use discriminated unions with `action` field as discriminator

## Client Architecture

### State Management

**Redux** for app-wide state (settings, dialogs, the active game):

- Use `immerKeyedReducer` - maps action types to handler functions
- Action naming: `@feature/actionName` (e.g., `@settings/updateLocalSettings`)
- Access dispatch outside React via `dispatch-registry.ts`

**Jotai** for feature-local/transient state (running analyses, saved stats, UI state):

- Access outside React via `jotaiStore.get(atom)` / `jotaiStore.set(atom, value)`

### React & Styling

- React 19 with `react-compiler` - `useMemo`/`useCallback`/`useStableCallback` generally unnecessary
  - The compiler automatically memoizes; don't wrap event handlers or inline functions in these hooks
  - One exception: a callback whose _identity_ would feed a `useEffect` deps array and must not
    retrigger the effect. Prefer React's builtin `useEffectEvent` for these (call it from the
    effect, omit it from deps). `useStableCallback` remains only for the rare case its contract
    can't cover: a stable identity called outside effects (e.g. handed to long-lived non-React
    code)
- Use `$`-prefixed props for styled-components: `$disabled`, `$focused`
- Theme in `client/styles/colors.ts`, typography in `client/styles/typography.ts`
- **Always style text with the typography tokens from `client/styles/typography.ts`** — compose the
  `css` token (e.g. `${bodyMedium}`) or render the styled component (e.g. `<BodyMedium>`). Don't
  hand-roll `font-*`/`line-height`/`letter-spacing`, and don't invent font CSS vars (none exist —
  the global family comes from the `inter` token in `client/styles/global.ts`). For a non-standard
  size/weight, build on the nearest token and override only the differing property
  (`${titleMedium}; font-size: 20px;`); even genuinely exceptional cases (oversized display
  numerals) should compose a font-family token (`inter`/`sofiaSans`/`sofiaSansCondensed`).
- Use `motion` library for animations, `react-i18next` for translations
- Development test pages in `devonly/` folders (accessible at `/dev`)

## Game Runtime Architecture

While a replay plays, two processes work together:

1. **Electron App (`app/`)** - Launches StarCraft, injects the game DLL, manages its lifecycle
2. **Game DLL (`game/`)** - Injected into the StarCraft the app started; loads the replay and, for
   an analysis, collects the stats and reports them back

They talk over a local websocket (`app/game/game-server.ts`).

## Game DLL (Rust)

Two code paths:

- **Async** (Tokio): `async_thread` entry, communication with the app
- **Sync** (BW hooks): `patch_game` entry, executes in StarCraft's code

Build: 64-bit default, 32-bit via `game\build.bat x86`

**Game code must work on both architectures (i686 and x86_64).** Both are shipped/built targets, so
a change is not done until it builds and behaves on both. Watch for arch-specific assumptions:
struct field offsets and sizes (pointers are 4 vs 8 bytes — gate them with `#[cfg(target_arch)]`
and a `size_of` assertion per arch, as `SfxDataEntry` in `bw_scr/scr.rs` does), any hardcoded
absolute address or memory-layout offset, and pointer-width casts. Prefer arch-agnostic sources
(samase_scarf resolves globals/functions/some offsets per-arch) over hardcoding; when an offset must
be hardcoded, it needs a verified value for _each_ arch, not one guessed from the other. Don't add a
`cfg!(target_arch = "x86_64")` bail-out to dodge the work — verify the 64-bit values instead.

**Always rebuild via `game\build.bat`, never a bare `cargo build`.** The app injects
`game/dist/ggstats_64.dll` (or `ggstats.dll` with the `launch32Bit` setting; see
`app/game/active-game-manager.ts`), and only `build.bat` copies
the freshly compiled DLL from `target/` into `dist/`. A bare `cargo build` updates `target/` but
leaves `dist/` stale, so a launched game silently runs the _old_ DLL — a change appears to have no
effect (or to "fail" in a way that doesn't match the source). If a game-launch test contradicts
your code, suspect a stale `dist/` DLL first.

Lint: `cargo clippy --all-targets --workspace -- -D warnings` (code should be warning-free) AND
`cargo fmt --all -- --check` — CI runs fmt as a separate job, so clippy passing doesn't cover it.
Don't silence clippy with `#[allow]`; restructure so the lint doesn't fire (an allow needs a
genuinely exceptional justification, commented in the code's own terms).

**`game/scr-analysis` is a thin wrapper, not the analysis itself.** It exists to keep compile
times fast (samase_scarf's macro-heavy code compiles once, optimized, in its own crate) and only
wraps the `Analysis` methods the game crate actually uses. Before deciding a binary analysis is
"missing," check the pinned samase_scarf rev's `Analysis` API — if it's there, the fix is a
one-line wrapper method in `scr-analysis/src/lib.rs`, not new analysis work.

## Electron App

- Typed IPC in `common/ipc.ts`: `invoke` (request-response), `send/on` (fire-and-forget)
- Types: `IpcInvokeables`, `IpcRendererSendables`, `IpcMainSendables`
- Key files: `app/app.ts`, `app/settings.ts`, `app/game/active-game-manager.ts`

## Testing

- **Unit (Vitest):** Colocated `.test.ts` files, `asMockedFunction()` from `common/testing/mocks.ts`
- **Verifying in the app:** start it with `--remote-debugging-port` and drive it over the Chrome
  DevTools Protocol (`Runtime.evaluate`, `Page.captureScreenshot`)

## Important Notes

- Check README files before editing - some directories contain generated code
- Plans, notes, design work and agent skills live in the gitignored `.local/` folder, never in a
  commit. The repo holds only what a public reader needs.
