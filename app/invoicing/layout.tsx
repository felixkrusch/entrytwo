'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function InvoicingRedirectLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  useEffect(() => {
    router.replace('/app?view=invoicing')
  }, [router])
  return null
}