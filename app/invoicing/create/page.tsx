'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { appViewHref } from '@/app/lib/booksContext'

export default function CreateInvoiceRedirect() {
  const router = useRouter()
  useEffect(() => {
    // Redirect to the new AI-first invoicing panel (chat left, form right)
    router.replace(appViewHref('invoicing', window.location.search))
  }, [router])
  return null
}
