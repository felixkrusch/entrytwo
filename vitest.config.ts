import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Git Model integration tests share one DB; run files sequentially and reset the
    // Git-model tables before each file (see vitest.setup.ts) to keep them isolated.
    fileParallelism: false,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
