'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

interface FeedTx {
  id: string
  date: string
  description: string
  merchant: string | null
  amount: string
  currency: string
  status: string
  connection: { provider: string; account: { code: string; name: string } } | null
}

interface MatchResult {
  confidence: number
  suggestedEntry?: {
    date: string
    description: string
    lines: Array<{ accountId: string; debit: number; credit: number }>
  }
}

interface Account {
  id: string
  code: string
  name: string
}

export default function TransactionMatchPage() {
  const params = useParams()
  const transactionId = params.id as string
  const [tx, setTx] = useState<FeedTx | null>(null)
  const [match, setMatch] = useState<MatchResult | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/bank-feeds/transactions/${transactionId}`).then(r => r.json()).then(async txData => {
      setTx(txData)
      const accs = await (await fetch('/api/accounts')).json()
      setAccounts(accs)
      if (txData.match) setMatch(txData.match)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [transactionId])

  const handleMatch = async () => {
    await fetch('/api/bank-feeds/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId, action: 'match' }),
    })
    alert('Matched and posted')
    window.location.href = '/admin/bank-feeds'
  }

  const handleIgnore = async () => {
    await fetch('/api/bank-feeds/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId, action: 'ignore' }),
    })
    window.location.href = '/admin/bank-feeds'
  }

  if (loading) return <div className="text-sm text-zinc-500">Loading...</div>

  if (!tx) return <div className="text-zinc-500">Transaction not found.</div>

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin/bank-feeds" className="text-xs text-zinc-500 hover:underline">
          ← Back to Bank Feeds
        </Link>
        <h1 className="text-xl font-semibold mt-2">Match Transaction</h1>
      </div>

      <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-950 mb-4 max-w-lg">
        <div className="space-y-2">
          <div><span className="text-zinc-500">Date:</span> {tx.date}</div>
          <div><span className="text-zinc-500">Merchant:</span> {tx.merchant || '—'}</div>
          <div><span className="text-zinc-500">Description:</span> {tx.description}</div>
          <div className="font-mono text-lg">{Number(tx.amount).toFixed(2)} {tx.currency}</div>
        </div>
      </div>

      {match && match.suggestedEntry && (
        <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-950 mb-4">
          <div className="text-sm text-zinc-400 mb-2">Suggested Entry (confidence: {match.confidence}%)</div>
          <div className="font-medium mb-2">{match.suggestedEntry.description}</div>
          <div className="space-y-1 text-sm">
            {match.suggestedEntry.lines.map((l, i) => {
              const acc = accounts.find(a => a.id === l.accountId)
              return (
                <div key={i} className="flex justify-between">
                  <span>{acc?.code || l.accountId}</span>
                  <span className="font-mono">{l.debit > 0 ? `${l.debit} Dr` : `${l.credit} Cr`}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={handleMatch} className="px-4 py-2 rounded bg-emerald-950 text-emerald-400 text-sm">
          Match & Post
        </button>
        <button onClick={handleIgnore} className="px-4 py-2 rounded bg-zinc-800 text-sm">
          Ignore
        </button>
      </div>
    </div>
  )
}