'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Connection {
  id: string
  provider: string
  externalId: string
  lastSyncAt: string | null
  syncEnabled: boolean
  account: { code: string; name: string }
}

const PROVIDERS: Record<string, string> = {
  stripe: 'Stripe',
  paypal: 'PayPal',
  plaid: 'Plaid',
  'salt-edge': 'Salt Edge',
  csv: 'CSV Import',
}

export default function ConnectionDetailPage() {
  const params = useParams()
  const connectionId = params.id as string
  const [connection, setConnection] = useState<Connection | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncEnabled, setSyncEnabled] = useState(true)

  useEffect(() => {
    fetch(`/api/bank-feeds/${connectionId}`).then(r => r.json()).then((conn) => {
      setConnection(conn)
      setSyncEnabled(conn.syncEnabled)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [connectionId])

  const handleToggleSync = async () => {
    await fetch(`/api/bank-feeds/${connectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncEnabled: !syncEnabled }),
    })
    setSyncEnabled(!syncEnabled)
  }

  const handleSyncNow = async () => {
    await fetch('/api/bank-feeds/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId }),
    })
    alert('Sync triggered')
  }

  if (loading) return <div className="text-sm text-zinc-500">Loading...</div>

  if (!connection) return <div className="text-zinc-500">Connection not found.</div>

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin/bank-feeds" className="text-xs text-zinc-500 hover:underline">
          ← Back to Bank Feeds
        </Link>
        <h1 className="text-xl font-semibold mt-2">{PROVIDERS[connection.provider] || connection.provider}</h1>
        <p className="text-xs text-zinc-500">Linked to {connection.account.name} ({connection.account.code})</p>
      </div>

      <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-950 space-y-4 max-w-md">
        <div>
          <label className="text-xs text-zinc-400">Provider ID</label>
          <div className="font-mono text-sm">{connection.externalId}</div>
        </div>

        <div>
          <label className="text-xs text-zinc-400">Last Sync</label>
          <div className="text-sm">{connection.lastSyncAt ? new Date(connection.lastSyncAt).toLocaleString() : 'Never'}</div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm">Sync Enabled</span>
          <button
            onClick={handleToggleSync}
            className={`px-2 py-1 rounded text-xs ${syncEnabled ? 'bg-emerald-950 text-emerald-400' : 'bg-zinc-800 text-zinc-400'}`}
          >
            {syncEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>

        <button onClick={handleSyncNow} className="w-full px-3 py-1.5 rounded bg-white text-black text-sm">
          Sync Now
        </button>
      </div>
    </div>
  )
}