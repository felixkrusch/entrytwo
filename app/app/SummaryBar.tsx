'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useFormatter } from 'next-intl'

interface Summary {
  totalAssets: number
  totalRevenue: number
  netIncome: number
  entryCount: number
  eventCount: number
  currencies: string[]
  cashBalance?: number
}

export default function SummaryBar() {
  const t = useTranslations('app.panels.summary')
  const format = useFormatter()
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchSummary = async () => {
    setLoading(true)
    setError(null)
    try {
      const settled = await Promise.allSettled([
        fetch('/api/reports/balance-sheet'),
        fetch('/api/reports/profit-loss'),
        fetch('/api/journal-entries'),
        fetch('/api/events'),
      ])
      const [bsRes, plRes, jeRes, evRes] = settled

      const safeJson = async (p: PromiseSettledResult<Response>) => {
        if (p.status !== 'fulfilled' || !p.value.ok) return null
        try { return await p.value.json() } catch { return null }
      }

      const bsJson: unknown = await safeJson(bsRes)
      let bsAccounts: Array<{ code: string; type?: string; balance?: number }> = []
      if (Array.isArray(bsJson)) {
        bsAccounts = bsJson as Array<{ code: string; type?: string; balance?: number }>
      } else if (bsJson && typeof bsJson === 'object' && Array.isArray((bsJson as { accounts?: unknown }).accounts)) {
        bsAccounts = (bsJson as { accounts: Array<{ code: string; type?: string; balance?: number }> }).accounts
      }

      const plJson: unknown = await safeJson(plRes)
      const net = (plJson && typeof plJson === 'object' && 'netIncome' in (plJson as Record<string, unknown>))
        ? Number((plJson as { netIncome?: unknown }).netIncome) || 0
        : 0
      const rev = (plJson && typeof plJson === 'object' && 'revenue' in (plJson as Record<string, unknown>))
        ? Number(((plJson as { revenue?: unknown }).revenue as { total?: unknown })?.total) || 0
        : 0

      const jeJson: unknown = await safeJson(jeRes)
      const je: Array<{ lines?: Array<{ currency?: string }> }> = Array.isArray(jeJson) ? (jeJson as Array<{ lines?: Array<{ currency?: string }> }>) : []

      const evJson: unknown = await safeJson(evRes)
      const ev: unknown[] = Array.isArray(evJson) ? (evJson as unknown[]) : []

      const assets = bsAccounts
        .filter((a) => a && a.type === 'ASSET')
        .reduce((s, a) => s + (Number(a.balance) || 0), 0)

      // Find cash account (code 1000 or 1100)
      const cashAccount = bsAccounts.find((a) => a && (a.code === '1000' || a.code === '1100'))
      const cashBalance = cashAccount ? Number(cashAccount.balance) : undefined

      const entryCount = je.length
      const eventCount = ev.length

      const curSet = new Set<string>()
      je.forEach((e) => {
        if (Array.isArray(e?.lines)) {
          e.lines.forEach((l) => { if (l && l.currency) curSet.add(String(l.currency)) })
        }
      })
      const currencies = Array.from(curSet).sort()

      setData({
        totalAssets: parseFloat((assets || 0).toFixed(2)),
        totalRevenue: parseFloat((rev || 0).toFixed(2)),
        netIncome: parseFloat((net || 0).toFixed(2)),
        entryCount: Number(entryCount) || 0,
        eventCount: Number(eventCount) || 0,
        currencies,
        cashBalance,
      })
      setLastUpdated(new Date())
    } catch (e) {
      setError((e as Error)?.message || 'Failed to load summary')
      // Still show zeros as fallback
      setData({ totalAssets: 0, totalRevenue: 0, netIncome: 0, entryCount: 0, eventCount: 0, currencies: [], cashBalance: undefined })
      setLastUpdated(new Date())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true
    const run = () => { if (mounted) fetchSummary() }
    run()
    const h = () => run()
    window.addEventListener('journal-updated', h)
    return () => {
      mounted = false
      window.removeEventListener('journal-updated', h)
    }
  }, [])

  if (loading && !data) {
    return (
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1,2,3,4].map(i => (
          <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 h-20 animate-pulse" />
        ))}
      </div>
    )
  }

  if (!data) {
    // Fallback: always render something visible (zeros) instead of blocking error
    return (
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0,1,2,3].map(i => (
          <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
            <div className="text-xs text-zinc-500">—</div>
            <div className="text-2xl font-mono text-zinc-500 mt-1">—</div>
          </div>
        ))}
      </div>
    )
  }

  const curLabel = data.currencies.length > 0 ? data.currencies.join(', ') : 'EUR'

  return (
    <div className="mb-6">
      {error && (
        <div className="text-[10px] text-rose-400 mb-2 px-2">{error}</div>
      )}
      <div className="grid grid-cols-3 xxl:grid-cols-6 gap-3">
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
          <div className="text-xs text-zinc-500">{t('assets')}</div>
          <div className="text-2xl font-mono text-emerald-400 mt-1">
            {format.number(data.totalAssets, { style: 'currency', currency: 'EUR' })}
          </div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
          <div className="text-xs text-zinc-500">{t('revenue')}</div>
          <div className="text-2xl font-mono text-blue-400 mt-1">
            {format.number(data.totalRevenue, { style: 'currency', currency: 'EUR' })}
          </div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
          <div className="text-xs text-zinc-500">{t('netIncome')}</div>
          <div className={`text-2xl font-mono mt-1 ${data.netIncome >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {format.number(data.netIncome, { style: 'currency', currency: 'EUR' })}
          </div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
          <div className="text-xs text-zinc-500">{t('entries')}</div>
          <div className="text-2xl font-mono text-white mt-1">{data.entryCount}</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">Currencies: {curLabel}</div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
          <div className="text-xs text-zinc-500">{t('events')}</div>
          <div className="text-2xl font-mono text-white mt-1">{data.eventCount}</div>
        </div>
        {data.cashBalance !== undefined && (
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
            <div className="text-xs text-zinc-500">{t('cash')}</div>
            <div className="text-2xl font-mono text-amber-400 mt-1">
              {format.number(data.cashBalance, { style: 'currency', currency: 'EUR' })}
            </div>
          </div>
        )}
      </div>
      {lastUpdated && (
        <div className="text-[10px] text-zinc-600 mt-1 text-right">
          updated {lastUpdated.toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
