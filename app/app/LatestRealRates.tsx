'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

interface RecentRate {
  journalEntryId: string
  date: string
  description: string
  currency: string
  fxRateToBase: number | null
}

export default function LatestRealRates() {
  const t = useTranslations('app.views.fx')
  const [rates, setRates] = useState<RecentRate[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    fetch('/api/feeds/recent')
      .then(r => r.json())
      .then((data: any) => {
        if (!mounted || !Array.isArray(data)) return
        const top = data.slice(0, 3).map((r: any) => ({
          journalEntryId: r.journalEntryId,
          date: r.date,
          description: r.description || r.account || '',
          currency: r.currency || 'EUR',
          fxRateToBase: r.fxRateToBase != null ? Number(r.fxRateToBase) : null,
        }))
        setRates(top)
      })
      .catch(() => {})
      .finally(() => mounted && setLoading(false))

    return () => { mounted = false }
  }, [])

  if (loading) {
    return <div className="text-[11px] text-zinc-500">{t('loadingRates')}</div>
  }

  if (rates.length === 0) {
    return null
  }

  return (
    <div>
      <div className="text-xs font-medium text-zinc-400 mb-1.5">{t('latestTitle')}</div>
      <div className="space-y-1 text-[11px] text-zinc-300">
        {rates.map((r, i) => (
          <div key={i} className="flex justify-between border-b border-zinc-900 pb-0.5 last:border-b-0">
            <span className="truncate pr-2">
              {r.description} <span className="text-zinc-500">({r.currency})</span>
            </span>
            <span className="font-mono text-emerald-400 tabular-nums shrink-0">
              {r.fxRateToBase != null ? r.fxRateToBase.toFixed(4) : '—'}
            </span>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-zinc-500 mt-1">{t('latestHelp')}</div>
    </div>
  )
}
