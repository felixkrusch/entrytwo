'use client'

import { useEffect, useState } from 'react'
import { useNewEntry } from './NewEntryContext'
import toast from 'react-hot-toast'
import { useTranslations, useFormatter } from 'next-intl'
import { useRouter } from 'next/navigation'

interface JournalLine {
  id: string
  debit: string
  credit: string
  description?: string | null   // line-level note (returned by API)
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
  lines: JournalLine[]
}

export interface JournalEntriesPanelProps {
  filterAccountId?: string
  branch?: string
  asOf?: string
}

export default function JournalEntriesPanel({ filterAccountId, branch = 'main', asOf }: JournalEntriesPanelProps) {
  const { openNewEntry } = useNewEntry()
  const t = useTranslations('app.panels.journal')
  const format = useFormatter()

  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [reversedMap, setReversedMap] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandAll, setExpandAll] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchEntries = () => {
    const params = new URLSearchParams()
    if (filterAccountId) params.set('accountCode', filterAccountId)
    if (branch) params.set('branch', branch)
    if (asOf) params.set('asOf', asOf)

    fetch(`/api/journal-entries?${params.toString()}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load journal')
        return res.json()
      })
      .then(data => {
        if (Array.isArray(data)) setEntries(data)
        else if (data && Array.isArray(data.entries)) setEntries(data.entries)
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
  }, [])

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
            className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-400"
            title="Refresh journal"
          >
            ↻
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
              const isReversal = entry.description?.startsWith('Reversal of')
              const hasBeenReversed = reversalMap.has(entry.id)

              return (
                <div
                  key={entry.id}
                  className={`border rounded-xl p-4 bg-zinc-950 cursor-pointer transition-colors ${isReversal ? 'border-rose-900/40 bg-zinc-950/70' : 'border-zinc-800'}`}
                  onClick={() => setExpanded(isOpen ? null : entry.id)}
                >
                  <div className="flex justify-between text-sm mb-2">
                    <div className="font-medium flex items-center gap-2">
                      {entry.description || t('untitled')}
                      {isReversal && (
                        <span className="text-[10px] px-1.5 py-px rounded bg-rose-900/40 text-rose-400 border border-rose-800">{t('reversal')}</span>
                      )}
                       {hasBeenReversed && (
                         <span className="text-[10px] px-1.5 py-px rounded bg-rose-900/40 text-rose-400 border border-rose-800">{t('reversed')}</span>
                       )}
                       {(entry.description || '').match(/^Repeat (of|entry)/i) && (
                         <span className="text-[10px] px-1.5 py-px rounded bg-sky-900/40 text-sky-400 border border-sky-800">repeated</span>
                       )}
                     </div>
                     <div className="flex items-center gap-3">
                       <div className="text-zinc-500 font-mono text-xs">{new Date(entry.date).toISOString().split('T')[0]}</div>
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
                        {/* Git-model: view this journal entry as a commit point (like clicking a SHA) */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            const p = new URLSearchParams()
                            p.set('view', 'ledger')
                            p.set('accountCode', entry.lines[0]?.account?.code || '')
                            p.set('asOf', entry.date)
                            router.push(`/app?${p.toString()}`)
                          }}
                          className="text-[10px] px-2 py-0.5 rounded border border-emerald-800 text-emerald-400 hover:bg-emerald-950"
                          title="Load books exactly at this journal entry (commit)"
                        >
                          View at this commit
                        </button>
                      {!isReversal && !hasBeenReversed && (
                        <>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation()
                              // Respect chat lock (advisory mode)
                              if (typeof window !== 'undefined' && localStorage.getItem('chatLocked') === 'true') {
                                toast.error(t('lockedToast') || 'Chat is locked (advisory mode).')
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
                              // Respect chat lock (advisory mode)
                              if (typeof window !== 'undefined' && localStorage.getItem('chatLocked') === 'true') {
                                toast.error(t('lockedToast') || 'Chat is locked (advisory mode).')
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
                           window.dispatchEvent(new CustomEvent('filter-by-account', { detail: { code: line.account.code } }))
                         }}
                         title={`Filter to ${line.account.code}`}
                       >
                           {line.account.code} {line.account.name}
                          {line.taxRate && (
                            <span className="ml-1 text-[10px] px-1 rounded bg-amber-900/30 text-amber-400 border border-amber-800">
                              {line.taxRate.jurisdiction} {(line.taxRate.rate * 100).toFixed(0)}%
                            </span>
                          )}
                          {line.fxRateToBase != null && (
                            <span className="ml-1 text-[9px] px-1 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-800" title={`${line.fxSource || 'feed'} @ ${line.fxDate || ''}`}>
                              fx {Number(line.fxRateToBase).toFixed(4)}
                            </span>
                          )}
                          {(line.fxSource || '').toUpperCase().startsWith('BANK_FEED') && (
                            <span className="ml-1 text-[9px] px-1 rounded bg-sky-900/30 text-sky-400 border border-sky-800">feed</span>
                          )}
                        </span>
                          <span>
                            {parseFloat(line.debit) > 0 && (
                              <span className="text-emerald-400">
                                +{format.number(parseFloat(line.debit), { style: 'currency', currency: 'EUR' })}
                                {line.fxRateToBase != null && (
                                  <span className="ml-1 text-[10px] text-emerald-500">→ {format.number(parseFloat(line.debit) * Number(line.fxRateToBase), { style: 'currency', currency: 'EUR' })}</span>
                                )}
                              </span>
                            )}
                            {parseFloat(line.credit) > 0 && (
                              <span className="text-rose-400">
                                -{format.number(parseFloat(line.credit), { style: 'currency', currency: 'EUR' })}
                                {line.fxRateToBase != null && (
                                  <span className="ml-1 text-[10px] text-rose-500">→ {format.number(parseFloat(line.credit) * Number(line.fxRateToBase), { style: 'currency', currency: 'EUR' })}</span>
                                )}
                              </span>
                            )}
                            {line.currency && line.currency !== 'EUR' && (
                              <span className="ml-1 text-[10px] text-zinc-500">({line.currency})</span>
                            )}
                          </span>
                      </div>
                    ))}
                  </div>

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
                           {entry.lines.filter(l => l.fxRateToBase != null).map(l => (
                             <div key={l.id} className="text-[10px] text-emerald-400">
                               fx {Number(l.fxRateToBase).toFixed(6)} via {l.fxSource || 'feed'} on {l.fxDate || 'n/a'}
                             </div>
                           ))}
                         </div>
                       )}

                       {reversalMap.has(entry.id) && (
                         <div className="text-rose-400">
                           {t('reversedBy').replace('{description}', reversalMap.get(entry.id) || '')}
                         </div>
                       )}
                     </div>
                   )}
                </div>
              )
            })}
          </div>

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
