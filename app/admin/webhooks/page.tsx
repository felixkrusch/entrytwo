'use client'

import { useTranslations } from 'next-intl'

import { useEffect, useState, useTransition } from 'react'
import { RefreshCw } from 'lucide-react'

type WebhookEvent = { id: string; provider: string; externalId: string; eventType: string; status: string; attempts: number; lastError: string | null; createdAt: string }
type Job = { id: string; idempotencyKey: string; status: string; attempts: number; lastError: string | null }

export default function WebhookEventsPage() {
  const t = useTranslations('app.adminPages')

  const [events, setEvents] = useState<WebhookEvent[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  const load = async () => {
    const response = await fetch('/api/admin/webhooks', { cache: 'no-store' })
    if (!response.ok) throw new Error('Could not load webhook events')
    const data = await response.json()
    setEvents(data.events)
    setJobs(data.jobs)
  }

  useEffect(() => { void load().catch(value => setError(value.message)) }, [])

  const retry = (jobId: string) => startTransition(async () => {
    setError('')
    const response = await fetch(`/api/admin/jobs/${jobId}/retry`, { method: 'POST' })
    const data = await response.json()
    if (!response.ok) { setError(data.error || 'Retry failed'); return }
    await load()
  })

  const jobFor = (event: WebhookEvent) => jobs.find(job => job.idempotencyKey === `webhook:${event.provider}:${event.externalId}`)

  return <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-semibold">Webhook deliveries</h1>
      <p className="mt-1 text-sm text-zinc-500">Verified Stripe and PayPal events, processing failures, and durable retries.</p>
    </div>
    {error && <div className="rounded-lg border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-500"><tr>
            <th className="px-4 py-3">Provider</th><th className="px-4 py-3">Event</th><th className="px-4 py-3">State</th>
            <th className="px-4 py-3">Attempts</th><th className="px-4 py-3">Received</th><th className="px-4 py-3">Failure</th><th className="px-4 py-3 text-right">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-zinc-900">
            {events.map(event => {
              const job = jobFor(event)
              const failed = event.status === 'FAILED' || job?.status === 'DEAD_LETTER' || job?.status === 'RETRY'
              return <tr key={event.id} className="align-top hover:bg-zinc-900/30">
                <td className="px-4 py-3 font-medium capitalize">{event.provider}</td><td className="px-4 py-3 font-mono text-xs text-zinc-300">{event.eventType}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${failed ? 'bg-red-950 text-red-300' : event.status === 'SUCCEEDED' ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'}`}>{job?.status || event.status}</span></td>
                <td className="px-4 py-3 text-zinc-400">{job?.attempts ?? event.attempts}</td><td className="px-4 py-3 whitespace-nowrap text-zinc-400">{new Date(event.createdAt).toLocaleString()}</td>
                <td className="max-w-xs px-4 py-3 text-xs text-red-300">{job?.lastError || event.lastError || '-'}</td>
                <td className="px-4 py-3 text-right">{failed && job && <button disabled={isPending} onClick={() => retry(job.id)} className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-50"><RefreshCw className="size-3" /> Retry</button>}</td>
              </tr>
            })}
            {!events.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-zinc-500">No verified webhook deliveries yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  </div>
}
