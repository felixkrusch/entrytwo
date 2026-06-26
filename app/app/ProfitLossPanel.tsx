'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import toast from 'react-hot-toast'

interface ReportItem {
  code: string
  name: string
  amount: number
}

interface PLData {
  revenue: { total: number; items: ReportItem[] }
  expenses: { total: number; items: ReportItem[] }
  netIncome: number
  taxSummary?: {
    inputTax: number
    outputTax: number
    netTax: number
  }
  byCurrency?: Record<string, {
    revenueNative: number
    expensesNative: number
    revenueBase: number
    expensesBase: number
    netNative: number
    netBase: number
  }>
}

interface ProfitLossPanelProps {
  onFilterAccount?: (code: string) => void
  currentFilterCode?: string | null
}

export default function ProfitLossPanel({ onFilterAccount, currentFilterCode }: ProfitLossPanelProps) {
  const t = useTranslations('app.panels.profitLoss')
  const format = useFormatter()

  // All hooks at the very top — never after conditionals or returns (Rules of Hooks)
  const [data, setData] = useState<PLData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const handleClickAccount = (code?: string) => {
    if (code && onFilterAccount) {
      const isSame = currentFilterCode === code
      onFilterAccount(isSame ? '' : code)
      if (!isSame) toast.success(`Filtered journal to ${code}`)
    }
  }

  const loadPL = async () => {
    setLoading(true)
    setError(null)
    try {
      const url = new URL('/api/reports/profit-loss', window.location.origin)
      if (fromDate && toDate) {
        url.searchParams.set('from', fromDate)
        url.searchParams.set('to', toDate)
      }
      const res = await fetch(url.toString())
      if (!res.ok) throw new Error('Failed to load P&L')
      const d: unknown = await res.json()
      if (d && typeof d === 'object' && (d as { revenue?: unknown }).revenue) {
        setData(d as PLData)
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load P&L')
    } finally {
      setLoading(false)
    }
  }

  const refresh = () => {
    loadPL()
    setLastUpdated(new Date())
  }

  useEffect(() => {
    let mounted = true
    const run = () => { if (mounted) loadPL() }
    run()
    const handler = () => run()
    window.addEventListener('journal-updated', handler)
    return () => {
      mounted = false
      window.removeEventListener('journal-updated', handler)
    }
  }, [])

  if (loading) {
    return (
      <div className="mt-8">
        <div className="text-sm text-zinc-500 mb-4">{t('title')}</div>
        <div className="text-zinc-500 text-sm">{t('loading')}</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="mt-8">
        <div className="text-sm text-zinc-500 mb-4">{t('title')}</div>
        <div className="text-zinc-500 text-sm">{error || t('noData')}</div>
      </div>
    )
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
            title="Refresh P&amp;L"
          >
            ↻
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5"
            placeholder="from"
          />
          <span className="text-zinc-600">→</span>
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5"
            placeholder="to"
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
        className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 hover:bg-emerald-900 transition mb-3"
      >
        {t('live')}
      </button>
      {lastUpdated && (
        <div className="text-[10px] text-zinc-600 -mt-3 mb-2 text-right">
          as of {lastUpdated.toLocaleTimeString()}
        </div>
      )}

      <div className="space-y-6 text-sm">
        {/* Revenue */}
        <div>
          <div className="font-medium text-blue-400 mb-2 flex justify-between">
            <span>{t('revenue')}</span>
            <span className="font-mono text-blue-400">{format.number(data.revenue.total, { style: 'currency', currency: 'EUR' })}</span>
          </div>
           {data.revenue.items.length > 0 ? (
             data.revenue.items.map((item: ReportItem & { currency?: string; nativeAmount?: number; feedSourced?: boolean }) => (
               <div
                 key={item.code}
                 onClick={() => handleClickAccount(item.code)}
                 className={`flex justify-between py-1 border-b border-zinc-800 pl-2 cursor-pointer hover:bg-zinc-800/60 ${currentFilterCode === item.code ? 'bg-emerald-950/40 ring-1 ring-emerald-800' : ''}`}
                 title="Click to filter journal to this account"
               >
                 <span>{item.code} {item.name}</span>
                 <span className="font-mono text-blue-400">
                   {format.number(item.amount, { style: 'currency', currency: 'EUR' })}
                   {item.currency && item.currency !== 'EUR' ? ` (${item.currency}${item.nativeAmount != null ? ` ~${item.nativeAmount.toFixed(2)}` : ''}${item.feedSourced ? ' • feed' : ''})` : ''}
                 </span>
               </div>
             ))
           ) : (
             <div className="text-zinc-500 pl-2">{t('noRevenue')}</div>
           )}
        </div>

        {/* Expenses */}
        <div>
          <div className="font-medium text-rose-400 mb-2 flex justify-between">
            <span>{t('expenses')}</span>
            <span className="font-mono text-rose-400">{format.number(data.expenses.total, { style: 'currency', currency: 'EUR' })}</span>
          </div>
          {data.expenses.items.length > 0 ? (
             data.expenses.items.map((item: ReportItem & { currency?: string; nativeAmount?: number }) => (
               <div
                 key={item.code}
                 onClick={() => handleClickAccount(item.code)}
                 className={`flex justify-between py-1 border-b border-zinc-800 pl-2 cursor-pointer hover:bg-zinc-800/60 ${currentFilterCode === item.code ? 'bg-emerald-950/40 ring-1 ring-emerald-800' : ''}`}
                 title="Click to filter journal to this account"
               >
                 <span>{item.code} {item.name}</span>
                 <span className="font-mono text-rose-400">
                   {format.number(item.amount, { style: 'currency', currency: 'EUR' })}
                   {item.currency && item.currency !== 'EUR' ? ` (${item.currency}${item.nativeAmount != null ? ` ~${item.nativeAmount.toFixed(2)}` : ''})` : ''}
                 </span>
               </div>
             ))
           ) : (
             <div className="text-zinc-500 pl-2">{t('noExpenses')}</div>
           )}
        </div>

        {/* Net Income */}
        <div className="pt-3 border-t border-zinc-700 flex justify-between text-sm font-medium">
          <span>{t('netIncome')}</span>
            <span className={`font-mono ${data.netIncome >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {format.number(data.netIncome, { style: 'currency', currency: 'EUR' })}
          </span>
        </div>

        {/* Richer currency breakdown (Phase 0 enhancement) */}
        {data.byCurrency && Object.keys(data.byCurrency).length > 0 && (
          <div className="pt-2 text-[10px] text-zinc-400 font-mono">
            <div className="text-[9px] text-zinc-500 mb-0.5">{t('byCurrency')}</div>
            {Object.entries(data.byCurrency as Record<string, { netBase?: number; netNative?: number }>).sort().map(([cur, v]) => (
              <div key={cur}>
                {cur}: {t('netBase')} {format.number(v.netBase || 0, { style: 'currency', currency: 'EUR' })}
                {cur !== 'EUR' && v.netNative != null ? ` • ${t('netNative')} ~${v.netNative.toFixed(2)}` : ''}
              </div>
            ))}
          </div>
        )}

        {/* Multi-currency status (Phase 0) */}
        {(() => {
          const currencies = new Set<string>()
          ;[...(data.revenue.items || []), ...(data.expenses.items || [])].forEach((i) => {
            if ((i as { currency?: string }).currency) currencies.add((i as { currency?: string }).currency as string)
          })
          const list = Array.from(currencies).sort().join(', ') || 'EUR'
          return <div className="pt-1 text-[10px] text-zinc-500">Currencies: {list} (per-line + FX ready)</div>
        })()}

        {/* Tax summary (Phase 0 tax foundation) - fully i18n */}
        {data.taxSummary && (
          <div className="pt-2 text-[11px] text-zinc-400 font-mono">
            {t('tax')}: {t('inputTax')} {format.number(data.taxSummary.inputTax, { style: 'currency', currency: 'EUR' })} • {t('outputTax')} {format.number(data.taxSummary.outputTax, { style: 'currency', currency: 'EUR' })} • {t('netTax')} {format.number(data.taxSummary.netTax, { style: 'currency', currency: 'EUR' })}
          </div>
        )}
      </div>
    </div>
  )
}
