'use client'

import { useEffect, useState } from 'react'
import { useNewEntry } from './NewEntryContext'
import toast from 'react-hot-toast'
import { useTranslations, useFormatter } from 'next-intl'

interface JournalLine {
  id: string
  debit: string
  credit: string
  account: { code: string; name: string }
  taxRate?: {
    id: string
    jurisdiction: string
    name: string
    rate: number
    taxType: string
    isInputTax: boolean
  } | null
  currency?: string
}

interface JournalEntry {
  id: string
  date: string
  description: string | null
  lines: JournalLine[]
}

interface JournalEntriesPanelProps {
  filterAccountId?: string
}

export default function JournalEntriesPanel({ filterAccountId }: JournalEntriesPanelProps) {
  const { openNewEntry } = useNewEntry()
  const t = useTranslations('app.panels.journal')
  const format = useFormatter()

  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [reversedMap, setReversedMap] = useState<Map<string, string>>(new Map()) // originalId -> reversal description
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchEntries = () => {
    fetch('/api/journal-entries')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setEntries(data)
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }

  const fetchReversals = () => {
    fetch('/api/events')
      .then(res => res.json())
      .then((events: any[]) => {
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
    fetchEntries()
    fetchReversals()

    const handler = () => {
      fetchEntries()
      fetchReversals()
    }
    window.addEventListener('journal-updated', handler)
    return () => window.removeEventListener('journal-updated', handler)
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

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-zinc-500">
          {t('title')} {filterAccountId && t('filtered')}
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
        </div>
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm">{t('loading')}</div>
      ) : filteredEntries.length === 0 ? (
        <div className="text-zinc-500 text-sm">
          {t('empty', { filter: filterAccountId ? t('emptyFilter') : '' })}
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {filteredEntries.map(entry => {
              const isOpen = expanded === entry.id
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
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-zinc-500 font-mono text-xs">{new Date(entry.date).toISOString().split('T')[0]}</div>
                      {!isReversal && !hasBeenReversed && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation()
                            if (!confirm(t('confirmReverse'))) return
                            try {
                              const res = await fetch('/api/journal-entries/reverse', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ originalId: entry.id })
                              })
                              if (!res.ok) throw new Error(await res.text())
                              toast.success(t('reversingSuccess'))
                              window.dispatchEvent(new CustomEvent('journal-updated'))
                            } catch (err) {
                              toast.error(t('reversingError'))
                            }
                          }}
                          className="text-[10px] px-2 py-0.5 rounded bg-rose-900/30 text-rose-400 hover:bg-rose-900/50 border border-rose-800 active:scale-[0.985]"
                        >
                          {t('reverse')}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1 text-sm font-mono">
                    {entry.lines.map(line => (
                      <div key={line.id} className="flex justify-between items-center pl-2 border-l border-zinc-800">
                        <span className="text-zinc-400">
                          {line.account.code} {line.account.name}
                          {line.taxRate && (
                            <span className="ml-1 text-[10px] px-1 rounded bg-amber-900/30 text-amber-400 border border-amber-800">
                              {line.taxRate.jurisdiction} {(line.taxRate.rate * 100).toFixed(0)}%
                            </span>
                          )}
                        </span>
                          <span>
                            {parseFloat(line.debit) > 0 && <span className="text-emerald-400">+{format.number(parseFloat(line.debit), { style: 'currency', currency: 'EUR' })}</span>}
                            {parseFloat(line.credit) > 0 && <span className="text-rose-400">-{format.number(parseFloat(line.credit), { style: 'currency', currency: 'EUR' })}</span>}
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
