'use client'

import { useEffect, useState } from 'react'

interface Period {
  id: string
  name: string
  startDate: string
  endDate: string
  status: 'OPEN' | 'CLOSED'
  closedAt?: string | null
  reopenReason?: string | null
}

export default function PeriodsPage() {
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [error, setError] = useState('')
  const [reopenReason, setReopenReason] = useState<Record<string, string>>({})

  const load = async () => {
    const res = await fetch('/api/accounting/periods')
    if (res.ok) setPeriods(await res.json())
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const create = async () => {
    setError('')
    const res = await fetch('/api/accounting/periods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, startDate: start, endDate: end }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Failed to create period')
      return
    }
    setName(''); setStart(''); setEnd('')
    void load()
  }

  const transition = async (id: string, action: 'close' | 'reopen', reason?: string) => {
    setError('')
    const body: { action: 'close' | 'reopen'; reason?: string } = { action }
    if (action === 'reopen' && reason) body.reason = reason
    const res = await fetch(`/api/accounting/periods/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Failed')
      return
    }
    setReopenReason(r => ({ ...r, [id]: '' }))
    void load()
  }

  if (loading) return <div className="text-sm text-zinc-500">Loading periods…</div>

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Accounting Periods</h1>
        <p className="text-xs text-zinc-500 mt-1">Close periods to prevent posting. Reopening requires a reason and is audited.</p>
      </div>

      {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      <div className="mb-6 border border-zinc-800 rounded p-4 space-y-2">
        <div className="font-medium text-sm">Create new period</div>
        <div className="flex flex-wrap gap-2">
          <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm" />
          <input type="date" value={start} onChange={e => setStart(e.target.value)} className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm" />
          <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm" />
          <button onClick={create} className="px-3 py-1 bg-white text-black rounded text-sm">Create</button>
        </div>
      </div>

      <div className="space-y-2">
        {periods.map(p => {
          const closed = p.status === 'CLOSED'
          return (
            <div key={p.id} className="border border-zinc-800 rounded px-3 py-2 flex items-center justify-between gap-3 text-sm">
              <div>
                <span className="font-medium">{p.name}</span>
                <span className="ml-2 text-zinc-500">{p.startDate.slice(0,10)} → {p.endDate.slice(0,10)}</span>
                {closed && <span className="ml-2 text-amber-400 text-xs">CLOSED</span>}
              </div>

              <div className="flex items-center gap-2">
                {!closed ? (
                  <button onClick={() => transition(p.id, 'close')} className="text-xs px-2 py-0.5 border border-zinc-700 rounded hover:bg-zinc-900">Close</button>
                ) : (
                  <div className="flex items-center gap-1">
                    <input
                      placeholder="Reopen reason (min 10 chars)"
                      value={reopenReason[p.id] || ''}
                      onChange={e => setReopenReason(r => ({ ...r, [p.id]: e.target.value }))}
                      className="bg-zinc-950 border border-zinc-800 rounded px-2 py-0.5 text-xs w-72"
                    />
                    <button
                      disabled={!reopenReason[p.id] || reopenReason[p.id].trim().length < 10}
                      onClick={() => transition(p.id, 'reopen', reopenReason[p.id])}
                      className="text-xs px-2 py-0.5 border border-zinc-700 rounded disabled:opacity-50"
                    >
                      Reopen
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {!periods.length && <div className="text-zinc-500 text-sm">No periods yet.</div>}
      </div>
    </div>
  )
}
