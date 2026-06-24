'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import toast from 'react-hot-toast'

export default function QuickFeedImport() {
  const t = useTranslations('app.chat.feeds')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: '',
    settlementAccountCode: '1100',
    counterAccountCode: '5100',
    baseAmount: 0,
    baseCurrency: 'EUR',
    foreignAmount: 0,
    foreignCurrency: 'USD',
    merchant: '',
    reference: '',
  })

  const update = (k: string, v: string | number) => setForm(prev => ({ ...prev, [k]: v }))

  // Phase 2: listen for clicks from RecentFeedRates + external open command
  useEffect(() => {
    const prefill = (e: CustomEvent<{ merchant?: string; foreignCurrency?: string; fxRateToBase?: number; fxDate?: string }>) => {
      const d = e.detail || {}
      if (d.merchant) update('merchant', d.merchant)
      if (d.foreignCurrency) update('foreignCurrency', d.foreignCurrency)
      if (d.fxRateToBase) {
        setForm(prev => ({ ...prev, description: ((prev.description || '') + ` (remembered rate ~${d.fxRateToBase})`.trim()) }))
      }
      if (d.fxDate) {
        update('date', d.fxDate)
      }
      setOpen(true)
    }

    const forceOpen = () => setOpen(true)

    window.addEventListener('prefill-quick-feed', prefill as EventListener)
    window.addEventListener('open-quick-feed', forceOpen)
    return () => {
      window.removeEventListener('prefill-quick-feed', prefill as EventListener)
      window.removeEventListener('open-quick-feed', forceOpen)
    }
  }, []) // run once; update() is stable enough for this pattern

  const submit = async () => {
    setLoading(true)
    setMsg('')
    setError('')

    try {
      const payload = {
        date: form.date,
        description: form.description || undefined,
        settlementAccountCode: form.settlementAccountCode,
        counterAccountCode: form.counterAccountCode,
        baseAmount: Number(form.baseAmount),
        baseCurrency: form.baseCurrency,
        foreignAmount: Number(form.foreignAmount),
        foreignCurrency: form.foreignCurrency,
        merchant: form.merchant || undefined,
        reference: form.reference || undefined,
        fxSource: `BANK_FEED:quick:${form.reference || 'manual'}`,
        fxDate: form.date,
      }

      const res = await fetch('/api/feeds/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Import failed')
      }

      toast.success(t('success') || 'BANK_FEED imported — real rate recorded')
      setMsg(t('successMsg') || 'Feed imported. Authoritative rate recorded.')
      window.dispatchEvent(new CustomEvent('journal-updated'))

      setForm(prev => ({ ...prev, description: '', merchant: '', reference: '' }))
    } catch (e: unknown) {
      const msg = (e as Error)?.message || (t('errorGeneric') || 'Feed import failed')
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border border-zinc-800 rounded-lg p-3">
      <button
        onClick={() => setOpen(!open)}
        className="text-sm text-zinc-400 hover:text-zinc-200 flex items-center gap-2"
      >
        {open ? '−' : '+'} {t('title') || 'Quick Bank/Card Feed Import (authoritative FX)'}
      </button>

      {open && (
        <div className="mt-3 space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={form.date}
              onChange={e => update('date', e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1"
            />
            <input
              placeholder="Description (optional)"
              value={form.description}
              onChange={e => update('description', e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Settlement account (e.g. 1100)"
              value={form.settlementAccountCode}
              onChange={e => update('settlementAccountCode', e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 font-mono"
            />
            <input
              placeholder="Counter account (e.g. 5100)"
              value={form.counterAccountCode}
              onChange={e => update('counterAccountCode', e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 font-mono"
            />
          </div>

          <div className="grid grid-cols-4 gap-2">
            <input
              type="number"
              step="0.01"
              placeholder="Base amount"
              value={form.baseAmount || ''}
              onChange={e => update('baseAmount', parseFloat(e.target.value) || 0)}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1"
            />
            <input
              value={form.baseCurrency}
              onChange={e => update('baseCurrency', e.target.value.toUpperCase())}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 font-mono"
            />
            <input
              type="number"
              step="0.01"
              placeholder="Foreign amount"
              value={form.foreignAmount || ''}
              onChange={e => update('foreignAmount', parseFloat(e.target.value) || 0)}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1"
            />
            <input
              value={form.foreignCurrency}
              onChange={e => update('foreignCurrency', e.target.value.toUpperCase())}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 font-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Merchant (optional)"
              value={form.merchant}
              onChange={e => update('merchant', e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1"
            />
            <input
              placeholder="Reference (optional)"
              value={form.reference}
              onChange={e => update('reference', e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={loading}
              className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-sm disabled:opacity-50"
            >
              {loading ? 'Importing…' : (t('import') || 'Import as BANK_FEED (authoritative)')}
            </button>
            <button
              onClick={() => { setOpen(false); setMsg(''); setError('') }}
              className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-sm"
            >
              {t('close') || 'Close'}
            </button>
          </div>

          {msg && <div className="text-emerald-400 text-xs">{msg}</div>}
          {error && <div className="text-rose-400 text-xs">{error}</div>}

          <div className="text-[10px] text-zinc-500">
            This creates a real journal entry with fxSource = BANK_FEED:.... 
            Future PDF uploads that match will use the real rate and skip forced confirmation.
          </div>
        </div>
      )}
    </div>
  )
}
