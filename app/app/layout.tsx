'use client'

import { ReactNode, useState, useEffect, Suspense, useCallback, useMemo } from 'react'
import AccountsPanel from './AccountsPanel'
import JournalEntriesPanel from './JournalEntriesPanel'
import ReportsPanel from './ReportsPanel'
import ProfitLossPanel from './ProfitLossPanel'
import AuditLogPanel from './AuditLogPanel'
import SummaryBar from './SummaryBar'
import QuickFeedImport from './QuickFeedImport'
import RecentFeedRates from './RecentFeedRates'
import TemplatesPanel from './TemplatesPanel'
import NewJournalEntryModal from './NewJournalEntryModal'
import TopBar from './TopBar'
import { NewEntryProvider, useNewEntry } from './NewEntryContext'
import { useTranslations } from 'next-intl'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Search, Plus } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

interface Account {
  id: string
  code: string
  name: string
  type: string
}

function AppContent({ children }: { children: ReactNode }) {
  const { isOpen, suggestion, closeNewEntry } = useNewEntry()
  const t = useTranslations('app.toasts')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null)
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean | null>(null)

  useEffect(() => {
    if (pathname === '/reports') router.replace('/app?view=reports')
    else if (pathname === '/contacts') router.replace('/app?view=contacts')
    else if (pathname === '/invoicing') router.replace('/app?view=invoicing')
  }, [pathname, router])

  const view = (searchParams?.get('view') as 'dashboard' | 'contacts' | 'invoicing' | 'reports') ?? 'dashboard'

  const handleFilterAccountByCode = (code: string) => {
    setSelectedAccount(prev => {
      if (prev && prev.code === code) return prev
      return { id: '', code, name: code, type: '' } as unknown as Account
    })
  }

  useEffect(() => {
    const handler = (e: Event & { detail?: { code?: string } }) => {
      const code = e?.detail?.code
      if (code) handleFilterAccountByCode(code)
    }
    window.addEventListener('filter-by-account', handler)
    return () => window.removeEventListener('filter-by-account', handler)
  }, [])

  const checkBootstrap = async () => {
    try {
      const res = await fetch('/api/bootstrap/status')
      const data = await res.json()
      setNeedsBootstrap(!!data?.needsBootstrap)
    } catch {
      setNeedsBootstrap(false)
    }
  }

  useEffect(() => {
    const id = setTimeout(() => { void checkBootstrap() }, 0)
    return () => clearTimeout(id)
  }, [])

  const handleModalSuccess = () => {
    const wasFromChat = !!suggestion
    const isReversal = !!suggestion?.reversingOriginalId
    closeNewEntry()
    window.dispatchEvent(new CustomEvent('journal-updated'))
    import('react-hot-toast').then(({ default: toast }) => {
      if (isReversal) {
        toast.success(wasFromChat ? t('reversalPosted') : t('entryReversed'))
      } else {
        toast.success(wasFromChat ? t('entryCreatedFromChat') : t('entryCreated'))
      }
    })
  }

  useEffect(() => {
    const handler = () => setSelectedAccount(null)
    window.addEventListener('clear-account-filter', handler)
    return () => window.removeEventListener('clear-account-filter', handler)
  }, [])

  if (needsBootstrap === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Checking setup...
      </div>
    )
  }

  if (needsBootstrap) {
    router.replace('/app/setup')
    return null
  }

  return (
    <div className="flex flex-col h-screen">
      <TopBar showSettings={true} />

      <div className="flex flex-1 min-h-0">
        <div className="w-2/5 border-r border-zinc-800 flex flex-col">
          {children}
        </div>

        <div className="flex-1 p-6 overflow-auto bg-zinc-900">
          <div className="max-w-5xl mx-auto space-y-8">
            {view === 'dashboard' && (
              <>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-zinc-500">Dashboard • Live</div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('journal-updated'))}
                      className="text-[10px] px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                      title="Refresh all panels"
                    >
                      Refresh all
                    </button>
                    {(selectedAccount) && (
                      <button
                        onClick={() => {
                          setSelectedAccount(null)
                          window.dispatchEvent(new CustomEvent('clear-account-filter'))
                          window.dispatchEvent(new CustomEvent('clear-all-filters'))
                        }}
                        className="text-[10px] px-2 py-0.5 rounded border border-rose-800 text-rose-400 hover:bg-rose-950"
                        title="Clear all filters (accounts, journal, reports, search)"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                </div>

                {selectedAccount && (
                  <div className="flex items-center gap-2 -mt-4 mb-2">
                    <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-emerald-400 border border-zinc-700">
                      Filtered to {selectedAccount.code} {selectedAccount.name ? `— ${selectedAccount.name}` : ''}
                    </span>
                    <button
                      onClick={() => setSelectedAccount(null)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                    >
                      Clear filter
                    </button>
                  </div>
                )}

                <SummaryBar />
                <ErrorBoundary><AccountsPanel
                  onSelectAccount={setSelectedAccount}
                  selectedAccountId={selectedAccount?.id}
                  selectedAccountCode={selectedAccount?.code}
                /></ErrorBoundary>
                <ErrorBoundary><JournalEntriesPanel filterAccountId={selectedAccount?.code} /></ErrorBoundary>
                <ErrorBoundary><ReportsPanel onFilterAccount={handleFilterAccountByCode} currentFilterCode={selectedAccount?.code} /></ErrorBoundary>
                <ErrorBoundary><ProfitLossPanel onFilterAccount={handleFilterAccountByCode} currentFilterCode={selectedAccount?.code} /></ErrorBoundary>
                <ErrorBoundary><AuditLogPanel /></ErrorBoundary>
                <ErrorBoundary><TemplatesPanel /></ErrorBoundary>
                <ErrorBoundary><QuickFeedImport /></ErrorBoundary>
                <ErrorBoundary><RecentFeedRates /></ErrorBoundary>
              </>
            )}

            {view === 'contacts' && (
              <ContactsContent />
            )}

            {view === 'invoicing' && (
              <div>
                <h1 className="text-xl font-semibold mb-4">Invoicing</h1>
                <div className="text-zinc-500">Invoicing view - coming soon.</div>
              </div>
            )}

            {view === 'reports' && (
              <ReportsContent />
            )}
          </div>
        </div>
      </div>

      <NewJournalEntryModal
        isOpen={isOpen}
        onClose={closeNewEntry}
        onSuccess={handleModalSuccess}
        initialSuggestion={suggestion}
      />
    </div>
  )
}

interface ContactItem {
  id: string
  name: string
  email?: string
  type: 'CUSTOMER' | 'VENDOR'
  phone?: string
  address?: string
  taxId?: string
  currency?: string
  notes?: string
  entryCount: number
  vatValidated?: boolean
  vatValid?: boolean
}

function ContactsContent() {
  const t = useTranslations('app.panels')
  const [contacts, setContacts] = useState<ContactItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CUSTOMER' | 'VENDOR'>('ALL')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [showAddModal, setShowAddModal] = useState(false)
  
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newType, setNewType] = useState<'CUSTOMER' | 'VENDOR'>('CUSTOMER')
  const [newPhone, setNewPhone] = useState('')
  const [newTaxId, setNewTaxId] = useState('')

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '20',
      })
      if (search) params.set('search', search)
      if (typeFilter !== 'ALL') params.set('type', typeFilter)

      const res = await fetch(`/api/contacts?${params}`)
      if (res.ok) {
        const data = await res.json()
        setContacts(data.contacts || [])
        setTotalPages(data.pages || 1)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [search, typeFilter, currentPage])

  useEffect(() => {
    void fetchContacts()
  }, [fetchContacts])

  const createContact = async () => {
    if (!newName.trim()) return
    await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName,
        email: newEmail || undefined,
        type: newType,
        phone: newPhone || undefined,
        taxId: newTaxId || undefined,
      }),
    })
    setNewName('')
    setNewEmail('')
    setNewPhone('')
    setNewTaxId('')
    setShowAddModal(false)
    void fetchContacts()
  }

  const filteredContacts = useMemo(() => {
    return contacts.filter(c => {
      if (typeFilter !== 'ALL' && c.type !== typeFilter) return false
      if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && 
          !(c.email || '').toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [contacts, search, typeFilter])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Contacts</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Manage customers and vendors.
        </p>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search contacts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-sm"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as 'ALL' | 'CUSTOMER' | 'VENDOR')}
          className="px-2 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-sm"
        >
          <option value="ALL">All types</option>
          <option value="CUSTOMER">Customers</option>
          <option value="VENDOR">Vendors</option>
        </select>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500 text-black font-medium text-sm hover:bg-emerald-400"
        >
          <Plus className="w-4 h-4" />
          Add Contact
        </button>
      </div>

      {loading ? (
        <div className="text-zinc-500">Loading...</div>
      ) : filteredContacts.length === 0 ? (
        <div className="text-zinc-500">No contacts yet.</div>
      ) : (
        <div className="space-y-2">
          {filteredContacts.map(contact => (
            <div
              key={contact.id}
              className="border border-zinc-800 rounded-lg p-4 bg-zinc-950 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{contact.name}</div>
                  <div className="flex items-center gap-2 mt-1 text-xs">
                    <span className={`px-2 py-0.5 rounded ${
                      contact.type === 'CUSTOMER' 
                        ? 'bg-emerald-950 text-emerald-400' 
                        : 'bg-amber-950 text-amber-400'
                    }`}>
                      {contact.type === 'CUSTOMER' ? 'Customer' : 'Vendor'}
                    </span>
                    {contact.entryCount > 0 && (
                      <span className="text-zinc-500">{contact.entryCount} entries</span>
                    )}
                  </div>
                  {contact.email && (
                    <a href={`mailto:${contact.email}`} className="text-xs text-blue-400 hover:underline mt-1 block">
                      {contact.email}
                    </a>
                  )}
                  {contact.phone && (
                    <span className="text-xs text-zinc-400 mt-1 block">{contact.phone}</span>
                  )}
                  {contact.taxId && (
                    <span className="text-xs text-zinc-400 mt-1 block">Tax: {contact.taxId}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {contact.vatValidated !== undefined && (
                    <span className={`text-xs ${contact.vatValid ? 'text-emerald-400' : 'text-rose-400'}`} title={contact.vatValid ? 'VAT valid' : 'VAT invalid'}>
                      {contact.vatValid ? '✓' : '✗'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1 rounded bg-zinc-800 text-zinc-300 disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-sm text-zinc-500">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-1 rounded bg-zinc-800 text-zinc-300 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">Add Contact</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Type</label>
                <select
                  value={newType}
                  onChange={e => setNewType(e.target.value as 'CUSTOMER' | 'VENDOR')}
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                >
                  <option value="CUSTOMER">Customer</option>
                  <option value="VENDOR">Vendor</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Phone</label>
                <input
                  type="text"
                  value={newPhone}
                  onChange={e => setNewPhone(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                  placeholder="+49 123 456789"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Tax ID</label>
                <input
                  type="text"
                  value={newTaxId}
                  onChange={e => setNewTaxId(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                  placeholder="DE276452187"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={createContact}
                className="flex-1 px-4 py-2 rounded bg-emerald-500 text-black font-medium"
              >
                Add Contact
              </button>
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded bg-zinc-800 text-zinc-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

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

function ReportsContent() {
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
                <div className="text-zinc-400 font-medium mb-2">Assets</div>
                <div className="space-y-1">
                  {balanceSheet.assets && balanceSheet.assets.length > 0 ? (
                    balanceSheet.assets.map(a => (
                      <div key={a.code} className="flex justify-between">
                        <span>{a.code} - {a.name}</span>
                        <span>{formatCurrency(a.balance, a.currency)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-zinc-500 pl-2">{t('reports.noAssets')}</div>
                  )}
                  <div className="border-t border-zinc-700 pt-1 font-medium flex justify-between">
                    <span>Total</span>
                    <span>{formatCurrency(balanceSheet.assetsTotal ?? 0)}</span>
                  </div>
                </div>
              </div>
              
              <div>
                <div className="text-zinc-400 font-medium mb-2">Liabilities</div>
                <div className="space-y-1">
                  {balanceSheet.liabilities && balanceSheet.liabilities.length > 0 ? (
                    balanceSheet.liabilities.map(a => (
                      <div key={a.code} className="flex justify-between">
                        <span>{a.code} - {a.name}</span>
                        <span>{formatCurrency(a.balance, a.currency)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-zinc-500 pl-2">{t('reports.noLiabilities')}</div>
                  )}
                  <div className="border-t border-zinc-700 pt-1 font-medium flex justify-between">
                    <span>Total</span>
                    <span>{formatCurrency(balanceSheet.liabilitiesTotal ?? 0)}</span>
                  </div>
                </div>
              </div>
              
              <div>
                <div className="text-zinc-400 font-medium mb-2">Equity</div>
                <div className="space-y-1">
                  {balanceSheet.equity && balanceSheet.equity.length > 0 ? (
                    balanceSheet.equity.map(a => (
                      <div key={a.code} className="flex justify-between">
                        <span>{a.code} - {a.name}</span>
                        <span>{formatCurrency(a.balance, a.currency)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-zinc-500 pl-2">{t('reports.noEquity')}</div>
                  )}
                  <div className="border-t border-zinc-700 pt-1 font-medium flex justify-between">
                    <span>Total</span>
                    <span>{formatCurrency(balanceSheet.equityTotal ?? 0)}</span>
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

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <NewEntryProvider>
      <Suspense fallback={<div className="flex h-screen items-center justify-center bg-zinc-950">Loading...</div>}>
        <AppContent>{children}</AppContent>
      </Suspense>
    </NewEntryProvider>
  )
}