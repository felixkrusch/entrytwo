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
  account: Account
}

// Stripe and PayPal are the only supported processor feeds.
// API keys come from .env and are never stored on a connection.
const PROVIDERS = [
  { id: 'stripe', name: 'Stripe', color: 'bg-purple-950 text-purple-400' },
  { id: 'paypal', name: 'PayPal', color: 'bg-blue-950 text-blue-400' },
]

export default function BankFeedsPage() {
  const [connections, setConnections] = useState<BankConnection[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [transactions, setTransactions] = useState<FeedTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [showConnect, setShowConnect] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('stripe')
  const [selectedAccount, setSelectedAccount] = useState('')

  // Stripe/PayPal feeds use global keys from .env only.
  // No per-connection secrets should ever be stored for them.
  const [stripeConfigured, setStripeConfigured] = useState(false)
  const [paypalConfigured, setPaypalConfigured] = useState(false)

  // Only these two providers are supported for feeds, and only when their keys are in .env.
  const availableProviders = PROVIDERS.filter(p =>
    (p.id === 'stripe' && stripeConfigured) || (p.id === 'paypal' && paypalConfigured)
  )

  useEffect(() => {
    Promise.all([
      fetch('/api/bank-feeds/connections').then(r => r.json()),
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/bank-feeds/transactions').then(r => r.json()),
      fetch('/api/payments/stripe/status').then(r => r.json()).catch(() => ({ configured: false })),
      fetch('/api/payments/paypal/status').then(r => r.json()).catch(() => ({ configured: false })),
    ]).then(([conns, accs, txs, stripeStatus, paypalStatus]) => {
      setConnections(conns)
      setAccounts(accs)
      setTransactions(txs)
      setStripeConfigured(!!stripeStatus?.configured)
      setPaypalConfigured(!!paypalStatus?.configured)

      // Default the selector to the first actually available provider
      if (stripeStatus?.configured) {
        setSelectedProvider('stripe')
      } else if (paypalStatus?.configured) {
        setSelectedProvider('paypal')
      }

      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleConnect = async () => {
    if (!selectedAccount || !selectedProvider) return

    // For Stripe and PayPal we no longer accept/store per-connection secrets here.
    // The connection record is just a lightweight pointer to "this account gets feed data from Stripe/PayPal".
    await fetch('/api/bank-feeds/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: selectedAccount,
        provider: selectedProvider,
        externalId: `${selectedProvider}-${selectedAccount}`,
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
        <h1 className="text-xl font-semibold">Processor Feeds</h1>
        <p className="text-xs text-zinc-500 mt-1">Stripe and PayPal can be connected for automatic transaction import. For all other banks and credit cards, upload statements or paste transaction tables directly into chat.</p>
      </div>

      <div className="space-y-4">
        {connections.length === 0 ? (
          <div className="text-zinc-500">No processor connections configured. Stripe and PayPal feeds require API keys in .env.</div>
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

      {/* Manual authoritative entry kept as advanced/power tool, not the main story */}
      <details className="mt-8">
        <summary className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-200">Advanced: Manually record a transaction with a real rate</summary>
        <div className="mt-3">
          <QuickFeedImport />
        </div>
      </details>

      {/* Only show connect button if there is at least one provider we can actually connect right now */}
      {(stripeConfigured || paypalConfigured) && (
        <button
          onClick={() => setShowConnect(!showConnect)}
          className="mt-6 px-4 py-2 rounded bg-white text-black text-sm"
        >
          + Connect Feed
        </button>
      )}

      {(!stripeConfigured && !paypalConfigured) && (
        <div className="mt-6 text-xs text-zinc-500">
          Stripe and PayPal bank feeds require API credentials in .env.<br />
          Set <span className="font-mono">STRIPE_SECRET_KEY</span> (and optionally <span className="font-mono">STRIPE_WEBHOOK_SECRET</span>) for Stripe.<br />
          Set <span className="font-mono">PAYPAL_CLIENT_ID</span> and <span className="font-mono">PAYPAL_SECRET</span> for PayPal.
        </div>
      )}

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

      {/* Connect form is only rendered when at least one supported provider has keys in .env.
          We never show a raw JSON credentials form for Stripe/PayPal. */}
      {(showConnect && (stripeConfigured || paypalConfigured)) && (
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
                {availableProviders.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Stripe/PayPal never store per-connection secrets.
                The BankConnection is just a pointer: "feed data for this account comes from this processor".
                Keys are read at runtime from process.env. */}
            <div className="mb-4 text-xs text-zinc-400">
              Using API keys from .env. No secrets are stored for this connection.
            </div>

            <div className="mb-4">
              <label className="text-xs text-zinc-400">Account (where transactions will be booked)</label>
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

            <div className="flex gap-2">
              <button onClick={() => setShowConnect(false)} className="flex-1 px-3 py-1 rounded bg-zinc-800 text-sm">
                Cancel
              </button>
              <button
                onClick={handleConnect}
                className="flex-1 px-3 py-1 rounded bg-emerald-950 text-emerald-400 text-sm"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
