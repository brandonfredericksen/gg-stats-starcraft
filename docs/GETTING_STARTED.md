# Getting Started

## Developer setup

GG Stats is a combination of Rust and TypeScript/JavaScript: an Electron app, and a DLL that runs
inside the StarCraft it starts. Even if you only plan on developing TypeScript changes, you'll need
the native build tooling below in order to properly test things.

## General environment setup

### JavaScript

All of the JavaScript will either run in, or be built by, [node.js](https://nodejs.org). You'll need
to install version 24 or newer (see `engines` in `package.json` for the current requirement). On
Windows, you'll be given the option to install dependencies for building native
modules (Visual Studio build tools + Python), you should take that option if you don't already have
them installed separately.

### PNPM

The various JavaScript components use [pnpm](https://pnpm.io/) to manage their dependencies.
Install the correct version via `corepack` which is provided by Node:

```sh
corepack enable
```

### Visual Studio

Visual Studio 2022 or higher is required for its MSVC toolchain, which links the Rust code and
builds native Node modules. The easiest/cheapest way to get this is through the
[Community edition](https://visualstudio.microsoft.com/downloads/).

### Rust

The code that runs within the BW process (the `game/` directory) is written in
[Rust](https://rust-lang.org). The simplest way to get things built is to
use the [rustup toolchain installer](https://rustup.rs).

The game DLL ships for both 32-bit and 64-bit Windows. The 32-bit build needs the 32-bit
standard library: run `rustup target add i686-pc-windows-msvc`.

To build the DLL, run `build.bat` in the [`game` directory](../game), which will also copy the
resulting DLL and other necessary support files to `game/dist`, where the JavaScript code expects
them to be. The build defaults to a 64-bit debug build (the version the app launches by default);
`build.bat release` builds the optimized version, and `build.bat x86` targets 32-bit.

You can update the Rust toolchain by running `rustup update`. We generally try to stay up to date
with the current stable version (and some CI runs may fail if your local version is older than this,
due to changes in `rust fmt` and various warnings/errors).

### Recommended VSCode Plugins

If you're using VSCode, the following plugins will likely be useful for development. They're also
listed in `.vscode/extensions.json`, so VSCode offers to install them when you open the project:

- [Oxc](https://marketplace.visualstudio.com/items?itemName=oxc.oxc-vscode) (oxlint and the oxfmt formatter;
  set it as the default formatter for JS/TS)
- [Styled Components](https://marketplace.visualstudio.com/items?itemName=styled-components.vscode-styled-components)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Running the app

Install the dependencies (both the root and the app's, plus the app's native modules):

```sh
pnpm run installall
```

Build the game DLL (see above), then start the renderer dev server and the Electron app together:

```sh
pnpm run local-dev
```

`local-dev` runs `pnpm run dev` (the renderer dev server, with hot reloading) and `pnpm run app`
(the Electron app) in one terminal. The app reads StarCraft: Remastered from the folder set in its
settings, and finds it on its own in most installs.

## Developer settings for SC:R

If you need to run SC:R while developing, it is possible to disable HD graphics to shorten game
launch times and to reduce system load with the "Don't load HD graphics" checkbox in the StarCraft
settings, which only shows in a development build.

Disabling HD graphics may cause crashes if the game tries to render with them, so it is recommended
to launch SC:R, switch the graphics to SD, and close the game before turning it on.

## Running tests

Unit tests are written with vitest, and sit next to the files they test with a `.test.ts`
extension. To run them:

```sh
pnpm run test
```

If you're developing a new test or modifying an existing one, you can run only the tests and re-run
on each change by doing:

```sh
pnpm run test --watch
```

We also have lint and typechecking passes that will run on CI, you can run these locally by doing:

```sh
pnpm run lint
pnpm run typecheck
```

`pnpm run lint:fix` fixes what it can: formatting (oxfmt), import order, and unused imports.
