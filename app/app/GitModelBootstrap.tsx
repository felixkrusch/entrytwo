'use client'

import { useEffect } from 'react'

export default function GitModelBootstrap() {
  useEffect(() => {
    // Ensure the main accounting branch exists (Git model foundation)
    fetch('/api/accounting/branches/ensure-main', { method: 'POST' }).catch(() => {})
  }, [])

  return null
}
