'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

type UpdateStatus = {
  updateAvailable: boolean
  currentCommit: string
  latestCommit: string
}

export default function AdminOverview() {
  const t = useTranslations('app.adminPages')
  const tNav = useTranslations('app.adminNav')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/admin/update')
        if (res.ok) {
          const data = await res.json()
          setUpdateStatus(data)
        }
      } catch {}
    }
    void check()
    const interval = setInterval(check, 60000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">{t('overviewTitle')}</h1>
        <p className="text-sm text-zinc-500 mt-1">
          {t('overviewSubtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href="/admin/company"
          className="block border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors bg-zinc-950"
        >
          <div className="font-medium mb-1">{t('companyTitle')}</div>
          <div className="text-xs text-zinc-500">{t('companyDesc')}</div>
        </Link>

        <Link
          href="/admin/users"
          className="block border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors bg-zinc-950"
        >
          <div className="font-medium mb-1">{t('usersTitle')}</div>
          <div className="text-xs text-zinc-500">{t('usersDesc')}</div>
        </Link>

        <Link
          href="/admin/ai"
          className="block border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors bg-zinc-950"
        >
          <div className="font-medium mb-1">{t('aiTitle')}</div>
          <div className="text-xs text-zinc-500">{t('aiDesc')}</div>
        </Link>

        <Link
          href="/reports"
          className="block border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors bg-zinc-950"
        >
          <div className="font-medium mb-1">{t('reportsTitle')}</div>
          <div className="text-xs text-zinc-500">{t('reportsDesc')}</div>
        </Link>

        <Link
          href="/admin/bank-feeds"
          className="block border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors bg-zinc-950"
        >
          <div className="font-medium mb-1">{t('bankFeedsTitle')}</div>
          <div className="text-xs text-zinc-500">{t('bankFeedsDesc')}</div>
        </Link>

        <Link
          href="/admin/backup"
          className="block border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors bg-zinc-950"
        >
          <div className="font-medium mb-1">Backup & Export</div>
          <div className="text-xs text-zinc-500">Export/import all data as JSON.</div>
        </Link>

        <Link href="/admin/webhooks" className="block border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors bg-zinc-950">
          <div className="font-medium mb-1">Webhook Deliveries</div>
          <div className="text-xs text-zinc-500">Inspect Stripe and PayPal failures and retry durable jobs.</div>
        </Link>

        <Link href="/admin/periods" className="block border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors bg-zinc-950">
          <div className="font-medium mb-1">Accounting Periods</div>
          <div className="text-xs text-zinc-500">Close / reopen fiscal periods. Posting into closed periods is blocked.</div>
        </Link>

        <Link
          href="/admin/update"
          className="block border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors bg-zinc-950 relative"
        >
          <div className="font-medium mb-1">System Update</div>
          <div className="text-xs text-zinc-500">Check for and apply application updates.</div>
          {updateStatus?.updateAvailable && (
            <div className="absolute top-2 right-2 w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></div>
          )}
        </Link>
      </div>

      <div className="mt-10 text-xs text-zinc-500">
        Tip: Click the <span className="font-mono">entrytwo</span> logo in the top bar to return to the main dashboard.
      </div>
    </div>
  )
}
