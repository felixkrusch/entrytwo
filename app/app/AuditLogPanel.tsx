'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

interface AuditEvent {
  id: string
  eventType: string
  entityType: string
  createdAt: string
  description: string | null
  summary: string | null
  createdBy: string
}

 export default function AuditLogPanel() {
  const t = useTranslations('app.panels.audit')
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="mt-8">
      {error && (
        <div className="text-[10px] text-rose-400 mb-2">{error}</div>
      )}
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-zinc-500">{t('title')}</div>
        <div className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{t('events')}</div>
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm">{t('loading')}</div>
      ) : events.length === 0 ? (
        <div className="text-zinc-500 text-sm">{t('empty')}</div>
      ) : (
        <div className="space-y-2 text-xs">
          {events.map(ev => (
            <div key={ev.id} className="border border-zinc-800 rounded-lg p-3 bg-zinc-950">
              <div className="flex justify-between">
                <div>
                  <span className="font-mono text-emerald-400">{ev.eventType}</span>
                  <span className="text-zinc-500 mx-2">•</span>
                  <span>{ev.description || '—'}</span>
                </div>
                <div className="text-zinc-500 font-mono">
                  {new Date(ev.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div className="text-zinc-500 mt-1">
                {ev.summary} • by {ev.createdBy}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
