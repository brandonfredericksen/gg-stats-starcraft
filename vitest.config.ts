import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import packageJson from './package.json' with { type: 'json' }

export default defineConfig({
  test: {
    globalSetup: './vitest-global-setup.ts',

    api: {
      port: 9527,
    },

    projects: [
      // App (Electron main process)
      //
      // No custom transform plugins: Vite 8's default oxc transform handles legacy decorators +
      // emitDecoratorMetadata from tsconfig.
      {
        test: {
          name: 'app',
          environment: 'node',
          include: ['app/**/*.test.{js,ts,tsx}', 'common/**/*.test.{js,ts,tsx}'],
          exclude: ['app/dist/**', 'app/node_modules/**'],
          setupFiles: ['core-js/proposals/reflect-metadata'],
        },
      },
      // Tools (Node)
      {
        test: {
          name: 'tools',
          environment: 'node',
          include: ['tools/**/*.test.{js,ts,tsx}', 'build-plugins/**/*.test.{js,ts,tsx}'],
        },
      },
      // Client (Browser/happy-dom)
      {
        // No custom transforms needed beyond the standard React/TS handling: client/ and common/
        // contain no legacy decorators or const enums.
        plugins: [react()],
        // Mirrors what the client builds inject, so a module reading one of these behaves the same
        // under test as it does in a build. Vitest supplies MODE/DEV/PROD itself.
        define: {
          'import.meta.env.GGSTATS_VERSION': JSON.stringify(packageJson.version),
        },
        test: {
          name: 'client',
          environment: 'happy-dom',
          include: ['client/**/*.test.{js,ts,tsx}', 'common/**/*.test.{js,ts,tsx}'],
          setupFiles: [
            'core-js/proposals/reflect-metadata',
            resolve(__dirname, 'vitest-client-setup.ts'),
          ],
          alias: {
            // The suffix is optional so this keeps matching if an import is ever written without
            // it; svgr only transforms `?react`, but either way a test wants the mock.
            '\\.svg(\\?react)?$': resolve(__dirname, 'client/__mocks__/svg-mock.tsx'),
            '\\.(html|htm|md)(\\?raw)?$': resolve(
              __dirname,
              'client/__mocks__/static-file-mock.ts',
            ),
          },
        },
      },
    ],

    coverage: {
      exclude: ['app/dist/**', 'dist/**'],
      reporter: ['text', 'html'],
    },
  },
})
