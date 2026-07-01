'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

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
  selectedAccountCode?: string
}

export default function AccountsPanel({ onSelectAccount, selectedAccountId, selectedAccountCode }: AccountsPanelProps) {
  const t = useTranslations('app.panels.accounts')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  const [showAdd, setShowAdd] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'>('ASSET')
  const [isAdding, setIsAdding] = useState(false)
  const [addError, setAddError] = useState('')

  // Phase 2: search + collapsible groups
  const [search, setSearch] = useState('')
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    ASSET: true,
    LIABILITY: true,
    EQUITY: true,
    REVENUE: true,
    EXPENSE: true,
  })

  // Compute filtered list for count + rendering (search)
  const filteredAccounts = search.trim()
    ? accounts.filter(a =>
        a.code.toLowerCase().includes(search.trim().toLowerCase()) ||
        a.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        a.type.toLowerCase().includes(search.trim().toLowerCase())
      )
    : accounts

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCode, setEditCode] = useState('')
  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState<'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'>('ASSET')
  const [editError, setEditError] = useState('')
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  const fetchAccounts = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/accounts')
      const data = await res.json()
      if (Array.isArray(data)) setAccounts(data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Defer first fetch to avoid "setState synchronously in effect" lint error
    const id = setTimeout(() => { void fetchAccounts() }, 0)
    return () => clearTimeout(id)
  }, [])

  // Listen for clear filter from journal panel
  useEffect(() => {
    const handler = () => onSelectAccount?.(null)
    window.addEventListener('clear-account-filter', handler)
    return () => window.removeEventListener('clear-account-filter', handler)
  }, [onSelectAccount])

  // Phase 2 dashboard: global clear filters also clears the local search
  useEffect(() => {
    const clearAll = () => setSearch('')
    window.addEventListener('clear-all-filters', clearAll)
    return () => window.removeEventListener('clear-all-filters', clearAll)
  }, [])

  const handleAddAccount = async () => {
    if (!newCode.trim() || !newName.trim()) return
    setIsAdding(true)
    setAddError('')

    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: newCode.trim().toUpperCase(),
          name: newName.trim(),
          type: newType,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status === 409) {
          setAddError(t('errorCodeExists'))
        } else {
          setAddError(data.error || t('errorGeneric'))
        }
        return
      }

      // Success: refresh list and close form
      setNewCode('')
      setNewName('')
      setNewType('ASSET')
      setShowAdd(false)
      fetchAccounts()
    } catch {
      setAddError(t('errorGeneric'))
    } finally {
      setIsAdding(false)
    }
  }

  const startEdit = (account: Account) => {
    setEditingId(account.id)
    setEditCode(account.code)
    setEditName(account.name)
    setEditType(account.type as 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE')
    setEditError('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditError('')
  }

  const saveEdit = async () => {
    if (!editingId) return
    setIsSavingEdit(true)
    setEditError('')

    try {
      const res = await fetch(`/api/accounts/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: editCode.trim().toUpperCase(),
          name: editName.trim(),
          type: editType,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setEditError(data.error || t('errorGeneric'))
        return
      }

      setEditingId(null)
      fetchAccounts()
    } catch {
      setEditError(t('errorGeneric'))
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleDelete = async (account: Account) => {
    if (!confirm(t('deleteConfirm'))) return

    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status === 400) {
          alert(t('deleteBlocked'))
        } else {
          alert(data.error || t('errorGeneric'))
        }
        return
      }

      fetchAccounts()
    } catch {
      alert(t('errorGeneric'))
    }
  }

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

  const router = useRouter()

  const handleClick = (account: Account) => {
    // Open dedicated ledger experience (strong replacement on right side)
    // Keep using the view system for now (as decided).
    const params = new URLSearchParams()
    params.set('view', 'ledger')
    params.set('accountCode', account.code)
    router.push(`/app?${params.toString()}`)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-zinc-500 flex items-center gap-2">
          {t('title')}
          {(selectedAccountId || selectedAccountCode) && (
            <button
              onClick={() => onSelectAccount?.(null)}
              className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
            >
              {t('clearFilter')}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowAdd(!showAdd); setAddError('') }}
            className="text-xs px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-white transition"
          >
            {t('addAccount')}
          </button>
          <div className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
            {search ? `${filteredAccounts.length} / ` : ''}{t('count', { count: accounts.length })}
          </div>
        </div>
      </div>

      {/* Phase 2: quick search to tame long account list */}
      <div className="mb-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder') || 'Search accounts...'}
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1 text-sm"
        />
      </div>

      {/* Add Account Form */}
      {showAdd && (
        <div className="mb-4 p-3 rounded-lg bg-zinc-950 border border-zinc-800">
          <div className="text-xs text-zinc-400 mb-2">{t('addTitle')}</div>
          <div className="grid grid-cols-12 gap-2">
            <input
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              placeholder={t('codePlaceholder')}
              className="col-span-2 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm font-mono"
            />
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={t('namePlaceholder')}
              className="col-span-6 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
            />
            <select
              value={newType}
              onChange={e => setNewType(e.target.value as 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE')}
              className="col-span-2 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
            >
              <option value="ASSET">ASSET</option>
              <option value="LIABILITY">LIABILITY</option>
              <option value="EQUITY">EQUITY</option>
              <option value="REVENUE">REVENUE</option>
              <option value="EXPENSE">EXPENSE</option>
            </select>
            <button
              onClick={handleAddAccount}
              disabled={isAdding || !newCode.trim() || !newName.trim()}
              className="col-span-2 px-3 py-1 text-sm rounded bg-white text-black disabled:opacity-50"
            >
              {isAdding ? (t('creating') || 'Adding...') : t('create')}
            </button>
          </div>
          {addError && (
            <div className="mt-1 text-xs text-rose-400">{addError}</div>
          )}
          <button
            onClick={() => { setShowAdd(false); setAddError('') }}
            className="mt-2 text-xs text-zinc-500 hover:text-zinc-300"
          >
            {t('cancel')}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-zinc-500 text-sm">{t('loading')}</div>
      ) : accounts.length === 0 ? (
        <div className="text-zinc-500 text-sm">{t('noAccounts')}</div>
      ) : (
        <div className="space-y-2 text-sm">
          {(() => {
            const groups: Record<string, Account[]> = {}
            for (const a of filteredAccounts) {
              const t = a.type || 'OTHER'
              if (!groups[t]) groups[t] = []
              groups[t].push(a)
            }
            const order = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']
            const types = Object.keys(groups).sort((a, b) => {
              const ia = order.indexOf(a)
              const ib = order.indexOf(b)
              return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
            })

            return types.map(type => {
              const list = groups[type]
              const isOpen = openGroups[type] ?? true
              return (
                <div key={type} className="border border-zinc-800 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setOpenGroups(prev => ({ ...prev, [type]: !isOpen }))}
                    className="w-full flex items-center justify-between px-3 py-1.5 bg-zinc-950 hover:bg-zinc-900 text-left text-xs font-medium text-zinc-400"
                  >
                    <span>{type} <span className="text-zinc-600">({list.length})</span></span>
                    <span>{isOpen ? '−' : '+'}</span>
                  </button>

                  {isOpen && (
                    <div className="divide-y divide-zinc-900">
                      {list.map(account => {
                        const isEditing = editingId === account.id
                        const isSelected = selectedAccountId === account.id || selectedAccountCode === account.code

                        if (isEditing) {
                          return (
                            <div key={account.id} className="p-3 bg-zinc-950">
                              <div className="text-xs text-zinc-400 mb-1">{t('editTitle')}</div>
                              <div className="grid grid-cols-12 gap-2">
                                <input
                                  value={editCode}
                                  onChange={e => setEditCode(e.target.value)}
                                  className="col-span-2 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm font-mono"
                                />
                                <input
                                  value={editName}
                                  onChange={e => setEditName(e.target.value)}
                                  className="col-span-6 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
                                />
                                <select
                                  value={editType}
                                   onChange={e => setEditType(e.target.value as 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE')}
                                  className="col-span-2 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
                                >
                                  <option value="ASSET">ASSET</option>
                                  <option value="LIABILITY">LIABILITY</option>
                                  <option value="EQUITY">EQUITY</option>
                                  <option value="REVENUE">REVENUE</option>
                                  <option value="EXPENSE">EXPENSE</option>
                                </select>
                                <div className="col-span-2 flex gap-1">
                                  <button
                                    onClick={saveEdit}
                                    disabled={isSavingEdit}
                                    className="flex-1 px-2 py-1 text-xs rounded bg-white text-black disabled:opacity-50"
                                  >
                                    {t('save')}
                                  </button>
                                  <button
                                    onClick={cancelEdit}
                                    className="flex-1 px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700"
                                  >
                                    {t('cancel')}
                                  </button>
                                </div>
                              </div>
                              {editError && <div className="mt-1 text-xs text-rose-400">{editError}</div>}
                            </div>
                          )
                        }

                        return (
                          <div
                            key={account.id}
                            onClick={() => handleClick(account)}
                            className={`flex items-center justify-between px-3 py-2 hover:bg-zinc-800 transition-colors cursor-pointer group ${
                              isSelected ? 'bg-zinc-800 ring-1 ring-zinc-600' : ''
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-xs text-zinc-500 w-12">{account.code}</span>
                              <span>{account.name}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${getTypeColor(account.type)} bg-zinc-950`}>
                                {account.type}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <div className="text-xs text-zinc-500 group-hover:text-zinc-400">
                                {t('lines', { count: account._count.journalLines })}
                              </div>

                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => { e.stopPropagation(); startEdit(account) }}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-white"
                                >
                                  {t('edit')}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDelete(account) }}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-rose-900 hover:bg-rose-800 text-rose-200"
                                >
                                  {t('delete')}
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          })()}
        </div>
      )}
    </div>
  )
}
