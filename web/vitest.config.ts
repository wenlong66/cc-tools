import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 30_000,
  },
})
