'use client'

import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import Link from 'next/link'

interface TopBarProps {
  showSettings?: boolean
}

export default function TopBar({ showSettings = false }: TopBarProps) {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    if (!showSettings) return
    fetch('/api/me')
      .then(r => r.json())
      .then(d => setIsAdmin(!!d?.isAdmin))
      .catch(() => setIsAdmin(false))
  }, [showSettings])

  return (
    <div className="h-11 border-b border-zinc-800 bg-zinc-950 flex items-center px-4 justify-between shrink-0">
      <Link href="/app" className="flex items-baseline gap-2 hover:opacity-80 transition-opacity">
        <span className="font-semibold tracking-tight">entrytwo</span>
        <span className="text-xs text-zinc-500">AI Accountant • Phase 0/1</span>
      </Link>

      {showSettings && isAdmin && (
        <Link
          href="/admin"
          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Admin & Settings"
        >
          <Settings className="w-4 h-4" />
        </Link>
      )}
    </div>
  )
}
