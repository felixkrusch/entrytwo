import { validateProductionEnvironment } from '@/lib/env'

export async function register() {
  validateProductionEnvironment()
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeStorage } = await import('./lib/storage')
    await initializeStorage()
  }
}
