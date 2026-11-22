'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { appViewHref } from '@/app/lib/booksContext'

export default function InvoicesRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace(appViewHref('invoices', window.location.search))
  }, [router])
  return null
}
