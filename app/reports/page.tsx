'use client'

import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { formatCurrency } from '@/lib/utils'

interface AccountBalance {
  code: string
  name: string
  type: string
  balance: number
  currency?: string
  nativeBalance?: number
}

type BalanceSheet = {
  accounts: AccountBalance[]
  byCurrency?: Record<string, { native: number; base: number }>
  assets: AccountBalance[]
  liabilities: AccountBalance[]
  equity: AccountBalance[]
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
  revenueItems?: { code: string; name: string; amount: number; currency: string }[]
  expenseItems?: { code: string; name: string; amount: number; currency: string }[]
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
        fetch(dateFrom && dateTo ? `/api/reports/balance-sheet?from=${dateFrom}&to=${dateTo}` : '/api/reports/balance-sheet'),
        fetch(dateFrom && dateTo ? `/api/reports/profit-loss?from=${dateFrom}&to=${dateTo}` : '/api/reports/profit-loss'),
      ])
      
      if (bsRes.ok) {
        const bs = await bsRes.json()
        const accounts = bs.accounts || []
        setBalanceSheet({
          ...bs,
          assets: accounts.filter((a: AccountBalance) => a.type === 'ASSET'),
          liabilities: accounts.filter((a: AccountBalance) => a.type === 'LIABILITY'),
          equity: accounts.filter((a: AccountBalance) => a.type === 'EQUITY'),
          assetsTotal: accounts.filter((a: AccountBalance) => a.type === 'ASSET').reduce((sum: number, a: AccountBalance) => sum + a.balance, 0),
          liabilitiesTotal: accounts.filter((a: AccountBalance) => a.type === 'LIABILITY').reduce((sum: number, a: AccountBalance) => sum + a.balance, 0),
          equityTotal: accounts.filter((a: AccountBalance) => a.type === 'EQUITY').reduce((sum: number, a: AccountBalance) => sum + a.balance, 0),
        })
      }
      
      if (plRes.ok) {
        const pl = await plRes.json()
        setProfitLoss({
          revenue: pl.revenue?.total ?? 0,
          expenses: pl.expenses?.total ?? 0,
          netIncome: pl.netIncome ?? 0,
          taxSummary: pl.taxSummary ? {
            input: pl.taxSummary.inputTax ?? 0,
            output: pl.taxSummary.outputTax ?? 0,
            net: pl.taxSummary.netTax ?? 0,
          } : undefined,
          byCurrency: pl.byCurrency as ProfitLoss['byCurrency'],
          revenueItems: pl.revenue?.items ?? [],
          expenseItems: pl.expenses?.items ?? [],
        })
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
        <h1 className="text-xl font-semibold">{t('reports.title')}</h1>
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
                <div className="text-emerald-400 font-medium mb-2 flex justify-between">
                  <span>Assets</span>
                  <span className="font-mono">{formatCurrency(balanceSheet.assetsTotal ?? 0)}</span>
                </div>
                <div className="space-y-1">
                  {balanceSheet.assets && balanceSheet.assets.length > 0 ? (
                    balanceSheet.assets.map(a => (
                      <div key={a.code} className="flex justify-between text-xs">
                        <span>{a.code} - {a.name}</span>
                        <span className="font-mono text-emerald-400">{formatCurrency(a.balance, a.currency)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-zinc-500 pl-2">{t('reports.noAssets')}</div>
                  )}
                </div>
              </div>
              
              <div>
                <div className="text-amber-400 font-medium mb-2 flex justify-between">
                  <span>Liabilities</span>
                  <span className="font-mono">{formatCurrency(balanceSheet.liabilitiesTotal ?? 0)}</span>
                </div>
                <div className="space-y-1">
                  {balanceSheet.liabilities && balanceSheet.liabilities.length > 0 ? (
                    balanceSheet.liabilities.map(a => (
                      <div key={a.code} className="flex justify-between text-xs">
                        <span>{a.code} - {a.name}</span>
                        <span className="font-mono text-amber-400">{formatCurrency(a.balance, a.currency)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-zinc-500 pl-2">{t('reports.noLiabilities')}</div>
                  )}
                </div>
              </div>
              
              <div>
                <div className="text-purple-400 font-medium mb-2 flex justify-between">
                  <span>Equity</span>
                  <span className="font-mono">{formatCurrency(balanceSheet.equityTotal ?? 0)}</span>
                </div>
                <div className="space-y-1">
                  {balanceSheet.equity && balanceSheet.equity.length > 0 ? (
                    balanceSheet.equity.map(a => (
                      <div key={a.code} className="flex justify-between text-xs">
                        <span>{a.code} - {a.name}</span>
                        <span className="font-mono text-purple-400">{formatCurrency(a.balance, a.currency)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-zinc-500 pl-2">{t('reports.noEquity')}</div>
                  )}
                </div>
              </div>
              
              <div className="text-xs pt-2 border-t border-zinc-700">
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
              <div>
                <div className="text-emerald-400 font-medium mb-1">{t('profitLoss.revenue')}</div>
                <div className="space-y-1 pl-2">
                  {profitLoss.revenueItems && profitLoss.revenueItems.length > 0 ? (
                    profitLoss.revenueItems.map((item) => (
                      <div key={item.code} className="flex justify-between text-xs">
                        <span>{item.code} - {item.name}</span>
                        <span>{formatCurrency(item.amount, item.currency)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-zinc-500 text-xs">{t('profitLoss.noRevenue')}</div>
                  )}
                </div>
                <div className="border-t border-zinc-700 pt-1 mt-1 font-medium flex justify-between">
                  <span>Total</span>
                  <span className="text-emerald-400">{formatCurrency(profitLoss.revenue)}</span>
                </div>
              </div>
              
              <div>
                <div className="text-rose-400 font-medium mb-1">{t('profitLoss.expenses')}</div>
                <div className="space-y-1 pl-2">
                  {profitLoss.expenseItems && profitLoss.expenseItems.length > 0 ? (
                    profitLoss.expenseItems.map((item) => (
                      <div key={item.code} className="flex justify-between text-xs">
                        <span>{item.code} - {item.name}</span>
                        <span>{formatCurrency(item.amount, item.currency)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-zinc-500 text-xs">{t('profitLoss.noExpenses')}</div>
                  )}
                </div>
                <div className="border-t border-zinc-700 pt-1 mt-1 font-medium flex justify-between">
                  <span>Total</span>
                  <span className="text-rose-400">{formatCurrency(profitLoss.expenses)}</span>
                </div>
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