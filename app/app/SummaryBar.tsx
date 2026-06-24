'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useFormatter } from 'next-intl'

interface Summary {
  totalAssets: number
  netIncome: number
  entryCount: number
  eventCount: number
  currencies: string[]
}

export default function SummaryBar() {
  const t = useTranslations('app.panels.summary')
  const format = useFormatter()
  const [data, setData] = useState<Summary | null>(null)

  const fetchSummary = async () => {
    try {
      const [bs, pl, je, ev] = await Promise.all([
        fetch('/api/reports/balance-sheet').then(r => r.json()),
        fetch('/api/reports/profit-loss').then(r => r.json()),
        fetch('/api/journal-entries').then(r => r.json()),
        fetch('/api/events').then(r => r.json())
      ])

      // Balances from balance-sheet are already base-currency (EUR) thanks to fxRateToBase conversion
      const assets = (bs || []).filter((a: any) => a.type === 'ASSET').reduce((s: number, a: any) => s + a.balance, 0)
      const net = pl?.netIncome || 0
      const entries = Array.isArray(je) ? je.length : 0
      const events = Array.isArray(ev) ? ev.length : 0

      // Collect currencies present across journal lines (for the little "Currencies: ..." hint)
      const curSet = new Set<string>()
      if (Array.isArray(je)) {
        je.forEach((e: any) => (e.lines || []).forEach((l: any) => {
          if (l.currency) curSet.add(l.currency)
        }))
      }
      const currencies = Array.from(curSet).sort()

      setData({
        totalAssets: parseFloat(assets.toFixed(2)),
        netIncome: parseFloat(net.toFixed(2)),
        entryCount: entries,
        eventCount: events,
        currencies,
      })
    } catch (e) {
      // ignore
    }
  }

  useEffect(() => {
    fetchSummary()
    const h = () => fetchSummary()
    window.addEventListener('journal-updated', h)
    return () => window.removeEventListener('journal-updated', h)
  }, [])

  if (!data) return null

  const curLabel = data.currencies.length > 0 ? data.currencies.join(', ') : 'EUR'

  return (
    <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
        <div className="text-xs text-zinc-500">{t('assets')}</div>
        <div className="text-2xl font-mono text-emerald-400 mt-1">
          {format.number(data.totalAssets, { style: 'currency', currency: 'EUR' })}
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
        <div className="text-[10px] text-zinc-500 mt-0.5">Currencies: {curLabel} (base EUR)</div>
      </div>
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
        <div className="text-xs text-zinc-500">{t('events')}</div>
        <div className="text-2xl font-mono text-white mt-1">{data.eventCount}</div>
      </div>
    </div>
  )
}
