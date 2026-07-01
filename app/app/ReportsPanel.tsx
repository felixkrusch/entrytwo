'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import { useRouter } from 'next/navigation'

interface AccountBalance {
  code: string
  name: string
  type: string
  balance: number          // base-currency (EUR) total
  currency?: string        // dominant/original currency for the account
  baseCurrency?: string
  nativeBalance?: number   // sum in the dominant currency (if different)
}

interface ByCurrencyValue {
  native: number
  base: number
}

interface BSData {
  accounts: AccountBalance[]
  byCurrency?: Record<string, ByCurrencyValue>
}

interface ReportsPanelProps {
  onFilterAccount?: (code: string) => void
  currentFilterCode?: string | null
}

export default function ReportsPanel({ onFilterAccount, currentFilterCode }: ReportsPanelProps) {
  const t = useTranslations('app.panels.reports')
  const format = useFormatter()
  const [data, setData] = useState<BSData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const fetchBalances = () => {
    setLoading(true)
    setError(null)
    const url = new URL('/api/reports/balance-sheet', window.location.origin)
    if (fromDate && toDate) {
      url.searchParams.set('from', fromDate)
      url.searchParams.set('to', toDate)
    }
    fetch(url.toString())
      .then(res => {
        if (!res.ok) throw new Error('Failed to load balance sheet')
        return res.json()
      })
      .then((d: unknown) => {
        if (Array.isArray(d)) {
          setData({ accounts: d as AccountBalance[] })
        } else if (d && typeof d === 'object' && Array.isArray((d as { accounts?: unknown }).accounts)) {
          setData(d as BSData)
        }
      })
      .catch((e: unknown) => {
        setError((e as Error)?.message || 'Failed to load report')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let mounted = true
    const doFetch = () => { if (mounted) void fetchBalances() }
    void doFetch()

    const handler = () => doFetch()
    window.addEventListener('journal-updated', handler)
    return () => {
      mounted = false
      window.removeEventListener('journal-updated', handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const balances = data?.accounts || []
  const assets = balances.filter(b => b.type === 'ASSET')
  const liabilities = balances.filter(b => b.type === 'LIABILITY')
  const equity = balances.filter(b => b.type === 'EQUITY')

  const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0)
  const totalLiabilities = liabilities.reduce((sum, a) => sum + a.balance, 0)
  const totalEquity = equity.reduce((sum, a) => sum + a.balance, 0)

  const router = useRouter()

  const handleClickAccount = (code: string) => {
    // Strong preference: open the dedicated ledger view (right-side replacement)
    const params = new URLSearchParams()
    params.set('view', 'ledger')
    params.set('accountCode', code)
    router.push(`/app?${params.toString()}`)
  }

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const refresh = () => {
    fetchBalances()
    setLastUpdated(new Date())
  }

  return (
    <div className="mt-8">
      {error && (
        <div className="text-[10px] text-rose-400 mb-2 px-2">{error}</div>
      )}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="text-sm text-zinc-500">{t('title')}</div>
          <button
            onClick={refresh}
            className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-400"
            title="Refresh balance sheet"
          >
            ↻
          </button>
          <div className="flex items-center gap-1 text-xs">
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5"
            />
            <span className="text-zinc-600">→</span>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5"
            />
            {(fromDate || toDate) && (
              <button
                onClick={() => { setFromDate(''); setToDate('') }}
                className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <button
          onClick={refresh}
          className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 hover:bg-emerald-900 transition"
        >
          {t('live')}
        </button>
        {currentFilterCode && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">filtered: {currentFilterCode}</span>
        )}
      </div>
      {lastUpdated && (
        <div className="text-[10px] text-zinc-600 -mt-3 mb-2 text-right">
          as of {lastUpdated.toLocaleTimeString()}
        </div>
      )}

      {loading ? (
        <div className="text-zinc-500 text-sm">{t('loading')}</div>
      ) : error ? (
        <div className="text-rose-400 text-sm">{error}</div>
      ) : (
        <div className="space-y-6 text-sm">
          <div>
            <div className="font-medium text-emerald-400 mb-2 flex justify-between">
              <span>{t('assets')}</span>
              <span className="font-mono">{format.number(totalAssets, { style: 'currency', currency: 'EUR' })}</span>
            </div>
            {assets.length > 0 ? assets.map(a => (
              <div
                key={a.code}
                onClick={() => handleClickAccount(a.code)}
                className={`flex justify-between py-1 border-b border-zinc-800 pl-2 cursor-pointer hover:bg-zinc-800/60 ${currentFilterCode === a.code ? 'bg-emerald-950/40 ring-1 ring-emerald-800' : ''}`}
                title="Click to filter journal to this account"
              >
                <span>{a.code} {a.name}</span>
                <span className="font-mono text-emerald-400">
                  {format.number(a.balance, { style: 'currency', currency: 'EUR' })}
                  {a.currency && a.currency !== 'EUR' ? ` (${a.currency}${a.nativeBalance != null ? ` ~${a.nativeBalance.toFixed(2)}` : ''})` : ''}
                </span>
              </div>
            )) : <div className="text-zinc-500 pl-2">{t('noAssets')}</div>}
          </div>

          <div>
            <div className="font-medium text-amber-400 mb-2 flex justify-between">
              <span>{t('liabilities')}</span>
              <span className="font-mono">{format.number(totalLiabilities, { style: 'currency', currency: 'EUR' })}</span>
            </div>
            {liabilities.length > 0 ? liabilities.map(a => (
              <div
                key={a.code}
                onClick={() => handleClickAccount(a.code)}
                className="flex justify-between py-1 border-b border-zinc-800 pl-2 cursor-pointer hover:bg-zinc-800/60"
                title="Click to filter journal to this account"
              >
                <span>{a.code} {a.name}</span>
                <span className="font-mono text-amber-400">
                  {format.number(a.balance, { style: 'currency', currency: 'EUR' })}
                  {a.currency && a.currency !== 'EUR' ? ` (${a.currency}${a.nativeBalance != null ? ` ~${a.nativeBalance.toFixed(2)}` : ''})` : ''}
                </span>
              </div>
            )) : <div className="text-zinc-500 pl-2">{t('noLiabilities')}</div>}
          </div>

          <div>
            <div className="font-medium text-purple-400 mb-2 flex justify-between">
              <span>{t('equity')}</span>
              <span className="font-mono">{format.number(totalEquity, { style: 'currency', currency: 'EUR' })}</span>
            </div>
            {equity.length > 0 ? equity.map(a => (
              <div
                key={a.code}
                onClick={() => handleClickAccount(a.code)}
                className="flex justify-between py-1 border-b border-zinc-800 pl-2 cursor-pointer hover:bg-zinc-800/60"
                title="Click to filter journal to this account"
              >
                <span>{a.code} {a.name}</span>
                <span className="font-mono text-purple-400">
                  {format.number(a.balance, { style: 'currency', currency: 'EUR' })}
                  {a.currency && a.currency !== 'EUR' ? ` (${a.currency}${a.nativeBalance != null ? ` ~${a.nativeBalance.toFixed(2)}` : ''})` : ''}
                </span>
              </div>
            )) : <div className="text-zinc-500 pl-2">{t('noEquity')}</div>}
          </div>

          {/* Richer currency view for balance sheet */}
          {data?.byCurrency && Object.keys(data.byCurrency).length > 0 && (
            <div className="pt-2 text-[10px] text-zinc-400 font-mono">
              <div className="text-[9px] text-zinc-500 mb-0.5">{t('byCurrency')}</div>
              {Object.entries(data.byCurrency).sort().map(([cur, v]: [string, { base: number; native?: number }]) => (
                <div key={cur}>
                  {cur}: base {format.number(v.base, { style: 'currency', currency: 'EUR' })}
                  {cur !== 'EUR' && v.native != null ? ` • native ~${v.native.toFixed(2)}` : ''}
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-zinc-700 text-xs text-zinc-400 flex justify-between">
            <span>{t('balanceCheck')}</span>
            <span className={totalAssets === (totalLiabilities + totalEquity) ? 'text-emerald-400' : 'text-rose-400'}>
              {totalAssets === (totalLiabilities + totalEquity) ? t('balanced') : t('checkEntries')}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
