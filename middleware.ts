import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const publicRoutes = ['/auth/signin', '/auth/verify', '/auth/error', '/api/auth', '/api/bootstrap/status', '/api/users', '/api/settings', '/api/auth/dev']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow public routes
  const isPublic = publicRoutes.some(r => pathname.startsWith(r))
  if (isPublic) return NextResponse.next()

  // Check for session token (basic check)
  const hasSession = req.cookies.has('authjs.session') || 
                     req.cookies.has('authjs.session_token') ||
                     req.cookies.has('__Secure-authjs.session-token')

  if (!hasSession) {
    const signInUrl = new URL('/auth/signin', req.nextUrl.origin)
    signInUrl.searchParams.set('callbackUrl', req.nextUrl.href)
    return NextResponse.redirect(signInUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
}