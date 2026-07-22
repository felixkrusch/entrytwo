'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import TopBar from '@/app/app/TopBar'
import { NewEntryProvider } from '@/app/app/NewEntryContext'
import LicenseGate from '@/app/app/LicenseGate'
import LicenseModal from '@/app/app/LicenseModal'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const t = useTranslations('app.adminNav')

  const navItems = [
    { href: '/admin', label: t('overview') },
    { href: '/admin/company', label: t('company') },
    { href: '/admin/tax', label: t('tax') },
    { href: '/admin/users', label: t('users') },
    { href: '/admin/ai', label: t('ai') },
    { href: '/admin/backup', label: t('backup') },
    { href: '/admin/bank-feeds', label: t('bankFeeds') },
    { href: '/admin/automation', label: t('automation') },
    { href: '/admin/chart-of-accounts', label: t('chartOfAccounts') },
    { href: '/admin/update', label: t('update') },
    { href: '/app?view=history', label: t('history') },
  ]

  const [licenseStatus, setLicenseStatus] = useState<any>(null)
  const [licenseLoading, setLicenseLoading] = useState(true)
  const [showLicenseModal, setShowLicenseModal] = useState(false)

  const loadLicense = async () => {
    setLicenseLoading(true)
    try {
      const res = await fetch('/api/license/status')
      if (res.ok) {
        const data = await res.json()
        setLicenseStatus(data)
      } else {
        setLicenseStatus(null)
      }
    } catch {
      setLicenseStatus(null)
    } finally {
      setLicenseLoading(false)
    }
  }

  useEffect(() => {
    void loadLicense()
  }, [])

  const handleLicenseActivated = () => {
    void loadLicense()
    setShowLicenseModal(false)
    window.dispatchEvent(new CustomEvent('license-updated'))
  }

  const openLicenseModal = () => setShowLicenseModal(true)

  const isLicensed = !!licenseStatus?.isLicensed
  const inTrial = !!licenseStatus?.inTrial
  const showPaywall = !licenseLoading && !isLicensed && !inTrial

  if (showPaywall) {
    return <LicenseGate onActivated={handleLicenseActivated} />
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-200">
      <Suspense fallback={<div className="h-11 border-b border-zinc-800 bg-zinc-950" />}>
        <TopBar showSettings={true} onOpenLicenseModal={openLicenseModal} />
      </Suspense>

      <div className="flex flex-1 min-h-0">
        <div className="w-56 border-r border-zinc-800 bg-zinc-950 p-4 flex flex-col">
          <div className="text-xs uppercase tracking-widest text-zinc-500 mb-3 px-2">{t('section')}</div>

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

          <div className="mt-3">
            <button
              onClick={openLicenseModal}
              className={`text-left text-[10px] px-2 py-1 rounded border transition-colors ${
                isLicensed
                  ? 'border-emerald-800 bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/50'
                  : inTrial
                    ? 'border-amber-800 bg-amber-900/30 text-amber-400 hover:bg-amber-900/50'
                    : 'border-red-800 bg-red-900/30 text-red-400 hover:bg-red-900/50'
              }`}
              title={t('licenseTitle')}
            >
              {t('license')}
            </button>
          </div>

          <div className="mt-auto pt-6 text-[10px] text-zinc-500 px-2">
            {t('footer')}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-4xl mx-auto">
            <NewEntryProvider>
              {children}
            </NewEntryProvider>
          </div>
        </div>
      </div>

      <LicenseModal
        isOpen={showLicenseModal}
        onClose={() => setShowLicenseModal(false)}
        onActivated={handleLicenseActivated}
      />
    </div>
  )
}
