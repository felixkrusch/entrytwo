'use client'

import { useEffect, useState, useRef } from 'react'
import { Settings, BarChart3, FileText, Users, CreditCard, File, History, ChevronDown, ReceiptText } from 'lucide-react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

interface TopBarProps {
  showSettings?: boolean
  onOpenLicenseModal?: () => void
}

interface LicenseStatus {
  daysRemaining: number
  inTrial: boolean
  isLicensed: boolean
}

export default function TopBar({ showSettings = false, onOpenLicenseModal }: TopBarProps) {
  const [isAdmin, setIsAdmin] = useState(false)
  const [license, setLicense] = useState<LicenseStatus | null>(null)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()

  // Fetch trial / license status (used for the visible trial button)
  const loadLicense = () => {
    fetch('/api/license/status')
      .then(r => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return
        setLicense({
          daysRemaining: d.daysRemaining ?? 0,
          inTrial: !!d.inTrial,
          isLicensed: !!d.isLicensed,
        })
      })
      .catch(() => {})
  }

  useEffect(() => {
    loadLicense()

    const handler = () => loadLicense()
    window.addEventListener('license-updated', handler)
    return () => window.removeEventListener('license-updated', handler)
  }, [])

  const navItems = [
    { name: 'Finances', view: 'dashboard', icon: CreditCard },
    { name: 'Ledger', view: 'ledger', icon: FileText },
    { name: 'Invoicing', view: 'invoicing', icon: FileText },
    { name: 'Journal', view: 'journal', icon: File },
    { name: 'Contacts', view: 'contacts', icon: Users },
    { name: 'Reports', view: 'reports', icon: BarChart3 },
    { name: 'Receipts', view: 'receipts', icon: File },
    { name: 'Claims', view: 'claims', icon: ReceiptText },
  ]

  useEffect(() => {
    if (!showSettings) return
    fetch('/api/me')
      .then(r => r.json())
      .then(d => setIsAdmin(!!d?.isAdmin))
      .catch(() => setIsAdmin(false))
  }, [showSettings])

  // Derive the current view directly from the router hooks.
  // This is the single reliable source of truth in the App Router.
  const viewParam = (searchParams.get('view') || '').trim().toLowerCase()

  // We consider ourselves inside the main app shell when pathname starts with /app.
  const isAppRoot = pathname?.startsWith('/app') ?? false

  // Standard, reliable "is active" logic for a tab bar:
  // - Only show active state inside /app
  // - No ?view param, or ?view=dashboard → "Finances" (dashboard) is the active tab
  // - All other views match exactly (lowercased)
  const isActive = (itemView: string) => {
    if (!isAppRoot) return false
    if (itemView === 'dashboard') {
      return !viewParam || viewParam === 'dashboard'
    }
    return viewParam === itemView
  }

  // Admin dropdown state
  const [showAdminMenu, setShowAdminMenu] = useState(false)
  const adminMenuRef = useRef<HTMLDivElement>(null)

  // Close admin menu on outside click / escape
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (adminMenuRef.current && !adminMenuRef.current.contains(e.target as Node)) {
        setShowAdminMenu(false)
      }
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowAdminMenu(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [])

  const showTrialButton = license && license.inTrial && !license.isLicensed

  return (
    <div className="h-11 border-b border-zinc-800 bg-zinc-950 flex items-center px-4 justify-between shrink-0">
      <div className="flex items-center gap-2">
        <Link href="/app" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <img src="/entrytwo-logo.svg" alt="entrytwo" className="h-5 w-auto" />
        </Link>

        {showTrialButton && (
          <a
            href="https://entrytwo.com"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-4 text-[10px] px-1 rounded bg-amber-900/30 text-amber-400 border border-amber-800 hover:bg-amber-900/50 transition-colors"
            title="Get a license for entrytwo"
          >
            Trial: {license!.daysRemaining} days left
          </a>
        )}
      </div>

      <div className="flex items-center gap-2">
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.view)
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

        {showSettings && (
          <div className="relative" ref={adminMenuRef}>
            <button
              onClick={() => setShowAdminMenu(v => !v)}
              className="flex items-center gap-1 p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
              title="Settings & History"
              aria-haspopup="menu"
              aria-expanded={showAdminMenu}
            >
              <Settings className="w-4 h-4" />
              <ChevronDown className="w-3 h-3" />
            </button>

            {showAdminMenu && (
              <div className="absolute right-0 mt-2 w-56 rounded-md border border-zinc-800 bg-zinc-950 shadow-xl z-50 py-1 text-sm">
                {/* Admin-only items */}
                {isAdmin && (
                  <>
                    <Link href="/admin" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-200" onClick={() => setShowAdminMenu(false)}>
                      Admin Overview
                    </Link>
                    <Link href="/admin/company" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      Company Settings
                    </Link>
                    <Link href="/admin/tax" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      Tax Settings
                    </Link>
                    <Link href="/admin/users" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      Users
                    </Link>
                    <Link href="/admin/ai" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      AI / LLM Provider
                    </Link>
                    <Link href="/admin/backup" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      Backup & Export
                    </Link>
                    <Link href="/admin/bank-feeds" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      Bank Feeds
                    </Link>
                    <Link href="/admin/automation" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      Automation
                    </Link>
                    <Link href="/admin/chart-of-accounts" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      Chart of Accounts
                    </Link>
                    <Link href="/admin/update" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      Update
                    </Link>
                    <div className="my-1 border-t border-zinc-800" />
                  </>
                )}

                {/* Always available from the settings icon dropdown */}
                <Link href="/app?view=history" className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                  <History className="w-4 h-4" /> Commit History
                </Link>

                {/* Manual license entry (always available) */}
                {onOpenLicenseModal && (
                  <button
                    onClick={() => onOpenLicenseModal()}
                    className="text-[10px] px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800 ml-2"
                    title="Enter or change license key"
                  >
                    License
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
