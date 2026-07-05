'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'

/**
 * Persistent "Current Books View" indicator (Git model).
 * Accountant-friendly header that always tells you what "books" you are looking at.
 * Uses exact Git terms: branch, commit, restore, main.
 */
export default function BooksViewIndicator() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const branch = searchParams?.get('branch') || 'main'
  const asOf = searchParams?.get('asOf') || searchParams?.get('asof')

  const isMainCurrent = branch === 'main' && !asOf
  const isCommitId = asOf && (asOf.length > 20 || /^[0-9a-f-]{8,}$/i.test(asOf))
  const shortCommit = isCommitId && asOf ? asOf.slice(0, 8) : null

  let label = isMainCurrent
    ? 'main (current official books)'
    : `${branch}${asOf ? ` • as of ${asOf}` : ' branch'}`

  if (shortCommit) {
    label = `${branch} • commit ${shortCommit}`
  }

  const goToCurrentMain = () => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.delete('branch')
    params.delete('asOf')
    params.delete('asof')
    // Keep other useful params like view, accountCode, etc.
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="mb-3 flex items-center gap-2 text-xs">
      <span className="text-zinc-500">Viewing:</span>
      <span
        className={`px-2 py-0.5 rounded border font-mono ${
          isMainCurrent
            ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
            : 'bg-zinc-900 text-zinc-300 border-zinc-700'
        }`}
        title={
          isMainCurrent
            ? 'This is the protected main line of truth'
            : shortCommit
            ? 'Viewing a specific commit (like clicking a SHA on GitHub / commits list)'
            : 'Working branch or historical point-in-time view'
        }
      >
        {label}
      </span>

      {!isMainCurrent && (
        <button
          onClick={goToCurrentMain}
          className="text-[10px] px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          title="Return to the current official main books"
        >
          Return to current main
        </button>
      )}

      {!isMainCurrent && !shortCommit && (
        <span className="text-[10px] text-zinc-500">(changes here do not affect main until merged)</span>
      )}
      {shortCommit && (
        <span className="text-[10px] text-emerald-400 font-mono">commit {shortCommit}</span>
      )}

      {(searchParams?.get('view') || '').toLowerCase() !== 'history' && (
        <button
          onClick={() => {
            const params = new URLSearchParams(searchParams?.toString() || '')
            params.set('view', 'history')
            params.delete('accountCode')
            router.push(`/app?${params.toString()}`)
          }}
          className="ml-1 text-[10px] px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
          title="Open full commit history (GitHub-style list of commits)"
        >
          Browse commit history
        </button>
      )}

      {/* Quick tag action for the currently viewed state */}
      <button
        onClick={async () => {
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
            alert(`Tagged "${name}" on current view. It will appear in recent commits.`)
            window.dispatchEvent(new CustomEvent('journal-updated'))
          } catch {
            alert('Failed to create tag')
          }
        }}
        className="text-[10px] px-2 py-0.5 rounded border border-amber-800 text-amber-400 hover:bg-amber-950"
        title="Tag the currently viewed state (like a release / month-end close)"
      >
        Tag this view
      </button>

      {/* Safety + actions when not on current main */}
      {!isMainCurrent && (
        <>
          <span className="text-[10px] text-amber-400">Safe to experiment — changes do not affect main</span>

          {asOf && (
            <button
              onClick={async () => {
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
              }}
              className="text-[10px] px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800 hover:bg-rose-900"
              title="Restore to exactly this viewed commit / point"
            >
              Restore to this
            </button>
          )}

          <button
            onClick={async () => {
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
                router.push(`/app?${p.toString()}`)
              } catch {
                alert('Failed to create branch')
              }
            }}
            className="text-[10px] px-2 py-0.5 rounded border border-emerald-800 text-emerald-400 hover:bg-emerald-950"
            title="Create a safe working branch from exactly this view"
          >
            Branch from here
          </button>

          {/* Prominent "accept work back to main" when on a branch (Git merge flow) */}
          {branch !== 'main' && (
            <button
              onClick={async () => {
                if (!confirm(`Merge "${branch}" into main? This creates a MERGE commit on main.`)) return
                try {
                  await fetch('/api/accounting/branches/merge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source: branch, target: 'main' }),
                  })
                  window.dispatchEvent(new CustomEvent('journal-updated'))
                  // Switch view to main after merge
                  const p = new URLSearchParams(searchParams?.toString() || '')
                  p.delete('branch')
                  p.delete('asOf')
                  p.delete('asof')
                  router.push(`/app?${p.toString()}`)
                } catch {
                  alert('Merge failed')
                }
              }}
              className="text-[10px] px-2 py-0.5 rounded bg-purple-950 text-purple-400 border border-purple-800 hover:bg-purple-900"
              title="Merge the changes from this branch into the official main books (creates MERGE commit)"
            >
              Merge into main
            </button>
          )}
        </>
      )}
    </div>
  )
}
