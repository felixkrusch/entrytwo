'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'

export default function InvoicingLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  
  useEffect(() => {
    if (pathname === '/invoicing') {
      router.replace('/app?view=invoicing')
    }
  }, [pathname, router])

  return <>{children}</>
}
