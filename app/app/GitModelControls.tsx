'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface Branch {
  id: string
  name: string
  isMain: boolean
  description?: string | null
}

interface Tag {
  id: string
  name: string
  branch: string
  eventId?: string
  description?: string
}

interface DiffChange { accountCode: string; accountName?: string; net: number }
interface BlameEntry { eventId: string; createdAt: string; delta: number; description?: string }

export default function GitModelControls() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [branches, setBranches] = useState<Branch[]>([])
  const [currentBranch, setCurrentBranch] = useState(searchParams?.get('branch') || 'main')
  const [asOf, setAsOf] = useState(searchParams?.get('asOf') || '')
  const [showCreate, setShowCreate] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [reconcileAccount, setReconcileAccount] = useState('1100')
  const [mergeSource, setMergeSource] = useState('')
  const [mergeTarget, setMergeTarget] = useState('main')
  const [tags, setTags] = useState<Tag[]>([])
  const [newTagName, setNewTagName] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [diffResult, setDiffResult] = useState<{ changes: DiffChange[] } | null>(null)
  const [blameResult, setBlameResult] = useState<BlameEntry[] | null>(null)
  const [loading, setLoading] = useState(false)

  // Recent commits + tags for accountant-friendly "recent states" picker (GitHub commits + tags)
  interface RecentCommit {
    id: string
    createdAt: string
    description?: string | null
    eventType?: string
    isTag?: boolean
  }
  const [recentCommits, setRecentCommits] = useState<RecentCommit[]>([])

  const refreshBranches = async () => {
    try {
      const res = await fetch('/api/accounting/branches')
      const data = await res.json()
      if (Array.isArray(data)) setBranches(data)
    } catch {}
  }

  const refreshTags = async () => {
    try {
      const res = await fetch(`/api/accounting/tags?branch=${currentBranch}`)
      const data = await res.json()
      if (Array.isArray(data)) setTags(data)
    } catch {}
  }

  const refreshRecent = async () => {
    try {
      const [evRes, tagRes] = await Promise.all([
        fetch('/api/events'),
        fetch(`/api/accounting/tags?branch=${currentBranch}`),
      ])
      const evData = await evRes.json()
      const tagData = await tagRes.json()

      const mappedEvents = Array.isArray(evData)
        ? evData.slice(0, 6).map((e: any) => ({
            id: e.id,
            createdAt: e.createdAt,
            description: e.description,
            eventType: e.eventType,
          }))
        : []

      const mappedTags = Array.isArray(tagData)
        ? tagData.slice(0, 4).map((t: any) => ({
            id: t.eventId || t.id,
            createdAt: t.createdAt || new Date().toISOString(),
            description: `Tag: ${t.name}`,
            eventType: 'TAG',
            isTag: true,
          }))
        : []

      // Merge and sort most recent first
      const combined = [...mappedEvents, ...mappedTags]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10)

      setRecentCommits(combined)
    } catch {}
  }

  useEffect(() => {
    void refreshBranches()
    void refreshTags()
    void refreshRecent()
  }, [currentBranch])

  // Refresh recent commits when journal or git actions happen
  useEffect(() => {
    const handler = () => void refreshRecent()
    window.addEventListener('journal-updated', handler)
    return () => window.removeEventListener('journal-updated', handler)
  }, [])

  const updateUrl = (branch: string, asOfVal?: string) => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.set('branch', branch)
    if (asOfVal) params.set('asOf', asOfVal)
    else params.delete('asOf')
    router.push(`/app?${params.toString()}`)
    setCurrentBranch(branch)
    setAsOf(asOfVal || '')
  }

  const createBranch = async () => {
    if (!newBranchName.trim()) return
    setLoading(true)
    try {
      await fetch('/api/accounting/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newBranchName.trim() }),
      })
      await refreshBranches()
      updateUrl(newBranchName.trim())
      setNewBranchName('')
      setShowCreate(false)
    } finally {
      setLoading(false)
    }
  }

  const runReconcile = async () => {
    setLoading(true)
    try {
      await fetch('/api/accounting/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountCode: reconcileAccount }),
      })
      window.dispatchEvent(new CustomEvent('journal-updated'))
      const params = new URLSearchParams()
      params.set('view', 'ledger')
      params.set('accountCode', reconcileAccount)
      if (currentBranch !== 'main') params.set('branch', currentBranch)
      if (asOf) params.set('asOf', asOf)
      router.push(`/app?${params.toString()}`)
    } finally {
      setLoading(false)
    }
  }

  const doRestore = async (confirmed = false) => {
    if (!asOf) return alert('Enter an asOf date or event id to restore to')
    setLoading(true)
    try {
      if (!confirmed) {
        // Preview first
        const pRes = await fetch(`/api/accounting/restore/preview?branch=${currentBranch}&asOf=${encodeURIComponent(asOf)}`)
        const pData = await pRes.json()
        setPreview(pData)
        return
      }
      const target = preview?.toEventId || asOf
      await fetch('/api/accounting/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: currentBranch, toEventId: target }),
      })
      // After restore, clear asOf so default view follows the *new head* of the branch.
      // This is what makes "current official books" actually change.
      const params = new URLSearchParams(searchParams?.toString() || '')
      params.set('branch', currentBranch)
      params.delete('asOf')
      params.delete('asof')
      router.push(`/app?${params.toString()}`)
      window.dispatchEvent(new CustomEvent('journal-updated'))
      setPreview(null)
      alert('Restore applied — current state of the branch is now at that point. New work will continue from here.')
    } finally {
      setLoading(false)
    }
  }

  const doMerge = async () => {
    if (!mergeSource) return alert('Select source branch to merge')
    setLoading(true)
    try {
      await fetch('/api/accounting/branches/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: mergeSource, target: mergeTarget || 'main' }),
      })
      window.dispatchEvent(new CustomEvent('journal-updated'))
      await refreshBranches()
      alert(`Merged ${mergeSource} into ${mergeTarget || 'main'}`)
    } finally {
      setLoading(false)
    }
  }

  const createTag = async () => {
    if (!newTagName.trim()) return
    setLoading(true)
    try {
      await fetch('/api/accounting/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTagName.trim(), branch: currentBranch }),
      })
      setNewTagName('')
      await refreshTags()
    } finally {
      setLoading(false)
    }
  }

  const runDiff = async () => {
    // Use two recent events on current branch for demo diff (or require explicit ids)
    // For practicality: diff from earliest known to head
    setLoading(true)
    try {
      const eventsRes = await fetch('/api/events?limit=5')
      const evs = await eventsRes.json()
      if (!Array.isArray(evs) || evs.length < 2) {
        alert('Need at least two events for diff')
        return
      }
      const from = evs[evs.length - 1].id
      const to = evs[0].id
      const dRes = await fetch(`/api/accounting/diff?from=${from}&to=${to}`)
      const d = await dRes.json()
      setDiffResult(d)
      setBlameResult(null)
    } finally {
      setLoading(false)
    }
  }

  const runBlame = async () => {
    setLoading(true)
    try {
      const bRes = await fetch(`/api/accounting/blame?accountCode=${reconcileAccount}${asOf ? `&asOf=${encodeURIComponent(asOf)}` : ''}`)
      const b = await bRes.json()
      setBlameResult(Array.isArray(b) ? b : [])
      setDiffResult(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mb-4 p-3 border border-zinc-800 rounded-xl bg-zinc-950 text-sm">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="text-xs text-zinc-500">Git Model</div>

        <select
          value={currentBranch}
          onChange={e => updateUrl(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-xs"
          title="Switch view: main is the official protected books. Other branches are safe working areas or AI experiments."
        >
          {branches.map(b => (
            <option key={b.id} value={b.name}>
              {b.name} {b.isMain ? '— official books (main)' : '— working branch'}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={asOf}
          onChange={e => setAsOf(e.target.value)}
          placeholder="asOf (date or event id)"
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-xs w-48"
        />

        <button
          onClick={() => updateUrl(currentBranch, asOf || undefined)}
          className="text-xs px-2 py-0.5 rounded border border-zinc-700 hover:bg-zinc-800"
        >
          Apply point-in-time
        </button>

        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800"
        >
          + Branch
        </button>

        {/* Accountant-friendly Recent Commits picker (GitHub commits list + v0.app dropdown) */}
        {recentCommits.length > 0 && (
          <div className="flex items-center gap-1">
            <select
              value=""
              onChange={(e) => {
                const val = e.target.value
                if (!val) return
                const [evId, evDate] = val.split('|')
                const point = evDate || evId
                updateUrl(currentBranch, point)
              }}
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-xs max-w-[260px]"
              title="Browse recent commits (GitHub style). Select to view the books exactly at that commit."
            >
              <option value="">Recent commits…</option>
               {recentCommits.map((c, index) => {
                const d = new Date(c.createdAt)
                const short = d.toISOString().slice(0, 16).replace('T', ' ')
                const prefix = c.isTag ? '🏷 ' : ''
                const desc = (c.description || c.eventType || 'commit').slice(0, 28)
                // Always include index to guarantee unique React keys (tags may reuse event ids)
                // Make key unique even if multiple items share the same event id (e.g. a tag pointing at the same commit)
                const uniqueKey = `recent-${index}-${c.id}`
                return (
                  <option key={uniqueKey} value={`${c.id}|${d.toISOString()}`}>
                    {short} · {prefix}{desc}
                  </option>
                )
              })}
            </select>

            {/* When a specific commit/point is loaded (pinned asOf), offer restore (moves head) + branch from here */}
            {asOf && (
              <>
                <button
                  onClick={async () => {
                    if (!confirm('RESTORE: Make this point the CURRENT state of the branch? A new ROLLBACK commit is created. The default view will then follow this state.')) return
                    setLoading(true)
                    try {
                      await fetch('/api/accounting/restore', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ branch: currentBranch, toEventId: asOf }),
                      })
                      // Clear asOf so default view now follows the new head
                      const p = new URLSearchParams(searchParams?.toString() || '')
                      p.set('branch', currentBranch)
                      p.delete('asOf')
                      p.delete('asof')
                      router.push(`/app?${p.toString()}`)
                      window.dispatchEvent(new CustomEvent('journal-updated'))
                    } finally {
                      setLoading(false)
                    }
                  }}
                  disabled={loading}
                  className="text-[10px] px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800"
                  title="Restore the branch head to the currently viewed point and make it current (new ROLLBACK commit)"
                >
                  Restore this (make current)
                </button>

                <button
                  onClick={async () => {
                    const name = prompt('Branch name (e.g. what-if-june, ai-experiment):')
                    if (!name) return
                    setLoading(true)
                    try {
                      await fetch('/api/accounting/branches', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: name.trim(), fromEventId: asOf }),
                      })
                      await refreshBranches()
                      // Branch from the pinned point but start viewing the new branch at its head (no asOf)
                      const p = new URLSearchParams(searchParams?.toString() || '')
                      p.set('branch', name.trim())
                      p.delete('asOf')
                      p.delete('asof')
                      router.push(`/app?${p.toString()}`)
                    } finally {
                      setLoading(false)
                    }
                  }}
                  disabled={loading}
                  className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800"
                  title="Create a safe working branch from this exact commit"
                >
                  Branch from here
                </button>
              </>
            )}

            {/* Quick restore to most recent (top of list) */}
            <button
              onClick={async () => {
                if (!recentCommits[0]) return
                const latest = recentCommits[0]
                if (!confirm(`RESTORE to most recent? This will make the current state of the branch the latest commit. Creates ROLLBACK. New work continues from there.`)) return
                setLoading(true)
                try {
                  await fetch('/api/accounting/restore', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ branch: currentBranch, toEventId: latest.id }),
                  })
                  // Clear asOf so default view follows the new head
                  const p = new URLSearchParams(searchParams?.toString() || '')
                  p.set('branch', currentBranch)
                  p.delete('asOf')
                  p.delete('asof')
                  router.push(`/app?${p.toString()}`)
                  window.dispatchEvent(new CustomEvent('journal-updated'))
                } finally {
                  setLoading(false)
                }
              }}
              disabled={loading}
              className="text-[10px] px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800"
              title="Restore to the most recent commit (like git reset, full history kept)"
            >
              Restore latest
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 ml-2">
          <input
            value={reconcileAccount}
            onChange={e => setReconcileAccount(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-xs w-16"
          />
          <button
            onClick={runReconcile}
            disabled={loading}
            className="text-xs px-3 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-800"
          >
            Reconcile
          </button>
        </div>

        <button
          onClick={() => doRestore(false)}
          disabled={loading || !asOf}
          className="text-xs px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800"
        >
          Preview Restore
        </button>
        {preview && (
          <button
            onClick={() => doRestore(true)}
            disabled={loading}
            className="text-xs px-2 py-0.5 rounded bg-rose-600 text-white"
          >
            Confirm Restore (creates ROLLBACK commit)
          </button>
        )}

        <button onClick={runDiff} disabled={loading} className="text-xs px-2 py-0.5 rounded border border-zinc-700">Diff</button>
        <button onClick={runBlame} disabled={loading} className="text-xs px-2 py-0.5 rounded border border-zinc-700">Blame {reconcileAccount}</button>

        <div className="flex items-center gap-1">
          <select value={mergeSource} onChange={e => setMergeSource(e.target.value)} className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-xs">
            <option value="">merge from…</option>
            {branches.filter(b => b.name !== mergeTarget).map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
          <select value={mergeTarget} onChange={e => setMergeTarget(e.target.value)} className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-xs">
            {branches.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
          <button onClick={doMerge} disabled={loading || !mergeSource} className="text-xs px-2 py-0.5 rounded bg-purple-950 text-purple-400 border border-purple-800">Merge</button>
        </div>

        <button
          onClick={() => window.dispatchEvent(new CustomEvent('journal-updated'))}
          className="text-[10px] px-2 py-0.5 rounded border border-zinc-700 text-zinc-400"
        >
          Refresh
        </button>
      </div>

      {showCreate && (
        <div className="mt-2 flex gap-2">
          <input
            value={newBranchName}
            onChange={e => setNewBranchName(e.target.value)}
            placeholder="new-branch-name"
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-xs flex-1"
          />
          <button onClick={createBranch} disabled={loading || !newBranchName.trim()} className="text-xs px-3 rounded bg-white text-black">
            Create
          </button>
        </div>
      )}

      {/* Tags */}
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <input
          value={newTagName}
          onChange={e => setNewTagName(e.target.value)}
          placeholder="tag name (e.g. june-close)"
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-xs"
        />
        <button onClick={createTag} disabled={loading || !newTagName.trim()} className="text-xs px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800">
          Tag current
        </button>
        <button
          onClick={async () => {
            // Quick tag using current view (branch + asOf or head)
            const name = prompt('Quick tag name for current view (e.g. month-end, auditor-snapshot):')
            if (!name) return
            setLoading(true)
            try {
              await fetch('/api/accounting/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), branch: currentBranch }),
              })
              await refreshTags()
            } finally {
              setLoading(false)
            }
          }}
          className="text-[10px] px-2 py-0.5 rounded border border-amber-800 text-amber-400 hover:bg-amber-950"
          title="Tag the state you are currently viewing"
        >
          Tag now
        </button>
        {tags.length > 0 && (
          <span className="text-[10px] text-zinc-500">Tags: {tags.map(t => t.name).join(', ')}</span>
        )}
      </div>

      {preview && (
        <div className="mt-2 p-2 border border-rose-900 bg-rose-950/30 text-xs rounded">
          <div className="font-medium mb-1">Restore Preview — Time travel to this point (will move branch head)</div>
          <div className="max-h-24 overflow-auto">
            {(preview.preview || []).slice(0, 10).map((p: any, i: number) => (
              <div key={i}>{p.accountCode}: {p.current} → {p.target} (Δ {p.delta})</div>
            ))}
          </div>
          <div className="text-[10px] mt-1 text-rose-400">
            This creates a new ROLLBACK commit. History is preserved — you can restore to any earlier point afterward (including before this restore).
            Click "Confirm Restore" to make this the current state of the branch.
          </div>
        </div>
      )}

      {diffResult && (
        <div className="mt-2 p-2 border border-zinc-700 bg-zinc-900 text-xs rounded">
          <div className="font-medium mb-1">Diff (net changes)</div>
          {diffResult.changes?.slice(0, 12).map((c, i) => (
            <div key={i}>{c.accountCode}: {c.net}</div>
          ))}
        </div>
      )}

      {blameResult && (
        <div className="mt-2 p-2 border border-zinc-700 bg-zinc-900 text-xs rounded max-h-28 overflow-auto">
          <div className="font-medium mb-1">Blame for {reconcileAccount}</div>
          {blameResult.slice(0, 15).map((b, i) => (
            <div key={i}>{new Date(b.createdAt).toISOString().slice(0,10)} Δ{b.delta} {b.description || ''}</div>
          ))}
        </div>
      )}

      <div className="mt-1 text-[10px] text-zinc-500 flex items-center gap-2 flex-wrap">
        <span>
          Branch: <span className="text-zinc-300">{currentBranch}</span>
          {asOf && <> • asOf: <span className="text-zinc-300">{asOf.length > 16 ? asOf.slice(0, 8) + '…' : asOf}</span></>}
        </span>

        { (searchParams.get('view') || '').toLowerCase() !== 'history' && (
          <Link
            href="/app?view=history"
            className="text-[10px] px-2 py-0.5 rounded border border-zinc-700 hover:bg-zinc-800"
            title="Open the full commit history (GitHub-style list of all commits)"
          >
            View full commit history
          </Link>
        )}
      </div>
    </div>
  )
}
