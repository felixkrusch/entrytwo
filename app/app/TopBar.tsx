'use client'

import { useEffect, useState, useRef } from 'react'
import { Settings, BarChart3, FileText, Users, CreditCard, File, History, ChevronDown, ReceiptText, LogOut } from 'lucide-react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { signOut } from '@/lib/auth-client'

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
  const t = useTranslations('app.nav')
  const tAdmin = useTranslations('app.adminNav')
  const [isAdmin, setIsAdmin] = useState(false)
  const [license, setLicense] = useState<LicenseStatus | null>(null)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()

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
    { name: t('finances'), view: 'dashboard', icon: CreditCard },
    { name: t('ledger'), view: 'ledger', icon: FileText },
    { name: t('invoicing'), view: 'invoicing', icon: FileText },
    { name: t('journal'), view: 'journal', icon: File },
    { name: t('contacts'), view: 'contacts', icon: Users },
    { name: t('reports'), view: 'reports', icon: BarChart3 },
    { name: t('receipts'), view: 'receipts', icon: File },
    { name: t('claims'), view: 'claims', icon: ReceiptText },
  ]

  useEffect(() => {
    if (!showSettings) return
    fetch('/api/me')
      .then(r => r.json())
      .then(d => setIsAdmin(!!d?.isAdmin))
      .catch(() => setIsAdmin(false))
  }, [showSettings])

  const viewParam = (searchParams.get('view') || '').trim().toLowerCase()
  const isAppRoot = pathname?.startsWith('/app') ?? false

  const isActive = (itemView: string) => {
    if (!isAppRoot) return false
    if (itemView === 'dashboard') {
      return !viewParam || viewParam === 'dashboard'
    }
    return viewParam === itemView
  }

  const [showAdminMenu, setShowAdminMenu] = useState(false)
  const adminMenuRef = useRef<HTMLDivElement>(null)

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
            title={t('trialTitle')}
          >
            {t('trialDays', { days: license!.daysRemaining })}
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
              title={t('settings')}
              aria-haspopup="menu"
              aria-expanded={showAdminMenu}
            >
              <Settings className="w-4 h-4" />
              <ChevronDown className="w-3 h-3" />
            </button>

            {showAdminMenu && (
              <div className="absolute right-0 mt-2 w-56 rounded-md border border-zinc-800 bg-zinc-950 shadow-xl z-50 py-1 text-sm">
                {isAdmin && (
                  <>
                    <Link href="/admin" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-200" onClick={() => setShowAdminMenu(false)}>
                      {tAdmin('overview')}
                    </Link>
                    <Link href="/admin/company" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      {tAdmin('company')}
                    </Link>
                    <Link href="/admin/tax" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      {tAdmin('tax')}
                    </Link>
                    <Link href="/admin/users" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      {tAdmin('users')}
                    </Link>
                    <Link href="/admin/ai" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      {tAdmin('ai')}
                    </Link>
                    <Link href="/admin/backup" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      {tAdmin('backup')}
                    </Link>
                    <Link href="/admin/bank-feeds" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      {tAdmin('bankFeeds')}
                    </Link>
                    <Link href="/admin/automation" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      {tAdmin('automation')}
                    </Link>
                    <Link href="/admin/chart-of-accounts" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      {tAdmin('chartOfAccounts')}
                    </Link>
                    <Link href="/admin/update" className="block px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                      {tAdmin('update')}
                    </Link>
                    <div className="my-1 border-t border-zinc-800" />
                  </>
                )}

                <Link href="/app?view=history" className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-900 text-zinc-300" onClick={() => setShowAdminMenu(false)}>
                  <History className="w-4 h-4" /> {tAdmin('history')}
                </Link>

                {onOpenLicenseModal && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAdminMenu(false)
                      onOpenLicenseModal()
                    }}
                    className={
                      !license
                        ? 'w-full text-left px-3 py-1.5 hover:bg-zinc-900 text-zinc-300'
                        : license.isLicensed
                          ? 'w-full text-left px-3 py-1.5 hover:bg-zinc-900 text-emerald-400'
                          : license.inTrial
                            ? 'w-full text-left px-3 py-1.5 hover:bg-zinc-900 text-amber-400'
                            : 'w-full text-left px-3 py-1.5 hover:bg-zinc-900 text-red-400'
                    }
                    title={tAdmin('licenseTitle')}
                  >
                    {t('license')}
                  </button>
                )}

                <div className="my-1 border-t border-zinc-800" />
                <button
                  type="button"
                  onClick={() => {
                    setShowAdminMenu(false)
                    void signOut({ callbackUrl: '/auth/signin' })
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-zinc-900 text-zinc-300"
                >
                  <LogOut className="w-4 h-4" />
                  {t('signOut')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
