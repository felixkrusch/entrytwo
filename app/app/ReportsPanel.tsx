'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useFormatter } from 'next-intl'

interface AccountBalance {
  code: string
  name: string
  type: string
  balance: number          // base-currency (EUR) total
  currency?: string        // dominant/original currency for the account
  baseCurrency?: string
  nativeBalance?: number   // sum in the dominant currency (if different)
}

interface BSData {
  accounts: AccountBalance[]
  byCurrency?: Record<string, { native: number; base: number }>
}

interface ReportsPanelProps {
  onFilterAccount?: (code: string) => void
}

export default function ReportsPanel({ onFilterAccount }: ReportsPanelProps) {
  const t = useTranslations('app.panels.reports')
  const format = useFormatter()
  const [data, setData] = useState<BSData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchBalances = () => {
    fetch('/api/reports/balance-sheet')
      .then(res => res.json())
      .then((d: any) => {
        if (Array.isArray(d)) {
          setData({ accounts: d })
        } else if (d && Array.isArray(d.accounts)) {
          setData(d)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchBalances()

    const handler = () => fetchBalances()
    window.addEventListener('journal-updated', handler)
    return () => window.removeEventListener('journal-updated', handler)
  }, [])

  const balances = data?.accounts || []
  const assets = balances.filter(b => b.type === 'ASSET')
  const liabilities = balances.filter(b => b.type === 'LIABILITY')
  const equity = balances.filter(b => b.type === 'EQUITY')

  const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0)
  const totalLiabilities = liabilities.reduce((sum, a) => sum + a.balance, 0)
  const totalEquity = equity.reduce((sum, a) => sum + a.balance, 0)

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-zinc-500">{t('title')}</div>
        <div className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-400">{t('live')}</div>
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm">{t('loading')}</div>
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
                onClick={() => onFilterAccount?.(a.code)}
                className="flex justify-between py-1 border-b border-zinc-800 pl-2 cursor-pointer hover:bg-zinc-800/60"
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
                onClick={() => onFilterAccount?.(a.code)}
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
                onClick={() => onFilterAccount?.(a.code)}
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
              {Object.entries(data.byCurrency).sort().map(([cur, v]: any) => (
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
