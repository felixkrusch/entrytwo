import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { pathname } = req.nextUrl

  // Allow public routes
  const publicRoutes = ['/auth/signin', '/auth/verify', '/auth/error', '/api/auth']
  const isPublic = publicRoutes.some(r => pathname.startsWith(r))

  // Check if user is authenticated
  if (!req.auth && !isPublic) {
    const signInUrl = new URL('/auth/signin', req.nextUrl.origin)
    signInUrl.searchParams.set('callbackUrl', req.nextUrl.href)
    return NextResponse.redirect(signInUrl)
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
}