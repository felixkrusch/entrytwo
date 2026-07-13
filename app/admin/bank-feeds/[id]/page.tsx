'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Connection {
  id: string
  provider: string
  externalId: string
  lastSyncAt: string | null
  account: { code: string; name: string }
}

const PROVIDERS: Record<string, string> = {
  stripe: 'Stripe',
  paypal: 'PayPal',
}

export default function ConnectionDetailPage() {
  const params = useParams()
  const connectionId = params.id as string
  const [connection, setConnection] = useState<Connection | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/bank-feeds/${connectionId}`).then(r => r.json()).then((conn) => {
      setConnection(conn)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [connectionId])

  const handleSyncNow = async () => {
    await fetch('/api/bank-feeds/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId }),
    })
    alert('Import completed')
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
          <label className="text-xs text-zinc-400">Last manual import</label>
          <div className="text-sm">{connection.lastSyncAt ? new Date(connection.lastSyncAt).toLocaleString() : 'Never'}</div>
        </div>

        <button onClick={handleSyncNow} className="w-full px-3 py-1.5 rounded bg-white text-black text-sm">
          Import latest transactions
        </button>

        {(connection.provider === 'stripe' || connection.provider === 'paypal') && (
          <div className="text-[10px] text-zinc-500 pt-2 border-t border-zinc-800">
            This connection uses API keys from .env, not stored credentials.
          </div>
        )}
      </div>
    </div>
  )
}
