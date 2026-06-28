'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ContactsRedirectLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  useEffect(() => {
    router.replace('/app?view=contacts')
  }, [router])
  return null
}