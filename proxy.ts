import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getApiAccessPolicy, isPublicApiPath, isRoleAllowed } from '@/lib/apiAccessPolicy'
import { TOTP_SESSION_COOKIE, verifyTotpSessionProof } from '@/lib/totpSession'
import { randomUUID } from 'crypto'
import { logger } from '@/lib/logger'

export default auth((request) => {
  const pathname = request.nextUrl.pathname
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const requestId = request.headers.get('x-request-id') || randomUUID()
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; font-src 'self' data:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`
  const next = () => {
    const headers = new Headers(request.headers)
    headers.set('x-nonce', nonce)
    headers.set('x-request-id', requestId)
    headers.set('Content-Security-Policy', csp)
    const response = NextResponse.next({ request: { headers } })
    response.headers.set('Content-Security-Policy', csp)
    response.headers.set('x-request-id', requestId)
    return response
  }
  if (pathname.startsWith('/api/') && isPublicApiPath(pathname, request.method)) return next()
  if (pathname.startsWith('/auth/') && pathname !== '/auth/totp' && pathname !== '/auth/totp/setup') return next()
  if (!request.auth?.user?.id) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    const signIn = new URL('/auth/signin', request.url)
    signIn.searchParams.set('callbackUrl', `${pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(signIn)
  }

  const adminNeedsSetup = process.env.NODE_ENV === 'production'
    && request.auth.user.role === 'ADMIN'
    && !request.auth.user.totpEnabled
  if (adminNeedsSetup) {
    if (pathname === '/auth/totp/setup') return next()
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Administrator TOTP setup required', code: 'TOTP_SETUP_REQUIRED' }, { status: 403 })
    return NextResponse.redirect(new URL('/auth/totp/setup', request.url))
  }
  if (pathname === '/auth/totp') return next()
  if (request.auth.user.totpEnabled) {
    const verified = request.auth.totpSessionId && verifyTotpSessionProof(
      request.cookies.get(TOTP_SESSION_COOKIE)?.value,
      request.auth.user.id,
      request.auth.totpSessionId,
    )
    if (!verified) {
      if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'TOTP verification required', code: 'TOTP_REQUIRED' }, { status: 403 })
      const challenge = new URL('/auth/totp', request.url)
      challenge.searchParams.set('callbackUrl', `${pathname}${request.nextUrl.search}`)
      return NextResponse.redirect(challenge)
    }
  }

  if (pathname.startsWith('/admin') && request.auth.user.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/app', request.url))
  }
  if (pathname === '/app' && request.nextUrl.searchParams.get('view') === 'admin' && request.auth.user.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/app', request.url))
  }

  if (pathname.startsWith('/api/')) {
    const policy = getApiAccessPolicy(pathname, request.method)
    const role = request.auth.user.role
    if (role && !isRoleAllowed(policy.access, role)) {
      const error = policy.access === 'admin' ? 'Admin access required' : 'Accountant access required'
      logger.warn('api policy denied', { path: pathname, role, policy: policy.access, requestId }, request)
      return NextResponse.json({ error, requestId }, { status: 403 })
    }
  }

  return next()
})

export const config = {
  matcher: [
    '/api/:path*',
    '/app/:path*',
    '/admin/:path*',
    '/contacts/:path*',
    '/invoices/:path*',
    '/invoicing/:path*',
    '/reports/:path*',
    '/auth/totp',
    '/auth/totp/setup',
    '/auth/invite',
  ],
}
