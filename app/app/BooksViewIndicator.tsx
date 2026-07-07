'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'

/**
 * Persistent "Current Books View" indicator (Git model).
 * One bar, three states:
 *   - main-current : on the protected official books
 *   - branch       : on a working branch (off main) — visually distinct WARNING
 *   - past-commit  : pinned to a specific historical commit — visually distinct WARNING
 * Uses exact Git terms: branch, commit, restore, main.
 */
interface LastCommit {
  id: string
  description?: string | null
  createdAt?: string
  eventType?: string
  createdBy?: string | null
}

export default function BooksViewIndicator() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const branch = searchParams?.get('branch') || 'main'
  const asOf = searchParams?.get('asOf') || searchParams?.get('asof')

  const isMainCurrent = branch === 'main' && !asOf
  const isCommitId = asOf && (asOf.length > 20 || /^[0-9a-f-]{8,}$/i.test(asOf))
  const shortCommit = isCommitId && asOf ? asOf.slice(0, 8) : null
  const offMain = !isMainCurrent

  const [lastCommit, setLastCommit] = useState<LastCommit | null>(null)

  useEffect(() => {
    let mounted = true
    const u = new URLSearchParams()
    if (branch && branch !== 'main') u.set('branch', branch)
    if (asOf) u.set('asOf', asOf)
    fetch(`/api/events${u.toString() ? `?${u.toString()}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (mounted && Array.isArray(d) && d.length > 0) setLastCommit(d[0])
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [branch, asOf])

  const goToCurrentMain = () => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.delete('branch')
    params.delete('asOf')
    params.delete('asof')
    router.push(`${pathname}?${params.toString()}`)
  }

  const tagThisView = async () => {
    const name = prompt('Tag name (e.g. june-close, auditor-snapshot):')
    if (!name) return
    try {
      await fetch('/api/accounting/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          branch,
          eventId: asOf && asOf.length > 20 ? asOf : undefined,
        }),
      })
      alert(`Tagged "${name}" on current view.`)
      window.dispatchEvent(new CustomEvent('journal-updated'))
    } catch {
      alert('Failed to create tag')
    }
  }

  const restoreToThis = async () => {
    if (!confirm('Restore branch head to this exact point? This creates a new ROLLBACK commit. History is preserved and you can go back further.')) return
    try {
      await fetch('/api/accounting/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch, toEventId: asOf }),
      })
      window.dispatchEvent(new CustomEvent('journal-updated'))
    } catch {
      alert('Restore failed')
    }
  }

  const branchFromHere = async () => {
    const name = prompt('Branch name from current view:')
    if (!name) return
    try {
      await fetch('/api/accounting/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          fromEventId: asOf && asOf.length > 20 ? asOf : undefined,
        }),
      })
      const p = new URLSearchParams(searchParams?.toString() || '')
      p.set('branch', name.trim())
      p.delete('asOf')
      p.delete('asof')
      router.push(`/app?${p.toString()}`)
    } catch {
      alert('Failed to create branch')
    }
  }

  let label: string
  if (isMainCurrent) label = 'main (current official books)'
  else if (shortCommit) label = `${branch} • commit ${shortCommit}`
  else label = `${branch}${asOf ? ` • as of ${asOf}` : ' branch'}`

  const lastCommitLabel = lastCommit
    ? `${(lastCommit.description || lastCommit.eventType || 'commit').toString().slice(0, 40)} · ${new Date(lastCommit.createdAt || '').toLocaleDateString()}`
    : null

  return (
    <div
      className={`mb-3 rounded-lg border px-3 py-2 text-xs flex flex-wrap items-center gap-2 ${
        isMainCurrent
          ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
          : 'border-amber-700 bg-amber-950/40 text-amber-200'
      }`}
    >
      <span className="font-medium">Viewing:</span>
      <span className="px-2 py-0.5 rounded border font-mono border-current">{label}</span>

      {offMain && (
        <span className="text-amber-300">⚠ Not official main — changes here do not affect main until merged.</span>
      )}
      {offMain && (
        <button
          onClick={goToCurrentMain}
          className="text-[10px] px-2 py-0.5 rounded border border-zinc-600 text-zinc-200 hover:bg-zinc-800"
        >
          Return to current main
        </button>
      )}

      {lastCommitLabel && (
        <span className="text-zinc-400" title="Most recent commit in this view">
          last: {lastCommitLabel}
        </span>
      )}

      {(searchParams?.get('view') || '').toLowerCase() !== 'history' && (
        <button
          onClick={() => {
            const params = new URLSearchParams(searchParams?.toString() || '')
            params.set('view', 'history')
            params.delete('accountCode')
            router.push(`/app?${params.toString()}`)
          }}
          className="text-[10px] px-2 py-0.5 rounded border border-zinc-600 text-zinc-200 hover:bg-zinc-800"
        >
          Browse commit history
        </button>
      )}

      <button
        onClick={tagThisView}
        className="text-[10px] px-2 py-0.5 rounded border border-amber-700 text-amber-200 hover:bg-amber-900"
      >
        Tag this view
      </button>

      {asOf && shortCommit && (
        <>
          <button
            onClick={restoreToThis}
            className="text-[10px] px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 hover:bg-rose-900"
          >
            Restore to this
          </button>
          <button
            onClick={branchFromHere}
            className="text-[10px] px-2 py-0.5 rounded border border-emerald-800 text-emerald-300 hover:bg-emerald-950"
          >
            Branch from here
          </button>
        </>
      )}
    </div>
  )
}
