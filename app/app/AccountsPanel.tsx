'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

interface Account {
  id: string
  code: string
  name: string
  type: string
  _count: { journalLines: number }
}

interface AccountsPanelProps {
  onSelectAccount?: (account: Account | null) => void
  selectedAccountId?: string
}

export default function AccountsPanel({ onSelectAccount, selectedAccountId }: AccountsPanelProps) {
  const t = useTranslations('app.panels.accounts')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/accounts')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setAccounts(data)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // Listen for clear filter from journal panel
  useEffect(() => {
    const handler = () => onSelectAccount?.(null)
    window.addEventListener('clear-account-filter', handler)
    return () => window.removeEventListener('clear-account-filter', handler)
  }, [onSelectAccount])

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'ASSET': return 'text-emerald-400'
      case 'LIABILITY': return 'text-amber-400'
      case 'EQUITY': return 'text-purple-400'
      case 'REVENUE': return 'text-blue-400'
      case 'EXPENSE': return 'text-rose-400'
      default: return 'text-zinc-400'
    }
  }

  const handleClick = (account: Account) => {
    if (selectedAccountId === account.id) {
      onSelectAccount?.(null)
    } else {
      onSelectAccount?.(account)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-zinc-500">
          {t('title')} {selectedAccountId && t('clearFilter')}
        </div>
        <div className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
          {t('count', { count: accounts.length })}
        </div>
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm">{t('loading')}</div>
      ) : accounts.length === 0 ? (
        <div className="text-zinc-500 text-sm">{t('noAccounts')}</div>
      ) : (
        <div className="space-y-1 text-sm">
          {accounts.map(account => (
            <div
              key={account.id}
              onClick={() => handleClick(account)}
              className={`flex items-center justify-between px-3 py-2 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer group ${
                selectedAccountId === account.id ? 'bg-zinc-800 ring-1 ring-zinc-600' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-zinc-500 w-12">{account.code}</span>
                <span>{account.name}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${getTypeColor(account.type)} bg-zinc-950`}>
                  {account.type}
                </span>
              </div>
              <div className="text-xs text-zinc-500 group-hover:text-zinc-400">
                {t('lines', { count: account._count.journalLines })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
