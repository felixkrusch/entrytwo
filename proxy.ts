import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getApiAccessPolicy, isPublicApiPath, isRoleAllowed } from '@/lib/apiAccessPolicy'
import { TOTP_SESSION_COOKIE, verifyTotpSessionProof } from '@/lib/totpSession'

export default auth((request) => {
  const pathname = request.nextUrl.pathname
  if (pathname.startsWith('/api/') && isPublicApiPath(pathname, request.method)) return NextResponse.next()
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
    if (pathname === '/auth/totp/setup') return NextResponse.next()
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Administrator TOTP setup required', code: 'TOTP_SETUP_REQUIRED' }, { status: 403 })
    return NextResponse.redirect(new URL('/auth/totp/setup', request.url))
  }
  if (pathname === '/auth/totp') return NextResponse.next()
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
      return NextResponse.json({ error }, { status: 403 })
    }
  }

  return NextResponse.next()
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
  ],
}
