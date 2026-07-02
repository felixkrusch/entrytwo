'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useFormatter } from 'next-intl'

interface Line {
  id: string
  debit: string | number
  credit: string | number
  description?: string | null
  account: { code: string; name: string }
}

interface Entry {
  id: string
  date: string
  description: string | null
  lines: Line[]
}

interface Props {
  accountCode: string
  branch?: string
  asOf?: string
}

export default function LedgerView({ accountCode, branch = 'main', asOf }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const format = useFormatter()

  const [accountName, setAccountName] = useState<string>('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit] = useState(25)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Local filter state (synced with URL for shareability)
  const [search, setSearch] = useState(searchParams?.get('search') || '')
  const [from, setFrom] = useState(searchParams?.get('from') || '')
  const [to, setTo] = useState(searchParams?.get('to') || '')

  const fetchAccountInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts')
      const list: Array<{ code: string; name?: string }> = await res.json()
      if (Array.isArray(list)) {
        const acc = list.find((a) => a.code === accountCode)
        if (acc) setAccountName(acc.name || '')
      }
    } catch {}
  }, [accountCode])

  const fetchLedger = useCallback(async (p = page) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('accountCode', accountCode)
      params.set('page', String(p))
      params.set('limit', String(limit))
      if (search) params.set('search', search)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (branch) params.set('branch', branch)
      if (asOf) params.set('asOf', asOf)

      const res = await fetch(`/api/journal-entries?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load ledger')
      const data = (await res.json()) as { entries?: Entry[]; total?: number }
      setEntries(data.entries || [])
      setTotal(data.total || 0)
    } catch (err: unknown) {
      void err
      setError('Could not load ledger entries')
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [accountCode, search, from, to, page, limit, branch, asOf])

  // Sync filters to URL (so chat / bookmarks work) — include Git model params
  const syncUrl = useCallback(() => {
    const params = new URLSearchParams()
    params.set('view', 'ledger')
    params.set('accountCode', accountCode)
    if (search) params.set('search', search)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (page > 1) params.set('page', String(page))
    if (branch && branch !== 'main') params.set('branch', branch)
    if (asOf) params.set('asOf', asOf)
    router.replace(`/app?${params.toString()}`, { scroll: false })
  }, [accountCode, search, from, to, page, router, branch, asOf])

  // Also allow opening ledger directly from chat with pre-applied filters (Git model: branch/asOf)
  useEffect(() => {
    const handler = (e: Event & { detail?: { code?: string; from?: string; to?: string; search?: string; branch?: string; asOf?: string } }) => {
      const d = e?.detail
      if (d?.code && d.code === accountCode) {
        if (d.from) setFrom(d.from)
        if (d.to) setTo(d.to)
        if (d.search) setSearch(d.search)
        if (d.branch) { /* parent layout handles URL */ }
        if (d.asOf) { /* parent layout handles URL */ }
        setPage(1)
      }
    }
    window.addEventListener('open-ledger', handler)
    return () => window.removeEventListener('open-ledger', handler)
  }, [accountCode])

  useEffect(() => {
    void fetchAccountInfo()
  }, [fetchAccountInfo])

  useEffect(() => {
    void fetchLedger(page)
  }, [fetchLedger, page])

  // Live refresh when any journal changes (chat, new entry, reverse, etc.)
  useEffect(() => {
    const handler = () => void fetchLedger(page)
    window.addEventListener('journal-updated', handler)
    return () => window.removeEventListener('journal-updated', handler)
  }, [fetchLedger, page])

  // Debounced URL sync when filters change
  useEffect(() => {
    const t = setTimeout(() => {
      syncUrl()
    }, 150)
    return () => clearTimeout(t)
  }, [search, from, to, page, syncUrl])

  const totalPages = Math.max(1, Math.ceil(total / limit))

  const goToDashboard = () => {
    router.push('/app?view=dashboard')
  }

  const clearFilters = () => {
    setSearch('')
    setFrom('')
    setTo('')
    setPage(1)
  }

  return (
    <div>
      {/* Dynamic tabs / breadcrumbs + Git model context */}
      <div className="flex items-center gap-2 mb-4 text-sm border-b border-zinc-800 pb-3">
        <button
          onClick={goToDashboard}
          className="px-3 py-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
        >
          Dashboard
        </button>
        <span className="text-zinc-600">›</span>
        <div className="font-medium text-white">
          Ledger · {accountCode} {accountName ? `— ${accountName}` : ''}
        </div>

        {/* Git model context in ledger (accountant friendly) */}
        {(branch && branch !== 'main') || asOf ? (
          <span className="ml-2 text-[10px] px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 font-mono">
            {branch !== 'main' ? `${branch} branch` : 'main'}
            {asOf ? ` • ${asOf.length > 12 ? asOf.slice(0, 8) + '…' : asOf}` : ''}
          </span>
        ) : null}

        <button
          onClick={goToDashboard}
          className="ml-auto text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
        >
          Close ledger
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Search</label>
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Description or line text"
            className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1 text-sm w-64"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-400 block mb-1">From</label>
          <input
            type="date"
            value={from}
            onChange={e => { setFrom(e.target.value); setPage(1) }}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-400 block mb-1">To</label>
          <input
            type="date"
            value={to}
            onChange={e => { setTo(e.target.value); setPage(1) }}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
          />
        </div>
        <button
          onClick={clearFilters}
          className="px-3 py-1 text-sm rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
        >
          Clear
        </button>
        <div className="ml-auto text-xs text-zinc-500">
          {total} entries
        </div>
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm py-8">Loading ledger…</div>
      ) : error ? (
        <div className="text-rose-400 text-sm">{error}</div>
      ) : entries.length === 0 ? (
        <div className="text-zinc-500 text-sm">No entries match the current filters.</div>
      ) : (
        <>
          <div className="space-y-4">
            {entries.map(entry => {
              const debits = entry.lines.reduce((s, l) => s + Number(l.debit || 0), 0)
              const credits = entry.lines.reduce((s, l) => s + Number(l.credit || 0), 0)
              return (
                <div key={entry.id} className="border border-zinc-800 rounded-xl p-4 bg-zinc-950">
                  <div className="flex justify-between text-sm mb-2">
                    <div className="font-medium">{entry.description || 'Untitled entry'}</div>
                    <div className="text-zinc-500 font-mono text-xs">
                      {new Date(entry.date).toISOString().split('T')[0]}
                    </div>
                  </div>
                  <div className="space-y-1 text-sm">
                    {entry.lines.map((line, idx) => (
                      <div key={idx} className="flex justify-between text-xs text-zinc-300">
                        <span>{line.account.code} — {line.account.name} {line.description ? `· ${line.description}` : ''}</span>
                        <span className="font-mono">
                          {Number(line.debit) > 0 ? format.number(Number(line.debit), { style: 'currency', currency: 'EUR' }) : ''}
                          {Number(line.credit) > 0 ? format.number(Number(line.credit), { style: 'currency', currency: 'EUR' }) : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 pt-2 border-t border-zinc-800 text-xs text-right font-mono text-zinc-400">
                    {format.number(debits, { style: 'currency', currency: 'EUR' })} / {format.number(credits, { style: 'currency', currency: 'EUR' })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-6 text-sm">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-3 py-1 rounded border border-zinc-700 disabled:opacity-40"
            >
              ← Previous
            </button>
            <div className="text-zinc-500">
              Page {page} / {totalPages}
            </div>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="px-3 py-1 rounded border border-zinc-700 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
