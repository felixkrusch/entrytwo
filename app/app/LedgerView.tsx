'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useFormatter } from 'next-intl'

interface Line {
  id: string
  debit: string | number
  credit: string | number
  description?: string | null
  cleared?: boolean
  account: { code: string; name: string }
}

interface Entry {
  id: string
  date: string
  description: string | null
  entryNumber?: string | null
  createdBy?: string | null
  createdByUser?: { id: string; name?: string | null; email?: string | null } | null
  reversalOfEntryNumber?: string | null
  lines: Line[]
}

interface Props {
  accountCode: string
  branch?: string
  asOf?: string
}

// Compute the opening balance for an account as of the day BEFORE `from`,
// so a filtered ledger view doesn't look like it starts from zero.
async function fetchOpeningBalance(accountCode: string, from: string, branch?: string, asOf?: string): Promise<number> {
  try {
    const params = new URLSearchParams()
    params.set('accountCode', accountCode)
    params.set('to', from)
    if (branch && branch !== 'main') params.set('branch', branch)
    if (asOf) params.set('asOf', asOf)
    const res = await fetch(`/api/journal-entries?${params.toString()}`)
    if (!res.ok) return 0
    const data = await res.json()
    const list: Entry[] = data.entries || []
    let bal = 0
    for (const e of list) {
      for (const l of e.lines) {
        if (l.account.code !== accountCode) continue
        bal += Number(l.debit || 0) - Number(l.credit || 0)
      }
    }
    return bal
  } catch {
    return 0
  }
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
  const [runningBalance, setRunningBalance] = useState(0)
  const [openingBalance, setOpeningBalance] = useState(0)

  // Sort order control (asc/desc by date)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

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
      params.set('sort', `date:${sortDir}`)
      if (search) params.set('search', search)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (branch) params.set('branch', branch)
      if (asOf) params.set('asOf', asOf)

      const res = await fetch(`/api/journal-entries?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load ledger')
      const data = (await res.json()) as { entries?: Entry[]; total?: number }
      const list = data.entries || []
      setEntries(list)
      setTotal(data.total || 0)

      // Compute running balance for this account across the FULL ordered set.
      // We always compute oldest -> newest so each row carries a cumulative total,
      // regardless of the currently displayed (possibly reversed) order.
      const orderedForBalance = [...list].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      let bal = 0
      for (const e of orderedForBalance) {
        for (const l of e.lines) {
          if (l.account.code !== accountCode) continue
          bal += Number(l.debit || 0) - Number(l.credit || 0)
        }
      }
      setRunningBalance(bal)
    } catch (err: unknown) {
      void err
      setError('Could not load ledger entries')
      setEntries([])
      setRunningBalance(0)
    } finally {
      setLoading(false)
    }
  }, [accountCode, search, from, to, page, limit, branch, asOf, sortDir])

  // Opening balance: balance as of the day before `from` (filtered range).
  useEffect(() => {
    if (!from) {
      setOpeningBalance(0)
      return
    }
    let cancelled = false
    fetchOpeningBalance(accountCode, from, branch, asOf).then(b => {
      if (!cancelled) setOpeningBalance(b)
    })
    return () => { cancelled = true }
  }, [accountCode, from, branch, asOf])

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

  // Build running balances per row in display order (oldest -> newest for cumulative correctness).
  // We render rows in `sortDir` order but compute cumulative from oldest.
  const rowsWithBalance = useMemo(() => {
    const ordered = [...entries].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    let running = openingBalance
    const balanceByEntry = new Map<string, number>()
    for (const e of ordered) {
      for (const l of e.lines) {
        if (l.account.code !== accountCode) continue
        running += Number(l.debit || 0) - Number(l.credit || 0)
      }
      balanceByEntry.set(e.id, running)
    }
    return balanceByEntry
  }, [entries, accountCode, openingBalance])

  const goToDashboard = () => {
    router.push('/app?view=dashboard')
  }

  const clearFilters = () => {
    setSearch('')
    setFrom('')
    setTo('')
    setPage(1)
  }

  const openJournalForEntry = (entryNumber?: string | null) => {
    const params = new URLSearchParams()
    params.set('view', 'journal')
    if (entryNumber) params.set('entryRef', entryNumber)
    router.push(`/app?${params.toString()}`)
  }

  const toggleCleared = async (lineId: string, next: boolean) => {
    // Optimistic local update so the list does not reload / scroll to top.
    setEntries(prev =>
      prev.map(e => ({
        ...e,
        lines: e.lines.map(l => (l.id === lineId ? { ...l, cleared: next } : l)),
      }))
    )
    // Persist in the background without disturbing the current view.
    try {
      await fetch('/api/journal-entries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineId, cleared: next }),
      })
    } catch {
      // Revert on failure.
      setEntries(prev =>
        prev.map(e => ({
          ...e,
          lines: e.lines.map(l => (l.id === lineId ? { ...l, cleared: !next } : l)),
        }))
      )
    }
  }

  return (
    <div>
      {/* Dynamic tabs / breadcrumbs + Git model context */}
      <div className="flex items-center gap-2 mb-4 text-sm border-b border-zinc-800 pb-3 flex-wrap">
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
          onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
          className="px-3 py-1 text-sm rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
          title="Toggle date sort order"
        >
          Date: {sortDir === 'asc' ? '↑ Oldest' : '↓ Newest'}
        </button>
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
          <div className="text-xs text-zinc-400 mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              Running balance for <span className="font-mono text-zinc-200">{accountCode}</span>:{' '}
              <span className="font-mono text-zinc-200">{format.number(runningBalance, { style: 'currency', currency: 'EUR' })}</span>
            </span>
            {from && (
              <span className="text-zinc-500">
                Opening balance (before {from}):{' '}
                <span className="font-mono text-zinc-300">{format.number(openingBalance, { style: 'currency', currency: 'EUR' })}</span>
              </span>
            )}
          </div>

          <div className="space-y-4">
            {entries.map(entry => {
              const debits = entry.lines.reduce((s, l) => s + Number(l.debit || 0), 0)
              const credits = entry.lines.reduce((s, l) => s + Number(l.credit || 0), 0)
              let accountDelta = 0
              const accountLines: typeof entry.lines = []
              for (const l of entry.lines) {
                if (l.account.code === accountCode) {
                  accountDelta += Number(l.debit || 0) - Number(l.credit || 0)
                  accountLines.push(l)
                }
              }
              const isReversal = !!entry.reversalOfEntryNumber
              const rowBalance = rowsWithBalance.get(entry.id) ?? 0

              return (
                <div
                  key={entry.id}
                  className={`border rounded-xl p-4 bg-zinc-950 ${isReversal ? 'border-rose-900/40 bg-zinc-950/70' : 'border-zinc-800'}`}
                >
                  <div className="flex justify-between text-sm mb-2 flex-wrap gap-2">
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => openJournalForEntry(entry.entryNumber)}
                        className="font-mono text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700"
                        title="Open in Journal"
                      >
                        {entry.entryNumber || '—'}
                      </button>
                      <span className={isReversal ? 'line-through text-zinc-500' : ''}>
                        {entry.description || 'Untitled entry'}
                      </span>
                      {isReversal && (
                        <span className="text-[10px] px-1.5 py-px rounded bg-rose-900/40 text-rose-400 border border-rose-800">
                          Reversal of {entry.reversalOfEntryNumber}
                        </span>
                      )}
                    </div>
                     <div className="text-zinc-500 font-mono text-xs">
                       {new Date(entry.date).toISOString().split('T')[0]}
                       {entry.createdByUser && (
                         <span className="ml-2 text-zinc-600 normal-case font-sans">
                           · {entry.createdByUser.name || entry.createdByUser.email || 'user'}
                         </span>
                       )}
                     </div>
                  </div>

                  {/* Double-entry lines with explicit Debit / Credit columns + cleared status */}
                  <div className="space-y-1 text-sm mb-2">
                    <div className="flex justify-between text-[10px] uppercase text-zinc-500 px-1">
                      <span className="flex-1">Account</span>
                      <span className="w-28 text-right">Debit</span>
                      <span className="w-28 text-right">Credit</span>
                      <span className="w-12 text-center">✓</span>
                    </div>
                    {entry.lines.map((line, idx) => {
                      const isThisAccount = line.account.code === accountCode
                      return (
                        <div
                          key={idx}
                          className={`flex justify-between items-center text-xs rounded px-1 py-0.5 ${isThisAccount ? 'bg-zinc-800/60 text-zinc-100' : 'text-zinc-300'}`}
                        >
                          <span className="flex-1 truncate">
                            {line.account.code} — {line.account.name}
                            {line.description ? ` · ${line.description}` : ''}
                            {isThisAccount && <span className="ml-1 text-[10px] text-emerald-400">(this account)</span>}
                          </span>
                          <span className="w-28 text-right font-mono text-emerald-400">
                            {Number(line.debit) > 0 ? format.number(Number(line.debit), { style: 'currency', currency: 'EUR' }) : ''}
                          </span>
                          <span className="w-28 text-right font-mono text-rose-400">
                            {Number(line.credit) > 0 ? format.number(Number(line.credit), { style: 'currency', currency: 'EUR' }) : ''}
                          </span>
                          <span className="w-12 text-center">
                            {isThisAccount && (
                              <input
                                type="checkbox"
                                checked={!!line.cleared}
                                onChange={(e) => toggleCleared(line.id, e.target.checked)}
                                title="Mark as cleared / reconciled"
                                className="accent-emerald-500"
                              />
                            )}
                          </span>
                        </div>
                      )
                    })}
                  </div>

                  <div className="mt-2 pt-2 border-t border-zinc-800 text-xs flex justify-between font-mono text-zinc-400">
                    <span title="Net effect on this account from the full journal entry">
                      Effect on {accountCode}: <span className={accountDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{format.number(accountDelta, { style: 'currency', currency: 'EUR' })}</span>
                    </span>
                    <span title="Cumulative balance of this account after this entry">
                      Balance: <span className="text-zinc-200">{format.number(rowBalance, { style: 'currency', currency: 'EUR' })}</span>
                    </span>
                    <span title="Totals of the full journal entry (all lines)">
                      {format.number(debits, { style: 'currency', currency: 'EUR' })} / {format.number(credits, { style: 'currency', currency: 'EUR' })}
                    </span>
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
