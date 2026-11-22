'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { appViewHref } from '@/app/lib/booksContext'

export default function ReportsRedirectLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  useEffect(() => {
    router.replace(appViewHref('reports', window.location.search))
  }, [router])
  return <>{children}</>
}
