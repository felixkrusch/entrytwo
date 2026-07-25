import { handlers } from '@/lib/auth'
import { NextRequest } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  // Callback / session traffic — moderate limit
  const limited = await rateLimit(request, { keyPrefix: 'auth-get', limit: 60, windowMs: 10 * 60_000 })
  return limited || handlers.GET(request)
}

export async function POST(request: NextRequest) {
  // Magic-link send + OAuth/csrf — tighter
  const limited = await rateLimit(request, { keyPrefix: 'auth-post', limit: 15, windowMs: 10 * 60_000 })
  return limited || handlers.POST(request)
}
