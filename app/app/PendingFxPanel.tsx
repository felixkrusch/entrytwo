// app/app/PendingFxPanel.tsx
// First-class view of foreign purchases recorded with provisional rates.
// Follows the plan in docs/FX-Provisional-Rates-FX-Adjustments-Implementation.md

'use client'

import { useEffect, useState } from 'react'
import { useFormatter } from 'next-intl'
import { isAuthoritativeBankFeed } from '@/lib/fxSources'
import { useNewEntry } from './NewEntryContext'

interface PendingLine {
  id: string
  journalEntryId: string
  entryNumber?: string | null
  description: string
  date: string
  accountCode: string
  accountName: string
  currency: string
  foreignAmount: number
  fxRateToBase: number | null
  fxSource: string | null
  fxDate: string | null
}

export default function PendingFxPanel() {
  const format = useFormatter()
  const { openNewEntry } = useNewEntry()
  const [items, setItems] = useState<PendingLine[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    fetch('/api/journal-entries?limit=200')
      .then(r => r.json())
      .then((data: any) => {
        const list = Array.isArray(data) ? data : (data?.entries || [])
        const pending: PendingLine[] = []
        for (const e of list) {
          for (const l of (e.lines || [])) {
            const cur = (l.currency || 'EUR').toUpperCase()
            if (cur === 'EUR') continue
            const src = l.fxSource || ''
            if (isAuthoritativeBankFeed(src)) continue
            pending.push({
              id: l.id,
              journalEntryId: e.id,
              entryNumber: e.entryNumber,
              description: e.description || '',
              date: e.date,
              accountCode: l.account?.code || '',
              accountName: l.account?.name || '',
              currency: cur,
              foreignAmount: Number(l.debit) || Number(l.credit) || 0,
              fxRateToBase: l.fxRateToBase != null ? Number(l.fxRateToBase) : null,
              fxSource: src || 'PROVISIONAL',
              fxDate: l.fxDate || null,
            })
          }
        }
        setItems(pending)
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const openAdjustment = (item: PendingLine) => {
    openNewEntry({
      description: `FX + fee adjustment for ${item.entryNumber || item.journalEntryId} - ${item.description}`,
      merchant: item.description,
      lines: [
        { accountCode: item.accountCode, debit: 0, credit: 0, currency: 'EUR', description: `FX diff for ${item.description}` },
        { accountCode: '6990', debit: 0, credit: 0, currency: 'EUR', description: 'Foreign transaction fee / FX' },
        { accountCode: '2100', debit: 0, credit: 0, currency: 'EUR', description: `Adjustment for ${item.entryNumber || ''}` },
      ],
    })
  }

  if (loading) return <div className="text-xs text-zinc-500">Loading pending FX items…</div>
  if (items.length === 0) return <div className="text-xs text-emerald-400">No pending provisional FX items. All foreign lines have authoritative feed rates.</div>

  return (
    <div className="space-y-2">
      <div className="text-xs text-amber-400 font-medium">Foreign purchases with provisional / estimated rates — awaiting statement</div>
      {items.map(it => (
        <div key={it.id} className="border border-amber-900/40 bg-zinc-950 rounded p-2 text-xs flex justify-between items-center gap-2">
          <div>
            <span className="font-mono text-zinc-400">{it.entryNumber || it.journalEntryId.slice(0,8)}</span>
            {' · '}
            <span className="text-zinc-200">{it.description}</span>
            <span className="ml-2 text-amber-400">({it.currency} {it.foreignAmount.toFixed(2)} @ {it.fxRateToBase != null ? it.fxRateToBase.toFixed(4) : '—'} via {it.fxSource})</span>
            <span className="ml-2 text-zinc-500">{new Date(it.date).toISOString().slice(0,10)}</span>
          </div>
          <button
            onClick={() => openAdjustment(it)}
            className="px-2 py-0.5 text-[10px] rounded border border-amber-700 hover:bg-amber-900/30 text-amber-300"
          >
            Create FX adjustment
          </button>
        </div>
      ))}
      <div className="text-[10px] text-zinc-500">When the real statement arrives, post a small adjustment entry. Original entries stay untouched (Git model).</div>
    </div>
  )
}
