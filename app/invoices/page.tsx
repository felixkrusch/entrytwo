'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function InvoicesRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/app?view=invoices')
  }, [router])
  return null
}
