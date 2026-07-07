'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import QuickFeedImport from '@/app/app/QuickFeedImport'

interface Account {
  id: string
  code: string
  name: string
  type: string
}

interface FeedTransaction {
  id: string
  date: string
  description: string
  merchant: string | null
  amount: string
  currency: string
  status: string
  connection: { provider: string; account: Account } | null
}

interface BankConnection {
  id: string
  provider: string
  externalId: string
  lastSyncAt: string | null
  syncEnabled: boolean
  account: Account
}

const PROVIDERS = [
  { id: 'stripe', name: 'Stripe', color: 'bg-purple-950 text-purple-400' },
  { id: 'paypal', name: 'PayPal', color: 'bg-blue-950 text-blue-400' },
  { id: 'plaid', name: 'Plaid (US/Canada)', color: 'bg-emerald-950 text-emerald-400' },
  { id: 'salt-edge', name: 'Salt Edge (EU)', color: 'bg-amber-950 text-amber-400' },
]

export default function BankFeedsPage() {
  const [connections, setConnections] = useState<BankConnection[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [transactions, setTransactions] = useState<FeedTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [showConnect, setShowConnect] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('stripe')
  const [selectedAccount, setSelectedAccount] = useState('')
  const [credentials, setCredentials] = useState('{}')

  useEffect(() => {
    Promise.all([
      fetch('/api/bank-feeds/connections').then(r => r.json()),
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/bank-feeds/transactions').then(r => r.json()),
    ]).then(([conns, accs, txs]) => {
      setConnections(conns)
      setAccounts(accs)
      setTransactions(txs)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleConnect = async () => {
    if (!selectedAccount || !selectedProvider) return
    let parsedCreds: Record<string, unknown> = {}
    try {
      parsedCreds = JSON.parse(credentials)
    } catch {
      alert('Invalid JSON credentials')
      return
    }
    await fetch('/api/bank-feeds/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: selectedAccount,
        provider: selectedProvider,
        externalId: `${selectedProvider}-${selectedAccount}`,
        credentials: parsedCreds,
      }),
    })
    setShowConnect(false)
    window.location.reload()
  }

  if (loading) {
    return <div className="text-sm text-zinc-500">Loading...</div>
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Bank Feeds</h1>
        <p className="text-xs text-zinc-500 mt-1">Connect your accounts to automatic transaction feeds — or import a single transaction manually below.</p>
      </div>

      <div className="mb-6">
        <QuickFeedImport />
      </div>

      <div className="space-y-4">
        {connections.length === 0 ? (
          <div className="text-zinc-500">No bank feed connections configured.</div>
        ) : (
          connections.map(conn => (
            <div key={conn.id} className="border border-zinc-800 rounded-lg p-4 bg-zinc-950">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{conn.account.name} ({conn.account.code})</div>
                  <div className={`inline-block px-2 py-0.5 rounded text-xs mt-1 ${PROVIDERS.find(p => p.id === conn.provider)?.color || 'bg-zinc-800'}`}>
                    {PROVIDERS.find(p => p.id === conn.provider)?.name || conn.provider}
                  </div>
                </div>
                <Link href={`/admin/bank-feeds/${conn.id}`} className="text-sm text-emerald-400 hover:underline">
                  Configure
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      <button
        onClick={() => setShowConnect(!showConnect)}
        className="mt-6 px-4 py-2 rounded bg-white text-black text-sm"
      >
        + Connect Feed
      </button>

      {transactions.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-3">Pending Transactions</h2>
          <div className="border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900">
                <tr className="text-left">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {transactions.filter(t => t.status === 'pending').map(tx => (
                  <tr key={tx.id} className="border-t border-zinc-800">
                    <td className="px-3 py-2">{tx.date}</td>
                    <td className="px-3 py-2">{tx.merchant || tx.description}</td>
                    <td className="px-3 py-2 font-mono">{Number(tx.amount).toFixed(2)} {tx.currency}</td>
                    <td className="px-3 py-2">
                      <span className="px-2 py-0.5 rounded text-xs bg-amber-950 text-amber-400">
                        pending
                      </span>
                    </td>
                    <td className="px-3 py-2">
<Link href={`/admin/bank-feeds/transactions/${tx.id}`} className="text-xs text-emerald-400 hover:underline">
                         Match
                       </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showConnect && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-6 w-96">
            <h3 className="font-medium mb-4">Connect Bank Feed</h3>

            <div className="mb-3">
              <label className="text-xs text-zinc-400">Provider</label>
              <select
                value={selectedProvider}
                onChange={e => setSelectedProvider(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 mt-1"
              >
                {PROVIDERS.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="text-xs text-zinc-400">Account</label>
              <select
                value={selectedAccount}
                onChange={e => setSelectedAccount(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 mt-1"
              >
                <option value="">Select account...</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.code})</option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="text-xs text-zinc-400">Credentials (JSON)</label>
              <textarea
                value={credentials}
                onChange={e => setCredentials(e.target.value)}
                placeholder='{"apiKey":"sk_live_..."}'
                className="w-full h-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 mt-1 font-mono text-xs"
              />
              <div className="text-[10px] text-zinc-500 mt-1">
                Enter provider credentials as JSON. Will be encrypted at rest.
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setShowConnect(false)} className="flex-1 px-3 py-1 rounded bg-zinc-800 text-sm">
                Cancel
              </button>
              <button onClick={handleConnect} className="flex-1 px-3 py-1 rounded bg-emerald-950 text-emerald-400 text-sm">
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}