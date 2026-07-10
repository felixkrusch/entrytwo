'use client'

import { useEffect, useState } from 'react'
import { useNewEntry } from './NewEntryContext'
import toast from 'react-hot-toast'
import { useTranslations, useFormatter } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { Paperclip, RefreshCw, Upload } from 'lucide-react'
import { isAuthoritativeBankFeed, getFxSourceLabel } from '@/lib/fxSources'

interface JournalLine {
  id: string
  debit: string
  credit: string
  description?: string | null   // line-level note (returned by API)
  cleared?: boolean
  account: { code: string; name: string }
  taxRate?: {
    id: string
    jurisdiction: string
    name: string
    rate: number
    taxType: string
  } | null
  taxIsInput?: boolean | null
  currency?: string
  fxRateToBase?: string | number | null
  fxSource?: string | null
  fxDate?: string | null
}

interface JournalEntry {
  id: string
  date: string
  description: string | null
  entryNumber?: string | null
  createdBy?: string | null
  createdByUser?: { id: string; name?: string | null; email?: string | null } | null
  updatedAt?: string | null
  reversalOfEntryNumber?: string | null
  sourcePdfPath?: string | null
  attachments?: Array<{
    id: string
    path: string
    originalName: string
    mimeType: string
    size: number
    sha256: string
    createdAt: string
    createdBy?: string | null
  }>
  lines: JournalLine[]
}

export interface JournalEntriesPanelProps {
  filterAccountId?: string
  branch?: string
  asOf?: string
  limit?: number            // if provided, show only this many most recent (for dashboard)
  showPagination?: boolean  // show page controls (for full journal view)
}

