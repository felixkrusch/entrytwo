'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ReportsRedirectLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  useEffect(() => {
    router.replace('/app?view=reports')
  }, [router])
  return <>{children}</>
}