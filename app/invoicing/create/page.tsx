'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function CreateInvoiceRedirect() {
  const router = useRouter()
  useEffect(() => {
    // Redirect to the new AI-first invoicing panel (chat left, form right)
    router.replace('/app?view=invoicing')
  }, [router])
  return null
}
