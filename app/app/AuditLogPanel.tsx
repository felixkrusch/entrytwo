'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'

interface AuditEvent {
  id: string
  eventType: string
  entityType: string
  entityId?: string
  createdAt: string
  description: string | null
  summary: string | null
  createdBy: string
  payload?: {
    description?: string | null
    lines?: unknown[]
    journalEntry?: {
      date?: string
      description?: string
    }
  }
}

export default function AuditLogPanel() {
  const t = useTranslations('app.panels.audit')
  const router = useRouter()
  const searchParams = useSearchParams()
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null)

  // Accountant-friendly filters for the commit history (Git log style)
  const [search, setSearch] = useState('')
  const [onlyGit, setOnlyGit] = useState(false)

  const fetchEvents = () => {
    setLoading(true)
    setError(null)
    fetch('/api/events')
      .then(res => {
        if (!res.ok) throw new Error('Failed to load events')
        return res.json()
      })
      .then(data => {
        if (Array.isArray(data)) setEvents(data)
      })
      .catch((e: unknown) => {
        setError((e as Error)?.message || 'Failed')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchEvents()

    const handler = () => fetchEvents()
    window.addEventListener('journal-updated', handler)
    return () => window.removeEventListener('journal-updated', handler)
  }, [])

  const currentBranchForHistory = searchParams?.get('branch') || 'main'

  const filteredEvents = events.filter(ev => {
    if (onlyGit && !['BRANCH_CREATED', 'MERGE', 'TAG_CREATED', 'ROLLBACK', 'AI_AUTONOMOUS_ENTRY', 'JOURNAL_ENTRY_CREATED', 'JOURNAL_ENTRY_REVERSED'].includes(ev.eventType)) return false
    if (search) {
      const s = search.toLowerCase()
      const hay = `${ev.description || ''} ${ev.eventType} ${ev.createdBy}`.toLowerCase()
      if (!hay.includes(s)) return false
    }
    return true
  })

  // GitHub-style: when user clicks a SHA in the list we already open the modal.
  // The modal has Load + Restore. This keeps the list clean and scannable.

  return (
    <div className="mt-8" data-audit-log>
      {error && (
        <div className="text-[10px] text-rose-400 mb-2">{error}</div>
      )}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-sm font-medium text-zinc-200">Commits</div>
          <div className="text-[10px] text-zinc-500">
            GitHub-style list of every commit. SHA = stable id. Every journal entry + branch/merge/tag/rollback/AI action is a commit.
            <span className="ml-1 text-emerald-400">main</span> = official protected books. Other branches = safe experiments.
            Load = view books at commit. Restore = set as head (new rollback created — you can go back before it).
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter commits…"
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-xs w-48"
          />
          <label className="text-[10px] flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={onlyGit} onChange={e => setOnlyGit(e.target.checked)} /> Git ops
          </label>
          <div className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">on {currentBranchForHistory}</div>
        </div>
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm">{t('loading')}</div>
      ) : events.length === 0 ? (
        <div className="text-zinc-500 text-sm">{t('empty')}</div>
      ) : (
        <div className="space-y-1 text-xs">
          {filteredEvents.length === 0 && (
            <div className="text-zinc-500 px-2 py-1">No commits match the current filter.</div>
          )}
          {filteredEvents.map(ev => {
            const shortSha = ev.id.slice(0, 8)
            const isGitOp = ['BRANCH_CREATED', 'MERGE', 'TAG_CREATED', 'ROLLBACK', 'AI_AUTONOMOUS_ENTRY'].includes(ev.eventType)
            return (
              <div
                key={ev.id}
                className="border border-zinc-800 rounded-lg p-2 bg-zinc-950 hover:bg-zinc-900 transition-colors flex items-start gap-3 group"
              >
                {/* SHA like GitHub */}
                <div
                  className="font-mono text-[10px] text-emerald-400 w-16 shrink-0 pt-0.5 cursor-pointer hover:underline"
                  onClick={() => setSelectedEvent(ev)}
                  title="View this commit (like clicking a SHA)"
                >
                  {shortSha}
                </div>

                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelectedEvent(ev)}>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono ${isGitOp ? 'text-purple-400' : 'text-emerald-400'}`}>{ev.eventType}</span>
                    <span className="text-zinc-400 truncate">{ev.description || ev.summary || '—'}</span>
                  </div>
                  <div className="text-zinc-500 mt-0.5 text-[10px]">
                    {new Date(ev.createdAt).toISOString().replace('T', ' ').slice(0, 16)} • {ev.createdBy}
                  </div>
                </div>

                {/* Direct actions - GitHub style per-row */}
                <div className="flex items-center gap-1 shrink-0 pt-0.5 opacity-80 group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      // LOAD = pinned view at this point (does NOT move head)
                      const params = new URLSearchParams(searchParams?.toString() || '')
                      params.set('asOf', ev.createdAt)
                      if (!params.get('branch')) params.set('branch', 'main')
                      router.push(`/app?${params.toString()}`)
                    }}
                    className="text-[9px] px-1.5 py-0.5 rounded border border-zinc-700 hover:bg-zinc-800"
                    title="Load / view the books at this exact commit (pinned view, does not change current head)"
                  >
                    Load
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation()
                      if (!confirm('Restore branch to this commit? This makes it the CURRENT state of the branch. A new ROLLBACK commit is created. New work will continue from here.')) return
                      try {
                        await fetch('/api/accounting/restore', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ branch: searchParams?.get('branch') || 'main', toEventId: ev.id }),
                        })
                        // After restore we want the DEFAULT view for the branch (no asOf) so head is followed
                        const params = new URLSearchParams(searchParams?.toString() || '')
                        params.set('branch', searchParams?.get('branch') || 'main')
                        params.delete('asOf')
                        params.delete('asof')
                        router.push(`/app?${params.toString()}`)
                        window.dispatchEvent(new CustomEvent('journal-updated'))
                      } catch {
                        alert('Restore failed')
                      }
                    }}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-rose-900/40 text-rose-300 border border-rose-800 hover:bg-rose-900/60"
                    title="RESTORE = make this the current state of the branch (new ROLLBACK commit, head moves)"
                  >
                    Restore
                  </button>
                </div>
              </div>
            )
          })}
        </div>
       )}

      {/* Detail Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setSelectedEvent(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl max-w-2xl w-full p-5 text-white" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold">{selectedEvent.eventType}</h3>
                <div className="text-xs text-zinc-500 mt-1">
                  {new Date(selectedEvent.createdAt).toISOString().replace('T', ' ').slice(0, 19)} • by {selectedEvent.createdBy}
                </div>
              </div>
              <button onClick={() => setSelectedEvent(null)} className="text-zinc-400 hover:text-white">✕</button>
            </div>
            <div className="space-y-3 text-sm max-h-96 overflow-auto">
              <div className="flex items-center gap-2">
                <span className="font-mono text-emerald-400 text-xs">{selectedEvent.id.slice(0, 12)}…</span>
                <span className="text-xs text-zinc-500">— Git commit / event</span>
              </div>

              {selectedEvent.description && (
                <div><span className="text-zinc-400">Message:</span> {selectedEvent.description}</div>
              )}

              {/* Clean commit changes for journal entries (GitHub commit view style) */}
              {selectedEvent.payload?.lines && Array.isArray(selectedEvent.payload.lines) && (
                <div>
                  <div className="text-zinc-400 mb-1 text-xs font-medium">Changes in this commit:</div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded p-2 text-xs space-y-1 font-mono">
                    {(selectedEvent.payload.lines as any[]).map((line: any, idx: number) => {
                      const acct = typeof line.account === 'string' ? line.account : (line.account?.code || line.accountCode || '?')
                      const d = Number(line.debit || 0)
                      const c = Number(line.credit || 0)
                      return (
                        <div key={idx} className="flex justify-between">
                          <span>{acct}</span>
                          <span>
                            {d > 0 && <span className="text-emerald-400">+{d}</span>}
                            {c > 0 && <span className="text-rose-400">-{c}</span>}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {selectedEvent.payload?.journalEntry && (
                <div>
                  <div className="text-zinc-400 mb-1 text-xs">Journal metadata:</div>
                  <pre className="bg-zinc-950 p-2 rounded text-xs overflow-x-auto border border-zinc-800">{JSON.stringify(selectedEvent.payload.journalEntry, null, 2)}</pre>
                </div>
              )}

              {selectedEvent.entityId && (
                <div className="text-xs"><span className="text-zinc-400">Entity:</span> <span className="font-mono">{selectedEvent.entityId}</span></div>
              )}

              {/* GitHub-style commit actions */}
              <div className="pt-2 border-t border-zinc-800 flex flex-wrap gap-2 items-center">
                <button
                  onClick={() => {
                    const params = new URLSearchParams(searchParams?.toString() || '')
                    params.set('asOf', selectedEvent.createdAt)
                    if (!params.get('branch')) params.set('branch', 'main')
                    router.push(`/app?${params.toString()}`)
                    setSelectedEvent(null)
                  }}
                  className="text-xs px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800"
                >
                  Load this commit (view books at SHA)
                </button>

                <button
                  onClick={async () => {
                    if (!confirm('RESTORE: Make this the CURRENT state of the branch? Creates ROLLBACK. New work will continue from here on the official books.')) return
                    try {
                      await fetch('/api/accounting/restore', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ branch: searchParams?.get('branch') || 'main', toEventId: selectedEvent.id }),
                      })
                      // Go to clean branch view (no asOf) so default reads follow the new head
                      const params = new URLSearchParams(searchParams?.toString() || '')
                      params.set('branch', searchParams?.get('branch') || 'main')
                      params.delete('asOf')
                      params.delete('asof')
                      router.push(`/app?${params.toString()}`)
                      window.dispatchEvent(new CustomEvent('journal-updated'))
                      setSelectedEvent(null)
                    } catch {
                      alert('Restore failed')
                    }
                  }}
                  className="text-xs px-2 py-1 rounded bg-rose-900/50 text-rose-200 border border-rose-800 hover:bg-rose-900"
                >
                  Restore to this commit (make current)
                </button>

                <button
                  onClick={async () => {
                    const name = prompt('Create branch from this commit. Name:')
                    if (!name) return
                    try {
                      await fetch('/api/accounting/branches', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: name.trim(), fromEventId: selectedEvent.id }),
                      })
                      const p = new URLSearchParams(searchParams?.toString() || '')
                      p.set('branch', name.trim())
                      p.set('asOf', selectedEvent.createdAt)
                      router.push(`/app?${p.toString()}`)
                      setSelectedEvent(null)
                    } catch {
                      alert('Failed to create branch')
                    }
                  }}
                  className="text-xs px-2 py-1 rounded border border-emerald-800 text-emerald-400 hover:bg-emerald-950"
                  title="Create a safe working branch from exactly this commit (recommended before experiments)"
                >
                  Branch from here
                </button>

                <span className="text-[10px] text-zinc-500">Like GitHub: every action is a full commit with SHA. History is never lost or rewritten.</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
