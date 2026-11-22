import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/__tests__/storage.test.ts', 'lib/__tests__/smtpTransport.test.ts', 'lib/__tests__/backupRoutes.test.ts', 'lib/__tests__/companyBank.test.ts', 'lib/__tests__/adminUsers.test.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
})
