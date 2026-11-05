import { configDefaults, defineConfig } from 'vitest/config'
import path from 'path'
import 'dotenv/config'

const developmentDatabaseUrl = process.env.DATABASE_URL
const testDatabaseUrl = process.env.DATABASE_URL_TEST
if (!testDatabaseUrl) throw new Error('DATABASE_URL_TEST is required to run tests')
if (testDatabaseUrl === developmentDatabaseUrl) throw new Error('DATABASE_URL_TEST must not equal DATABASE_URL')
if (!new URL(testDatabaseUrl).pathname.endsWith('_test')) throw new Error('The test database name must end in _test')
process.env.DATABASE_URL = testDatabaseUrl

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Git Model integration tests share one DB; run files sequentially and reset the
    // Git-model tables before each file (see vitest.setup.ts) to keep them isolated.
    fileParallelism: false,
    setupFiles: ['./vitest.setup.ts'],
    // Standalone Node.js tests run separately with node --test.
    exclude: [...configDefaults.exclude, '**/*.test.mjs'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
