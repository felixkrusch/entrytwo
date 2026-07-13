import { handlers } from '@/lib/auth'
import { NextRequest } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'

export const GET = handlers.GET
export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, { keyPrefix: 'auth', limit: 20, windowMs: 10 * 60_000 })
  return limited || handlers.POST(request)
}
