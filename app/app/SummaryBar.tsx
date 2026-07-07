'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface Summary {
  baseCurrency: string
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  totalEquityWithRetained: number
  retainedEarnings: number
  netIncome: number
  totalRevenue: number
  cashBalance?: number
  balanced: boolean
  currencies: string[]
  entryCount: number
  eventCount: number
  asOf?: string | null
  branch: string
}

export default function SummaryBar() {
  const t = useTranslations('app.panels.summary')
  const format = useFormatter()
  const searchParams = useSearchParams()
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  const branch = searchParams?.get('branch') || 'main'
  const asOf = searchParams?.get('asOf') || searchParams?.get('asof')
  const notMain = branch !== 'main' || !!asOf

  const fetchSummary = async () => {
    setLoading(true)
    try {
      const u = new URLSearchParams()
      if (branch && branch !== 'main') u.set('branch', branch)
      if (asOf) u.set('asOf', asOf)
      const qs = u.toString()
      const res = await fetch(`/api/summary${qs ? `?${qs}` : ''}`)
      if (res.ok) setData(await res.json())
    } catch {
      // keep previous data on transient failure
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchSummary()
    const h = () => void fetchSummary()
    window.addEventListener('journal-updated', h)
    return () => window.removeEventListener('journal-updated', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, asOf])

  const cur = data?.baseCurrency || 'EUR'
  const fmt = (n: number) => format.number(n, { style: 'currency', currency: cur })

  if (!data && loading) {
    return (
      <div className="mb-6 grid grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 h-20 animate-pulse" />
        ))}
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="mb-6 space-y-3">
      {/* Main KPI strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
          <div className="text-xs text-zinc-500">{t('assets')}</div>
          <div className="text-2xl font-mono text-emerald-400 mt-1">{fmt(data.totalAssets)}</div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
          <div className="text-xs text-zinc-500">{t('netIncome')}</div>
          <div className={`text-2xl font-mono mt-1 ${data.netIncome >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {fmt(data.netIncome)}
          </div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
          <div className="text-xs text-zinc-500">{t('revenue')}</div>
          <div className="text-2xl font-mono text-blue-400 mt-1">{fmt(data.totalRevenue)}</div>
        </div>
      </div>

      {/* Financial health snapshot */}
      <div className="flex items-center gap-4 flex-wrap text-xs bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2">
        <span className="text-zinc-500">{t('financialHealth')}:</span>
        <span><span className="text-zinc-400">{t('assets')}</span> <span className="font-mono text-emerald-400">{fmt(data.totalAssets)}</span></span>
        <span><span className="text-zinc-400">{t('liabilities')}</span> <span className="font-mono text-amber-400">{fmt(data.totalLiabilities)}</span></span>
        <span><span className="text-zinc-400">{t('equity')}</span> <span className="font-mono text-purple-300">{fmt(data.totalEquityWithRetained)}</span></span>
        <span className={`font-medium ${data.balanced ? 'text-emerald-400' : 'text-rose-400'}`}>
          {data.balanced ? `✓ ${t('balanced')}` : `✗ ${t('outOfBalance')}`}
        </span>
        <span className="ml-auto text-zinc-500">
          {t('entries')}: {data.entryCount} · {t('events')}: {data.eventCount}
          {notMain && (
            <span className="text-amber-400"> · {t('viewing')} {branch}{asOf ? ` @ ${asOf.slice(0, 10)}` : ''}</span>
          )}
        </span>
        <Link
          href={asOf ? `/app?view=reports&branch=${encodeURIComponent(branch)}&asOf=${encodeURIComponent(asOf)}` : `/app?view=reports`}
          className="text-[10px] px-2 py-0.5 rounded border border-zinc-600 text-zinc-200 hover:bg-zinc-800"
          title="Open the full Reports page (Balance Sheet, P&L, by-currency)"
        >
          {t('viewReports') || 'Full Reports →'}
        </Link>
      </div>
    </div>
  )
}
