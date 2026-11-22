'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { appViewHref } from '@/app/lib/booksContext'

export default function InvoicingLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  
  useEffect(() => {
    if (pathname === '/invoicing') {
      router.replace(appViewHref('invoicing', window.location.search))
    }
  }, [pathname, router])

  return <>{children}</>
}
