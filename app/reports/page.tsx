'use client'

import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { formatCurrency } from '@/lib/utils'

type BalanceSheet = {
  assets: { code: string; name: string; balance: number; currency: string }[]
  liabilities: { code: string; name: string; balance: number; currency: string }[]
  equity: { code: string; name: string; balance: number; currency: string }[]
  assetsTotal: number
  liabilitiesTotal: number
  equityTotal: number
}

type ProfitLoss = {
  revenue: number
  expenses: number
  netIncome: number
  taxSummary?: { input: number; output: number; net: number }
  byCurrency?: Record<string, { revenue: number; expenses: number }>
}

export default function ReportsPage() {
  const t = useTranslations('app.panels')
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheet | null>(null)
  const [profitLoss, setProfitLoss] = useState<ProfitLoss | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchReports = useCallback(async () => {
    setLoading(true)
    try {
      const [bsRes, plRes] = await Promise.all([
        fetch('/api/reports/balance-sheet'),
        fetch(dateFrom && dateTo ? `/api/reports/profit-loss?from=${dateFrom}&to=${dateTo}` : '/api/reports/profit-loss'),
      ])
      
      if (bsRes.ok) {
        const bs = await bsRes.json()
        setBalanceSheet(bs)
      }
      
      if (plRes.ok) {
        const pl = await plRes.json()
        setProfitLoss(pl)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
     void fetchReports()
   }, [fetchReports])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Balance Sheet and Profit & Loss statements.
        </p>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <div>
          <label className="text-zinc-400 text-xs block mb-1">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-zinc-400 text-xs block mb-1">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
          />
        </div>
        <button
          onClick={() => void fetchReports()}
          disabled={loading}
          className="px-3 py-1 rounded bg-emerald-500 text-black font-medium text-sm hover:bg-emerald-400 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-950">
          <h2 className="font-medium mb-3">{t('reports.title')}</h2>
          {balanceSheet ? (
            <div className="space-y-4 text-sm">
              <div>
                <div className="text-zinc-400 font-medium mb-2">Assets</div>
                <div className="space-y-1">
                  {balanceSheet.assets.map(a => (
                    <div key={a.code} className="flex justify-between">
                      <span>{a.code} - {a.name}</span>
                      <span>{formatCurrency(a.balance, a.currency)}</span>
                    </div>
                  ))}
                  <div className="border-t border-zinc-700 pt-1 font-medium flex justify-between">
                    <span>Total</span>
                    <span>{formatCurrency(balanceSheet.assetsTotal)}</span>
                  </div>
                </div>
              </div>
              
              <div>
                <div className="text-zinc-400 font-medium mb-2">Liabilities</div>
                <div className="space-y-1">
                  {balanceSheet.liabilities.map(a => (
                    <div key={a.code} className="flex justify-between">
                      <span>{a.code} - {a.name}</span>
                      <span>{formatCurrency(a.balance, a.currency)}</span>
                    </div>
                  ))}
                  <div className="border-t border-zinc-700 pt-1 font-medium flex justify-between">
                    <span>Total</span>
                    <span>{formatCurrency(balanceSheet.liabilitiesTotal)}</span>
                  </div>
                </div>
              </div>
              
              <div>
                <div className="text-zinc-400 font-medium mb-2">Equity</div>
                <div className="space-y-1">
                  {balanceSheet.equity.map(a => (
                    <div key={a.code} className="flex justify-between">
                      <span>{a.code} - {a.name}</span>
                      <span>{formatCurrency(a.balance, a.currency)}</span>
                    </div>
                  ))}
                  <div className="border-t border-zinc-700 pt-1 font-medium flex justify-between">
                    <span>Total</span>
                    <span>{formatCurrency(balanceSheet.equityTotal)}</span>
                  </div>
                </div>
              </div>
              
              <div className="text-xs pt-2">
                {balanceSheet.assetsTotal === balanceSheet.liabilitiesTotal + balanceSheet.equityTotal ? (
                  <span className="text-emerald-400">✓ {t('reports.balanced')}</span>
                ) : (
                  <span className="text-amber-400">⚠ {t('reports.checkEntries')}</span>
                )}
              </div>
            </div>
          ) : (
            <div className="text-zinc-500">Loading...</div>
          )}
        </div>

        <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-950">
          <h2 className="font-medium mb-3">{t('profitLoss.title')}</h2>
          {profitLoss ? (
            <div className="space-y-4 text-sm">
              <div className="flex justify-between">
                <span>{t('profitLoss.revenue')}</span>
                <span className="text-emerald-400">{formatCurrency(profitLoss.revenue)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t('profitLoss.expenses')}</span>
                <span className="text-rose-400">{formatCurrency(profitLoss.expenses)}</span>
              </div>
              <div className="border-t border-zinc-700 pt-2 flex justify-between font-medium">
                <span>{t('profitLoss.netIncome')}</span>
                <span className={profitLoss.netIncome >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {formatCurrency(profitLoss.netIncome)}
                </span>
              </div>
              
{profitLoss.taxSummary && (
                 <div className="border-t border-zinc-700 pt-2">
                   <div className="text-zinc-400 text-xs mb-1">{t('profitLoss.taxSummary')}</div>
                  <div className="flex justify-between text-xs">
                    <span>{t('profitLoss.inputTax')}</span>
                    <span className="text-emerald-400">{formatCurrency(profitLoss.taxSummary.input)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span>{t('profitLoss.outputTax')}</span>
                    <span className="text-rose-400">{formatCurrency(profitLoss.taxSummary.output)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-medium">
                    <span>{t('profitLoss.netTax')}</span>
                    <span>{formatCurrency(profitLoss.taxSummary.net)}</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-zinc-500">Loading...</div>
          )}
        </div>
      </div>
    </div>
  )
}