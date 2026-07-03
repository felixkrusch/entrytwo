'use client'

import { useEffect, useState } from 'react'
import { Settings, BarChart3, FileText, Users, CreditCard, File } from 'lucide-react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'

interface TopBarProps {
  showSettings?: boolean
}

export default function TopBar({ showSettings = false }: TopBarProps) {
  const [isAdmin, setIsAdmin] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  const navItems = [
    { name: 'Finances', view: 'dashboard', icon: CreditCard },
    { name: 'Invoicing', view: 'invoicing', icon: FileText },
    { name: 'Contacts', view: 'contacts', icon: Users },
    { name: 'Reports', view: 'reports', icon: BarChart3 },
    { name: 'Receipts', view: 'receipts', icon: File },
  ]

  useEffect(() => {
    if (!showSettings) return
    fetch('/api/me')
      .then(r => r.json())
      .then(d => setIsAdmin(!!d?.isAdmin))
      .catch(() => setIsAdmin(false))
  }, [showSettings])

  const currentView = typeof window !== 'undefined' 
    ? (new URLSearchParams(window.location.search).get('view') ?? (pathname === '/app' ? 'dashboard' : ''))
    : 'dashboard'

  return (
    <div className="h-11 border-b border-zinc-800 bg-zinc-950 flex items-center px-4 justify-between shrink-0">
      <Link href="/app" className="flex items-baseline gap-2 hover:opacity-80 transition-opacity">
        <span className="font-semibold tracking-tight">entrytwo</span>
      </Link>

      <div className="flex items-center gap-2">
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = pathname === '/app' && (currentView === item.view || (!currentView && item.view === 'dashboard'))
            return (
              <button
                key={item.view}
                onClick={() => router.push(`/app?view=${item.view}`)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
                  active ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                }`}
                title={item.name}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.name}
              </button>
            )
          })}
        </nav>

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
    </div>
  )
}