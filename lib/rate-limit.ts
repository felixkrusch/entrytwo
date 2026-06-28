import { NextRequest, NextResponse } from 'next/server'

interface RateLimitEntry {
  count: number
  resetTime: number
}

const store = new Map<string, RateLimitEntry>()

const DEFAULT_LIMIT = 60
const AUTH_LIMIT = 120

export function rateLimit(request: NextRequest): NextResponse | null {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 
             request.headers.get('x-real-ip') ?? 
             'unknown'
  
  const pathname = request.nextUrl.pathname
  const hasAuth = request.cookies.has('authjs.session') ||
                  request.cookies.has('authjs.session_token') ||
                  request.cookies.has('__Secure-authjs.session-token')
  
  const limit = hasAuth ? AUTH_LIMIT : DEFAULT_LIMIT
  const windowMs = 60000

  const now = Date.now()
  const entry = store.get(ip)

  if (entry && entry.resetTime > now) {
    entry.count++
    if (entry.count > limit) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429 }
      )
    }
  } else {
    store.set(ip, { count: 1, resetTime: now + windowMs })
  }

  return null
}