import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/__tests__/storage.test.ts', 'lib/__tests__/smtpTransport.test.ts'],
  },
})
