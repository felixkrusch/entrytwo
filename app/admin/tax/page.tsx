'use client'

import { useEffect, useState } from 'react'

interface Setting {
  id: string
  key: string
  value: { value?: string } | Record<string, unknown>
}

interface TaxRateInput {
  name: string
  rate: number
  jurisdiction?: string
}

interface TaxRateRow {
  id: string
  name: string
  rate: number
  jurisdiction?: string
}

export default function TaxSettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([])
  const [rates, setRates] = useState<TaxRateRow[]>([])
  const [loading, setLoading] = useState(true)

  const [newRate, setNewRate] = useState<TaxRateInput>({
    name: '',
    rate: 0,
    jurisdiction: '',
  })

  // Separate state for user-friendly percentage input (e.g. 5 for 5%)
  const [ratePercent, setRatePercent] = useState('0')

  // Quick setup presets (direction decided at use time)
  const quickSetups = {
    germany: [
      { name: 'MwSt 19%', rate: 0.19, jurisdiction: 'DE' },
      { name: 'MwSt 7%', rate: 0.07, jurisdiction: 'DE' },
    ],
    canada: [
      { name: 'GST 5%', rate: 0.05, jurisdiction: 'CA' },
      { name: 'HST 13% (Ontario)', rate: 0.13, jurisdiction: 'CA-ON' },
      { name: 'HST 15%', rate: 0.15, jurisdiction: 'CA-NS' },
      { name: 'QST 9.975%', rate: 0.09975, jurisdiction: 'CA-QC' },
      { name: 'Tax Exempt', rate: 0, jurisdiction: 'CA' },
    ],
    usa: [
      { name: 'Sales Tax 6%', rate: 0.06, jurisdiction: 'US' },
      { name: 'Sales Tax (California) 7.25%', rate: 0.0725, jurisdiction: 'US-CA' },
      { name: 'Sales Tax (New York) 8.875%', rate: 0.08875, jurisdiction: 'US-NY' },
      { name: 'Tax Exempt', rate: 0, jurisdiction: 'US' },
    ],
  }

  const [selectedQuickSetup, setSelectedQuickSetup] = useState<'germany' | 'canada' | 'usa' | ''>('')

  const fetchData = async () => {
    try {
      const [sRes, tRes] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/tax-rates'),
      ])
      const s = await sRes.json()
      const t = await tRes.json()
      if (Array.isArray(s)) setSettings(s)
      if (Array.isArray(t)) setRates(t)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const id = setTimeout(() => { void fetchData() }, 0)
    return () => clearTimeout(id)
  }, [])

  // Sync percentage input with decimal rate
  const handleRatePercentChange = (val: string) => {
    setRatePercent(val)
    const num = parseFloat(val)
    if (!isNaN(num)) {
      setNewRate(prev => ({ ...prev, rate: Math.max(0, Math.min(1, num / 100)) }))
    }
  }

  const createRate = async () => {
    if (!newRate.name.trim()) return
    await fetch('/api/tax-rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newRate),
    })
    // Reset form
    setNewRate({ name: '', rate: 0, jurisdiction: '' })
    setRatePercent('0')
    fetchData()
  }

  const applyQuickSetup = async (key: 'germany' | 'canada' | 'usa') => {
    const preset = quickSetups[key]
    if (!preset || preset.length === 0) return

    for (const r of preset) {
      await fetch('/api/tax-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r),
      })
    }
    setSelectedQuickSetup('')
    fetchData()
  }

  const deleteRate = async (id: string) => {
    if (!confirm('Delete this tax rate?')) return
    await fetch(`/api/tax-rates/${id}`, { method: 'DELETE' })
    fetchData()
  }

  if (loading) {
    return <div className="text-sm text-zinc-500">Loading...</div>
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Tax Settings</h1>
        <p className="text-xs text-zinc-500">
          Define all tax rates your company needs (GST, HST, QST, VAT, Sales Tax, Exempt, etc.).<br />
          You can apply multiple rates on a single transaction when required.
        </p>
      </div>

      {/* Existing rates */}
      <div className="mb-8">
        <div className="font-medium mb-2">Defined Tax Rates</div>
        <div className="space-y-2 text-sm max-w-3xl">
          {rates.length === 0 && <div className="text-zinc-500">No tax rates defined yet.</div>}
          {rates.map((r) => (
            <div key={r.id} className="flex items-center justify-between border border-zinc-800 rounded px-3 py-2">
              <div>
                <span className="font-medium">{r.name}</span>
                <span className="text-zinc-400 ml-2">
                  {(Number(r.rate) * 100).toFixed(3)}%
                  {r.jurisdiction ? ` — ${r.jurisdiction}` : ''}
                </span>
              </div>
              <button onClick={() => deleteRate(r.id)} className="text-xs text-rose-400 hover:text-rose-300">Delete</button>
            </div>
          ))}
        </div>
      </div>

      {/* Create new rate */}
      <div className="max-w-xl">
        <div className="font-medium mb-3">Add New Tax Rate</div>

        {/* Quick Setup */}
        <div className="mb-4">
          <div className="text-xs text-zinc-400 mb-1">Quick Setup</div>
          <div className="flex items-center gap-2">
            <select
              value={selectedQuickSetup}
              onChange={(e) => {
                const key = e.target.value as 'germany' | 'canada' | 'usa' | ''
                if (key) {
                  setSelectedQuickSetup(key)
                  void applyQuickSetup(key)
                } else {
                  setSelectedQuickSetup('')
                }
              }}
              className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm min-w-[260px]"
            >
              <option value="">Choose preset…</option>
              <option value="germany">Germany – MwSt 19%/7%</option>
              <option value="canada">Canada – GST / HST / QST + Tax Exempt</option>
              <option value="usa">United States – Sales Tax + Tax Exempt</option>
            </select>
            <span className="text-[10px] text-zinc-500">Adds common rates for the country</span>
          </div>
        </div>

        {/* Manual form */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Display name</label>
            <input
              placeholder="e.g. GST 5%, HST 13% (Ontario), Tax Exempt"
              value={newRate.name}
              onChange={e => setNewRate({ ...newRate, name: e.target.value })}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
            />
            <p className="text-[10px] text-zinc-500 mt-1">This name will appear on invoices and receipts.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Rate</label>
              <div className="flex items-center rounded border border-zinc-700 bg-zinc-900">
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="100"
                  placeholder="5"
                  value={ratePercent}
                  onChange={e => handleRatePercentChange(e.target.value)}
                  className="flex-1 bg-transparent px-3 py-2 text-sm focus:outline-none"
                />
                <div className="px-3 text-zinc-400 select-none">%</div>
              </div>
              <p className="text-[10px] text-zinc-500 mt-1">Enter the percentage (5 = 5%).</p>
            </div>


          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Jurisdiction (optional)</label>
            <input
              placeholder="e.g. CA-QC, US-CA, DE, CA-ON"
              value={newRate.jurisdiction || ''}
              onChange={e => setNewRate({ ...newRate, jurisdiction: e.target.value.toUpperCase() })}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-500"
            />
            <p className="text-[10px] text-zinc-500 mt-1">Use ISO 3166-2 codes when relevant (CA-ON, US-CA…).</p>
          </div>

           {/* Live preview */}
           {newRate.name.trim() && (
             <div className="rounded bg-zinc-900 border border-zinc-700 px-3 py-2 text-xs">
               <span className="text-zinc-400">Preview:</span>{' '}
               <span className="font-medium text-white">&ldquo;{newRate.name}&rdquo;</span>
               {newRate.jurisdiction ? ` • ${newRate.jurisdiction}` : ''}
               {` • ${(newRate.rate * 100).toFixed(3)}%`}
             </div>
           )}

          <div className="pt-1">
            <button
              onClick={createRate}
              disabled={!newRate.name.trim()}
              className="px-4 py-2 rounded bg-white text-black text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-200 transition"
            >
              Add Tax Rate
            </button>
          </div>
        </div>

        <div className="text-[10px] text-zinc-500 mt-3">
          Tip: Create a 0% rate called “Tax Exempt”. For places with multiple layers (Quebec, many US states), add the rates separately so they can be combined on one line.
        </div>
      </div>
    </div>
  )
}