export default function JournalEntriesPanel({
  filterAccountId,
  branch = 'main',
  asOf,
  limit,
  showPagination = true,
}: JournalEntriesPanelProps) {
  const { openNewEntry } = useNewEntry()
  const t = useTranslations('app.panels.journal')
  const format = useFormatter()
  const searchParams = useSearchParams()
  const entryRef = searchParams?.get('entryRef') || ''

  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [reversedMap, setReversedMap] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandAll, setExpandAll] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [uploadingEntryId, setUploadingEntryId] = useState<string | null>(null)

  // Date-range + account filters for the full journal view
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [accountFilter, setAccountFilter] = useState(filterAccountId || '')

  // Pagination (only used when showPagination is true and no limit is passed)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const pageSize = 25

  const fetchEntries = () => {
    const params = new URLSearchParams()
    if (filterAccountId) params.set('accountCode', filterAccountId)
    else if (accountFilter) params.set('accountCode', accountFilter)
    if (branch) params.set('branch', branch)
    if (asOf) params.set('asOf', asOf)
    if (search) params.set('search', search)
    if (from) params.set('from', from)
    if (to) params.set('to', to)

    // When a hard limit is provided (dashboard "5 recent"), we still ask the API for a larger page
    // and then slice client-side so we always get the freshest N.
    // When showPagination is true we use normal server pagination.
    if (limit && !showPagination) {
      params.set('limit', String(Math.max(limit, 100)))
      params.set('page', '1')
    } else if (showPagination) {
      params.set('limit', String(pageSize))
      params.set('page', String(page))
    }

    fetch(`/api/journal-entries?${params.toString()}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load journal')
        return res.json()
      })
      .then(data => {
        let list: JournalEntry[] = []
        if (Array.isArray(data)) list = data
        else if (data && Array.isArray(data.entries)) list = data.entries

        if (limit && !showPagination) {
          // Keep only the most recent N (API returns newest first with date:desc)
          setEntries(list.slice(0, limit))
        } else {
          setEntries(list)
        }

        // Auto-expand a specific entry when arriving from the ledger via ?entryRef=JE-...
        if (entryRef) {
          const match = list.find(e => e.entryNumber === entryRef)
          if (match) setExpanded(match.id)
        }

        if (data && typeof data.totalPages === 'number') setTotalPages(data.totalPages || 1)
      })
      .catch(() => {
        setError('Could not load journal entries')
        setEntries([])
      })
      .finally(() => setLoading(false))
  }

  const fetchReversals = () => {
    fetch('/api/events')
      .then(res => res.json())
      .then((events: Array<{ eventType?: string; payload?: { originalId?: string }; description?: string | null }>) => {
        const map = new Map<string, string>()
        events.forEach(ev => {
          if (ev.eventType === 'JOURNAL_ENTRY_REVERSED' && ev.payload?.originalId) {
            const origId = ev.payload.originalId
            const desc = ev.description || 'Reversal'
            map.set(origId, desc)
          }
        })
        setReversedMap(map)
      })
      .catch(() => {})
  }

  useEffect(() => {
    let mounted = true
    const doFetch = () => {
      if (!mounted) return
      fetchEntries()
      fetchReversals()
      setLastUpdated(new Date())
    }
    doFetch()

    const handler = () => doFetch()
    window.addEventListener('journal-updated', handler)
    return () => {
      mounted = false
      window.removeEventListener('journal-updated', handler)
    }
  }, [filterAccountId, branch, asOf, limit, showPagination, page, search, from, to, accountFilter])

  const filteredEntries = filterAccountId
    ? entries.filter(entry =>
        entry.lines.some(line => line.account.code === filterAccountId)
      )
    : entries

  // Use the real reversal map coming from events (originalId -> reversal description)
  const reversalMap = reversedMap

  // Calculate running totals for visible entries
  let totalDebits = 0
  let totalCredits = 0
  filteredEntries.forEach(entry => {
    entry.lines.forEach(l => {
      totalDebits += parseFloat(l.debit)
      totalCredits += parseFloat(l.credit)
    })
  })

  const router = useRouter()

  const refresh = () => {
    setError(null)
    fetchEntries()
    fetchReversals()
    setLastUpdated(new Date())
  }

  const openLedgerForAccount = (code: string) => {
    const params = new URLSearchParams()
    params.set('view', 'ledger')
    params.set('accountCode', code)
    router.push(`/app?${params.toString()}`)
  }

  const addAttachments = async (entryId: string, files: FileList | null) => {
    if (!files?.length) return
    setUploadingEntryId(entryId)
    try {
      const form = new FormData()
      Array.from(files).forEach(file => form.append('file', file))
      form.append('branch', branch)
      const response = await fetch(`/api/journal-entries/${entryId}/attachments`, { method: 'POST', body: form })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Upload failed')
      toast.success(`${result.attachments?.length || files.length} attachment(s) added`)
      window.dispatchEvent(new CustomEvent('journal-updated'))
    } catch (uploadError) {
      toast.error(uploadError instanceof Error ? uploadError.message : 'Attachment upload failed')
    } finally {
      setUploadingEntryId(null)
    }
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-zinc-500 flex items-center gap-2">
          {t('title')}
          {filterAccountId && (
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('clear-account-filter'))}
              className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-900"
              title="Clear this filter"
            >
              filtered: {filterAccountId} ×
            </button>
          )}
          <button
            onClick={refresh}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Refresh journal"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {filterAccountId && (
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('clear-account-filter'))}
              className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
            >
              {t('clearFilter')}
            </button>
          )}
            <button 
            onClick={() => openNewEntry()}
            className="text-xs px-3 py-1 rounded bg-white text-black hover:bg-zinc-200 transition font-medium"
          >
            {t('newEntry')}
          </button>
          <button
            onClick={() => setExpandAll(!expandAll)}
            className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
          >
            {expandAll ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      </div>
      {lastUpdated && (
        <div className="text-[10px] text-zinc-600 -mt-3 mb-2 text-right">
          as of {lastUpdated.toLocaleTimeString()}
        </div>
      )}

      {showPagination && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Search</label>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Description or line text"
              className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1 text-sm w-56"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Account</label>
            <input
              value={accountFilter}
              onChange={e => { setAccountFilter(e.target.value); setPage(1) }}
              placeholder="e.g. 1000"
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm w-24"
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
            onClick={() => { setSearch(''); setAccountFilter(''); setFrom(''); setTo(''); setPage(1) }}
            className="px-3 py-1 text-sm rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
          >
            Clear
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-zinc-500 text-sm">{t('loading')}</div>
      ) : error ? (
        <div className="text-rose-400 text-sm">{error}</div>
      ) : filteredEntries.length === 0 ? (
        <div className="text-zinc-500 text-sm">
          {t('empty', { filter: filterAccountId ? t('emptyFilter') : '' })}
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {filteredEntries.map(entry => {
              const isOpen = expandAll || expanded === entry.id
              const entryDebits = entry.lines.reduce((s, l) => s + parseFloat(l.debit), 0)
              const entryCredits = entry.lines.reduce((s, l) => s + parseFloat(l.credit), 0)
              // Balanced when total debits equal total credits (base-currency independent check on raw columns)
              const balanced = Math.abs(entryDebits - entryCredits) < 0.005
              const isReversal = !!entry.reversalOfEntryNumber || entry.description?.startsWith('Reversal of')
              const hasBeenReversed = reversalMap.has(entry.id)

              return (
                <div
                  key={entry.id}
                  className={`border rounded-xl p-4 bg-zinc-950 cursor-pointer transition-colors ${isReversal ? 'border-rose-900/40 bg-zinc-950/70' : hasBeenReversed ? 'border-rose-900/30' : 'border-zinc-800'}`}
                  onClick={() => setExpanded(isOpen ? null : entry.id)}
                >
                  <div className="flex justify-between text-sm mb-2 flex-wrap gap-2">
                     <div className="font-medium flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700" title="Journal entry reference">
                          {entry.entryNumber || '—'}
                        </span>
                        <span className={isReversal ? 'line-through text-zinc-500' : ''}>
                          {entry.description || t('untitled')}
                        </span>
                        {isReversal && (
                          <span className="text-[10px] px-1.5 py-px rounded bg-rose-900/40 text-rose-400 border border-rose-800">
                            {t('reversal')}{entry.reversalOfEntryNumber ? ` · ${entry.reversalOfEntryNumber}` : ''}
                          </span>
                        )}
                         {hasBeenReversed && (
                           <span className="text-[10px] px-1.5 py-px rounded bg-rose-900/40 text-rose-400 border border-rose-800">{t('reversed')}</span>
                         )}
                         {(entry.description || '').match(/^Repeat (of|entry)/i) && (
                           <span className="text-[10px] px-1.5 py-px rounded bg-sky-900/40 text-sky-400 border border-sky-800">repeated</span>
                         )}
                          {((entry.attachments?.length || 0) > 0 || entry.sourcePdfPath) && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-px rounded bg-emerald-900/30 text-emerald-400 border border-emerald-800">
                              <Paperclip className="h-3 w-3" /> {entry.attachments?.length || 1}
                            </span>
                          )}
                       </div>
                      <div className="flex items-center gap-3">
                         <div className="text-zinc-500 font-mono text-xs" title="Total debits vs credits">
                           {balanced ? (
                             <span className="text-emerald-400" title="Debits equal credits">✓ Balanced</span>
                           ) : (
                             <span className="text-amber-400" title="Debits do not equal credits">⚠ Unbalanced</span>
                           )}
                         </div>
                         <div className="text-zinc-500 font-mono text-xs">{(typeof entry.date === 'string' ? entry.date : new Date(entry.date).toISOString()).slice(0, 10)}</div>
                         {/* Quick open full ledger for first account of this entry */}
                         {entry.lines[0]?.account?.code && (
                           <button
                             onClick={(e) => {
                               e.stopPropagation()
                               openLedgerForAccount(entry.lines[0].account.code)
                             }}
                             className="text-[10px] px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                           >
                             Open ledger
                           </button>
                         )}
                          {/* Git-model navigation via BooksViewIndicator + ledger; no per-row "view at this commit" button. */}
                      {!isReversal && !hasBeenReversed && (
                        <>
                           <button
                             onClick={async (e) => {
                               e.stopPropagation()
                                // When chat is globally locked, block quick destructive actions from lists too (proposals via chat only)
                                const locked = (typeof window !== 'undefined') && localStorage.getItem('chatLocked') === 'true'
                                if (locked) {
                                  toast.error(t('lockedToast') || 'Chat is locked. Use chat proposals + confirm.')
                                  return
                                }
                                if (!confirm(t('confirmReverse'))) return
                              try {
                                const branch = (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('branch') : null) || 'main'
                                const res = await fetch('/api/journal-entries/reverse', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ originalId: entry.id, branch })
                                })
                                if (!res.ok) throw new Error(await res.text())
                                toast.success(t('reversingSuccess'))
                                window.dispatchEvent(new CustomEvent('journal-updated'))
                               } catch {
                                 toast.error(t('reversingError'))
                               }
                            }}
                            className="text-[10px] px-2 py-0.5 rounded bg-rose-900/30 text-rose-400 hover:bg-rose-900/50 border border-rose-800 active:scale-[0.985]"
                          >
                            {t('reverse')}
                          </button>
                           <button
                             onClick={(e) => {
                               e.stopPropagation()
                                const locked = (typeof window !== 'undefined') && localStorage.getItem('chatLocked') === 'true'
                                if (locked) {
                                  toast.error(t('lockedToast') || 'Chat is locked. Use chat proposals + confirm.')
                                  return
                                }
                               const lines = entry.lines.map(l => ({
                                accountCode: l.account.code,
                                debit: parseFloat(l.debit) || 0,
                                credit: parseFloat(l.credit) || 0,
                                description: l.description || undefined,
                                currency: l.currency || 'EUR',
                                fxRateToBase: l.fxRateToBase ? Number(l.fxRateToBase) : undefined,
                                fxSource: l.fxSource || undefined,
                                fxDate: l.fxDate || undefined,
                                taxRateId: l.taxRate?.id,
                              }))
                              const originalDate = new Date(entry.date).toISOString().slice(0, 10)

                              // Phase 2 reliability: when repeating a foreign-currency entry,
                              // force confirmation so the user re-verifies the (potentially stale) FX rate.
                              const hasForeign = entry.lines.some(l => (l.currency || 'EUR') !== 'EUR')

                              openNewEntry({
                                description: entry.description
                                  ? `Repeat of ${originalDate}: ${entry.description}`
                                  : `Repeat entry from ${originalDate}`,
                                lines: lines,
                                source: 'repeat',
                                originalDate,
                                needsConfirmation: hasForeign,
                              })
                              toast.success(t('repeatEntry') || 'Repeated entry – review and confirm')
                            }}
                            className="text-[10px] px-2 py-0.5 rounded bg-zinc-700 text-white hover:bg-zinc-600"
                            title={t('repeatEntry') || 'Repeat this entry'}
                          >
                            {t('repeat') || 'Repeat'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1 text-sm font-mono">
                    {entry.lines.map(line => (
                      <div key={line.id} className="flex justify-between items-center pl-2 border-l border-zinc-800">
                        <span
                          className="text-zinc-400 cursor-pointer hover:underline"
                          onClick={(ev) => {
                            ev.stopPropagation()
                            // Primary action: open the full dedicated ledger for this account (consistent with AccountsPanel, Reports, etc.)
                            const params = new URLSearchParams()
                            params.set('view', 'ledger')
                            params.set('accountCode', line.account.code)
                            router.push(`/app?${params.toString()}`)
                          }}
                          title={`Open ledger for ${line.account.code}`}
                        >
                            {line.account.code} {line.account.name}
                           {line.taxRate && (
                             <span className="ml-1 text-[10px] px-1 rounded bg-amber-900/30 text-amber-400 border border-amber-800">
                               {line.taxRate.jurisdiction} {(line.taxRate.rate * 100).toFixed(0)}%
                             </span>
                           )}
                            {line.fxRateToBase != null && (
                              <span className={`ml-1 text-[9px] px-1 rounded border ${isAuthoritativeBankFeed(line.fxSource) ? 'bg-emerald-900/30 text-emerald-400 border-emerald-800' : 'bg-amber-900/30 text-amber-400 border-amber-800'}`} title={`${line.fxSource || ''} @ ${line.fxDate || ''}`}>
                                fx {Number(line.fxRateToBase).toFixed(4)}
                                {isAuthoritativeBankFeed(line.fxSource) ? (
                                  <span className="ml-1 text-[8px] text-sky-400">feed</span>
                                ) : (
                                  <span className="ml-1 text-[8px] text-amber-400">provisional</span>
                                )}
                              </span>
                            )}
                         </span>
                            <span>
                              {parseFloat(line.debit) > 0 && (
                                <span className="text-emerald-400">
                                  +{format.number(parseFloat(line.debit), { style: 'currency', currency: (line.currency || 'EUR').toUpperCase() })}
                                  {line.fxRateToBase != null && (
                                    <span className="ml-1 text-[10px] text-emerald-500">→ {format.number(parseFloat(line.debit) * Number(line.fxRateToBase), { style: 'currency', currency: 'EUR' })}</span>
                                  )}
                                </span>
                              )}
                              {parseFloat(line.credit) > 0 && (
                                <span className="text-rose-400">
                                  -{format.number(parseFloat(line.credit), { style: 'currency', currency: (line.currency || 'EUR').toUpperCase() })}
                                  {line.fxRateToBase != null && (
                                    <span className="ml-1 text-[10px] text-rose-500">→ {format.number(parseFloat(line.credit) * Number(line.fxRateToBase), { style: 'currency', currency: 'EUR' })}</span>
                                  )}
                                </span>
                              )}
                            </span>
                      </div>
                    ))}
                  </div>

                  {isOpen && (
                    <div className="mt-4 border-t border-zinc-800 pt-3" onClick={event => event.stopPropagation()}>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Attachments are retained with this entry</span>
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800">
                          <Upload className="h-3 w-3" />
                          {uploadingEntryId === entry.id ? 'Uploading...' : 'Add documents'}
                          <input
                            type="file"
                            multiple
                            accept="application/pdf,image/jpeg,image/png,image/webp,text/csv,.pdf,.jpg,.jpeg,.png,.webp,.csv"
                            className="hidden"
                            disabled={uploadingEntryId === entry.id}
                            onChange={event => { void addAttachments(entry.id, event.target.files); event.target.value = '' }}
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(entry.attachments?.length ? entry.attachments : entry.sourcePdfPath ? [{ id: 'legacy', path: entry.sourcePdfPath, originalName: entry.sourcePdfPath.split('/').pop() || 'attachment', createdAt: '' }] : []).map(attachment => (
                          <a
                            key={attachment.id}
                            href={attachment.path}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex max-w-xs items-center gap-1 rounded border border-emerald-900 bg-emerald-950/20 px-2 py-1 text-[10px] text-emerald-300 hover:bg-emerald-950/50"
                            title={attachment.createdAt ? `Added ${new Date(attachment.createdAt).toLocaleString()}` : 'Legacy attachment'}
                          >
                            <Paperclip className="h-3 w-3 shrink-0" />
                            <span className="truncate">{attachment.originalName}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                   {isOpen && (
                     <div className="mt-3 pt-3 border-t border-zinc-800 text-xs text-zinc-400 space-y-1">
                       <div className="flex justify-between">
                            <div>
                              {t('debitsCredits', { debits: entryDebits.toFixed(2), credits: entryCredits.toFixed(2) })}
                              {entry.lines[0]?.currency && (
                                <span className="ml-2 text-zinc-500">({entry.lines[0].currency})</span>
                              )}
                            </div>
                            <div className="text-zinc-500">{t('clickToCollapse')}</div>
                          </div>

                       {/* FX metadata per line when present */}
                       {entry.lines.some(l => l.fxRateToBase != null) && (
                         <div className="pt-1 space-y-0.5">
                            {entry.lines.filter(l => l.fxRateToBase != null).map(l => {
                              const cleanDate = (l.fxDate || '').split('T')[0] || l.fxDate || 'n/a';
                              return (
                                <div key={l.id} className="text-[10px] text-emerald-400">
                                  fx {Number(l.fxRateToBase).toFixed(6)} via {l.fxSource || 'MANUAL'} on {cleanDate}
                                </div>
                              );
                            })}
                         </div>
                       )}

                         {reversalMap.has(entry.id) && (
                           <div className="text-rose-400">
                             {t('reversedBy', { description: reversalMap.get(entry.id) || '' })}
                           </div>
                         )}

                         {entry.reversalOfEntryNumber && (
                           <div className="text-rose-400">
                             {t('reverses', { ref: entry.reversalOfEntryNumber })}
                           </div>
                         )}

                        {entry.lines.some(l => l.cleared) && (
                          <div className="text-emerald-400">
                            {entry.lines.filter(l => l.cleared).length} line(s) cleared / reconciled
                          </div>
                        )}

                        {entry.createdByUser && (
                          <div className="text-zinc-500">
                            Created by {entry.createdByUser.name || entry.createdByUser.email || entry.createdBy}
                            {entry.updatedAt ? ` · ${new Date(entry.updatedAt).toLocaleString()}` : ''}
                          </div>
                        )}
                     </div>
                   )}
                </div>
              )
            })}
          </div>

          {/* Pagination controls (full journal view only) */}
          {showPagination && (
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
          )}

          {/* Totals footer for visible entries */}
          <div className="mt-4 pt-3 border-t border-zinc-800 flex justify-between text-sm text-zinc-400">
            <div>{t('visible', { count: filteredEntries.length })}</div>
            <div>
              {t('totals', { debits: totalDebits.toFixed(2), credits: totalCredits.toFixed(2) })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
