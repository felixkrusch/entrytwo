'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

interface Summary {
  totalAssets: number
  netIncome: number
  entryCount: number
  eventCount: number
}

export default function SummaryBar() {
  const t = useTranslations('app.panels.summary')
  const [data, setData] = useState<Summary | null>(null)

  const fetchSummary = async () => {
    try {
      const [bs, pl, je, ev] = await Promise.all([
        fetch('/api/reports/balance-sheet').then(r => r.json()),
        fetch('/api/reports/profit-loss').then(r => r.json()),
        fetch('/api/journal-entries').then(r => r.json()),
        fetch('/api/events').then(r => r.json())
      ])

      const assets = (bs || []).filter((a: any) => a.type === 'ASSET').reduce((s: number, a: any) => s + a.balance, 0)
      const net = pl?.netIncome || 0
      const entries = Array.isArray(je) ? je.length : 0
      const events = Array.isArray(ev) ? ev.length : 0

      setData({
        totalAssets: parseFloat(assets.toFixed(2)),
        netIncome: parseFloat(net.toFixed(2)),
        entryCount: entries,
        eventCount: events
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

  return (
    <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
        <div className="text-xs text-zinc-500">{t('assets')}</div>
        <div className="text-2xl font-mono text-emerald-400 mt-1">${data.totalAssets.toFixed(2)}</div>
      </div>
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
        <div className="text-xs text-zinc-500">{t('netIncome')}</div>
        <div className={`text-2xl font-mono mt-1 ${data.netIncome >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          ${data.netIncome.toFixed(2)}
        </div>
      </div>
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
        <div className="text-xs text-zinc-500">{t('entries')}</div>
        <div className="text-2xl font-mono text-white mt-1">{data.entryCount}</div>
      </div>
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
        <div className="text-xs text-zinc-500">{t('events')}</div>
        <div className="text-2xl font-mono text-white mt-1">{data.eventCount}</div>
      </div>
    </div>
  )
}
