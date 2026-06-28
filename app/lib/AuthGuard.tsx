'use client'

import { useSession } from 'next-auth/react'
import { ReactNode, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

export default function AuthGuard({ children }: { children: ReactNode }) {
  const { status } = useSession()
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    // Public routes that don't require auth
    const publicRoutes = ['/auth/signin', '/auth/verify', '/auth/error']
    
    if (status === 'loading') return // Still checking session
    
    if (status === 'unauthenticated' && !publicRoutes.includes(pathname)) {
      router.push('/auth/signin')
    }
  }, [status, pathname, router])

  // Show loading or let the page handle unauthenticated state
  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900 text-zinc-400">
        Loading...
      </div>
    )
  }

  // Let the page handle rendering - middleware will redirect
  return <>{children}</>
}