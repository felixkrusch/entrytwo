import { validateProductionEnvironment } from '@/lib/env'

export async function register() {
  validateProductionEnvironment()
}
