'use client'

import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import toast from 'react-hot-toast'

interface Schedule {
  id: string
  name: string
  frequency: string
  interval: number
  startDate: string
  nextDueDate: string
  endDate: string | null
  status: string
  autoPost: boolean
  lastGeneratedAt: string | null
  createdBy: string | null
}

export default function RecurringJournalPanel() {
  const t = useTranslations('app.panels.recurringJournal')
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const fetchSchedules = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/recurring-journal-entries')
      const data = await res.json()
      if (Array.isArray(data.schedules)) setSchedules(data.schedules)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchSchedules()
    const handler = () => void fetchSchedules()
    window.addEventListener('journal-updated', handler)
    return () => window.removeEventListener('journal-updated', handler)
  }, [fetchSchedules])

  const setStatus = async (id: string, status: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/recurring-journal-entries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error()
      toast.success(status === 'CANCELLED' ? 'Schedule cancelled' : 'Schedule updated')
      void fetchSchedules()
      window.dispatchEvent(new CustomEvent('journal-updated'))
    } catch {
      toast.error('Update failed')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this recurring schedule? (existing entries remain)')) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/recurring-journal-entries/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Schedule deleted')
      void fetchSchedules()
    } catch {
      toast.error('Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  const generateNow = async () => {
    setBusyId('__generate__')
    try {
      const res = await fetch('/api/recurring-journal-entries/generate', { method: 'POST' })
      const data = await res.json()
      const count = data?.generated ?? 0
      toast.success(count > 0 ? `Generated ${count} entr${count === 1 ? 'y' : 'ies'}` : 'Nothing due right now')
      void fetchSchedules()
      window.dispatchEvent(new CustomEvent('journal-updated'))
    } catch {
      toast.error('Generation failed')
    } finally {
      setBusyId(null)
    }
  }

  const fmtDate = (s?: string | null) => s ? new Date(s).toISOString().slice(0, 10) : '—'

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-zinc-500">{t('title')}</div>
        <button
          onClick={generateNow}
          disabled={busyId === '__generate__'}
          className="text-xs px-2 py-1 rounded bg-emerald-600 text-black hover:bg-emerald-500 disabled:opacity-50"
        >
          {t('generateNow')}
        </button>
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm">Loading…</div>
      ) : schedules.length === 0 ? (
        <div className="text-zinc-500 text-sm">{t('empty')}</div>
      ) : (
        <div className="space-y-2 text-sm">
          {schedules.map(s => (
            <div key={s.id} className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
              <div className="flex items-center justify-between">
                <div className="font-medium">{s.name}</div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  s.status === 'ACTIVE' ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                  : s.status === 'PAUSED' ? 'bg-amber-950 text-amber-400 border-amber-800'
                  : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                }`}>
                  {s.status}
                </span>
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {s.frequency} · every {s.interval} · next {fmtDate(s.nextDueDate)}
                {s.endDate ? ` · ends ${fmtDate(s.endDate)}` : ''}
                {s.autoPost ? ' · auto-post' : ''}
              </div>
              <div className="flex gap-1 mt-2">
                {s.status === 'ACTIVE' ? (
                  <button onClick={() => setStatus(s.id, 'PAUSED')} disabled={busyId === s.id}
                    className="text-xs px-2 py-0.5 rounded bg-amber-950 text-amber-400 hover:bg-amber-900 disabled:opacity-50">
                    Pause
                  </button>
                ) : s.status === 'PAUSED' ? (
                  <button onClick={() => setStatus(s.id, 'ACTIVE')} disabled={busyId === s.id}
                    className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 hover:bg-emerald-900 disabled:opacity-50">
                    Resume
                  </button>
                ) : null}
                <button onClick={() => remove(s.id)} disabled={busyId === s.id}
                  className="text-xs px-2 py-0.5 rounded bg-rose-950 text-rose-400 hover:bg-rose-900 disabled:opacity-50">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
