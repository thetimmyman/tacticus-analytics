import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

const alias = {
  '@': path.resolve(__dirname, '.'),
  '@/app': path.resolve(__dirname, 'app'),
  '@/lib': path.resolve(__dirname, 'app/lib'),
  '@/types': path.resolve(__dirname, 'app/types'),
  '@/tests': path.resolve(__dirname, 'tests'),
  '@tacticus/ui-kit': path.resolve(__dirname, 'packages/ui-kit/src'),
  '@tacticus/ui-kit/*': path.resolve(__dirname, 'packages/ui-kit/src/*'),
  '@tacticus/app-core': path.resolve(__dirname, 'packages/app-core/src'),
  '@tacticus/app-core/*': path.resolve(__dirname, 'packages/app-core/src/*'),
  '@tacticus/charting': path.resolve(__dirname, 'packages/charting/src'),
  '@tacticus/charting/*': path.resolve(__dirname, 'packages/charting/src/*'),
  'server-only': path.resolve(__dirname, 'tests/mocks/server-only.ts')
}

// `node` project files; happy-dom excludes NODE_GLOBS so nothing runs twice.
const NODE_GLOBS = [
  'tests/unit/api/**/*.{test,spec}.{ts,tsx}',
  'tests/integration/api/**/*.{test,spec}.{ts,tsx}',
  'tests/unit/battle/**/*.{test,spec}.{ts,tsx}',
  'tests/unit/cache/**/*.{test,spec}.{ts,tsx}',
  'tests/unit/config/**/*.{test,spec}.{ts,tsx}',
  'tests/unit/discord/**/*.{test,spec}.{ts,tsx}',
  'tests/unit/lib/middleware/**/*.{test,spec}.{ts,tsx}',
  'tests/unit/lib/llm/**/*.{test,spec}.{ts,tsx}',
  'tests/unit/lib/jobs/**/*.{test,spec}.{ts,tsx}',
  'tests/unit/lib/sync/sync-worker-service.test.ts',
  'tests/unit/navigation/**/*.{test,spec}.{ts,tsx}',
  'tests/unit/network/**/*.{test,spec}.{ts,tsx}',
  'tests/unit/scripts/**/*.{test,spec}.{ts,tsx}',
  'tests/unit/strategy/**/*.{test,spec}.{ts,tsx}',
  'tests/sync/**/*.{test,spec}.{ts,tsx}'
]

const ALL_GLOBS = [
  'tests/**/*.{test,spec}.{ts,tsx}',
  'app/**/*.{test,spec}.{ts,tsx}'
]

const ESLINT_RULE_GLOBS = ['eslint-rules/**/*.{test,spec}.mjs']

// Playwright specs would fail here without a dev server.
const SHARED_EXCLUDE = [
  'node_modules/',
  '.next/',
  'out/',
  'tests/fixtures/',
  'tests/e2e/'
]

const setupFiles = ['./tests/setup.vitest.ts', './tests/integration/setup.ts']

const writesTestReports =
  process.env.CI === 'true' ||
  process.env.VITEST_REPORTS === '1' ||
  process.argv.some(
    (arg) => arg === '--coverage' || arg.startsWith('--coverage.')
  )

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    // Workers inherit CI's heap; overlapping jobs on a shared host can exhaust memory.
    maxWorkers: 2,
    testTimeout: 10000,
    hookTimeout: 10000,
    reporters: writesTestReports ? ['verbose', 'json', 'html'] : ['verbose'],
    ...(writesTestReports
      ? {
          outputFile: {
            json: './tests/coverage/test-results.json',
            html: './tests/coverage/test-results.html'
          }
        }
      : {}),
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'node',
          globals: true,
          environment: 'node',
          setupFiles,
          include: NODE_GLOBS,
          exclude: SHARED_EXCLUDE,
          testTimeout: 10000,
          hookTimeout: 10000
        }
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'happy-dom',
          globals: true,
          environment: 'happy-dom',
          setupFiles,
          include: ALL_GLOBS,
          exclude: [...SHARED_EXCLUDE, ...NODE_GLOBS],
          testTimeout: 10000,
          hookTimeout: 10000
        }
      },
      {
        test: {
          name: 'eslint-rules',
          globals: true,
          environment: 'node',
          include: ESLINT_RULE_GLOBS,
          exclude: SHARED_EXCLUDE,
          testTimeout: 10000,
          hookTimeout: 10000
        }
      }
    ]
  }
})
