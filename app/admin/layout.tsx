'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Suspense } from 'react'
import TopBar from '@/app/app/TopBar'
import { NewEntryProvider } from '@/app/app/NewEntryContext'

const navItems = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/company', label: 'Company Settings' },
  { href: '/admin/tax', label: 'Tax Settings' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/ai', label: 'AI / LLM Provider' },
  { href: '/admin/backup', label: 'Backup & Export' },
  { href: '/admin/bank-feeds', label: 'Bank Feeds' },
  { href: '/admin/automation', label: 'Automation' },
  { href: '/app?view=history', label: 'Commit History' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-200">
      <Suspense fallback={<div className="h-11 border-b border-zinc-800 bg-zinc-950" />}>
        <TopBar showSettings={true} />
      </Suspense>

      <div className="flex flex-1 min-h-0">
        {/* Left sidebar menu */}
        <div className="w-56 border-r border-zinc-800 bg-zinc-950 p-4 flex flex-col">
          <div className="text-xs uppercase tracking-widest text-zinc-500 mb-3 px-2">Admin</div>

          <nav className="space-y-1">
            {navItems.map(item => {
              const active = item.href === '/admin'
                ? pathname === '/admin'
                : pathname?.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block px-3 py-1.5 rounded text-sm transition-colors ${
                    active
                      ? 'bg-zinc-800 text-white'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="mt-auto pt-6 text-[10px] text-zinc-500 px-2">
            Changes are saved immediately and audited.
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-4xl mx-auto">
            <NewEntryProvider>
              {children}
            </NewEntryProvider>
          </div>
        </div>
      </div>
    </div>
  )
}
