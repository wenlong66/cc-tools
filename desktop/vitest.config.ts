import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

const useSingleWorker = process.platform === 'win32'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    css: true,
    ...(useSingleWorker ? { maxWorkers: 1, minWorkers: 1 } : {}),
    setupFiles: [],
    coverage: {
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/types/**',
        'src/mocks/**',
        'src/vite-env.d.ts',
      ],
    },
  },
})
