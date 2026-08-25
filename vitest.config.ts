import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Vitest rather than `node --test`.
 *
 * The suite used to run on node:test with test files importing TypeScript
 * directly, which relies on runtime type stripping -- a Node 22.6 feature that
 * was never backported. That silently excluded Node 20 from CI even though
 * `engines` claims to support it, and it left no way to render React at all.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,mts,mjs}', 'web/src/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    environmentMatchGlobs: [['web/src/**', 'jsdom']],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['cli/**/*.ts', 'web/src/**/*.{ts,tsx}'],
      exclude: ['web/src/main.tsx', '**/*.test.*'],
      reporter: ['text-summary', 'html'],
    },
  },
})
