'use client'

import { useEffect, useState } from 'react'

interface RecentFeedRate {
  journalEntryId: string
  date: string
  description: string
  account: string
  foreignAmount: number
  currency: string
  fxRateToBase: number | null
  fxSource: string | null
  fxDate: string | null
}

export default function RecentFeedRates() {
  const [rates, setRates] = useState<RecentFeedRate[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/feeds/recent')
      const data = await res.json()
      if (Array.isArray(data)) setRates(data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => {
    if (open && rates.length === 0) {
      // Defer to avoid "setState synchronously in effect"
      const id = setTimeout(() => { void load() }, 0)
      return () => clearTimeout(id)
    }
  }, [open, rates.length])

  // Phase 2: auto-refresh when new feeds are imported
  useEffect(() => {
    const h = () => {
      if (open) load()
    }
    window.addEventListener('journal-updated', h)
    return () => window.removeEventListener('journal-updated', h)
  }, [open])

  const applyRecentRate = (r: RecentFeedRate) => {
    // Phase 2 interactivity: clicking a real feed rate prefills the QuickFeedImport
    const merchantGuess = (r.description || '').replace(/\s*—.*$/, '').trim().slice(0, 60)
    window.dispatchEvent(new CustomEvent('prefill-quick-feed', {
      detail: {
        merchant: merchantGuess,
        foreignCurrency: r.currency,
        fxRateToBase: r.fxRateToBase,
        fxDate: r.fxDate || r.date,
      }
    }))
    // Also open the importer if the user has it closed
    window.dispatchEvent(new CustomEvent('open-quick-feed'))
  }

  return (
    <div className="border border-zinc-800 rounded-lg p-3 mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="text-sm text-zinc-400 hover:text-zinc-200"
      >
        {open ? '−' : '+'} Recent authoritative feed rates (BANK_FEED)
      </button>

      {open && (
        <div className="mt-2 text-xs">
          {loading && <div className="text-zinc-500">Loading...</div>}
          {!loading && rates.length === 0 && (
            <div className="text-zinc-500">No feed imports yet. Use the quick importer above.</div>
          )}
          <div className="space-y-1 mt-1">
            {rates.map((r, i) => (
              <div
                key={i}
                onClick={() => applyRecentRate(r)}
                className="flex justify-between border-b border-zinc-900 pb-1 cursor-pointer hover:bg-zinc-900/50 rounded px-1 -mx-1"
                title="Click to use this rate in Quick Feed Import"
              >
                <div>
                  {r.date} — {r.description || r.account} <span className="text-zinc-500">({r.currency})</span>
                </div>
                <div className="font-mono text-emerald-400">
                  {r.fxRateToBase ? r.fxRateToBase.toFixed(4) : '—'}
                </div>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-zinc-500 mt-2">
            Click a rate to reuse it in the importer. These rates are authoritative for chat & PDF.
          </div>
        </div>
      )}
    </div>
  )
}
