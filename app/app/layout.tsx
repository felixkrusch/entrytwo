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
               <InvoicingContent />
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
  addressStreet?: string
  addressCity?: string
  addressState?: string
  addressZip?: string
  addressCountry?: string
  addressLine2?: string
  taxId?: string
  website?: string
  currency?: string
  notes?: string
  entryCount: number
  vatValidated?: boolean
  vatValid?: boolean
}

const COUNTRY_CODES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
  'US', 'CA', 'CH', 'NO', 'AU', 'NZ', 'JP', 'KR', 'CN', 'IN', 'BR', 'MX',
] as const

type CountryCode = typeof COUNTRY_CODES[number]

function ContactsContent() {
  const [contacts, setContacts] = useState<ContactItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CUSTOMER' | 'VENDOR'>('ALL')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingContact, setEditingContact] = useState<ContactItem | null>(null)
  
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newType, setNewType] = useState<'CUSTOMER' | 'VENDOR'>('CUSTOMER')
  const [newPhone, setNewPhone] = useState('')
  const [newAddressStreet, setNewAddressStreet] = useState('')
  const [newAddressCity, setNewAddressCity] = useState('')
  const [newAddressState, setNewAddressState] = useState('')
  const [newAddressZip, setNewAddressZip] = useState('')
  const [newAddressCountry, setNewAddressCountry] = useState<CountryCode>('DE')
  const [newAddressLine2, setNewAddressLine2] = useState('')
  const [newTaxId, setNewTaxId] = useState('')
  const [newWebsite, setNewWebsite] = useState('')

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

  const resetForm = () => {
    setNewName('')
    setNewEmail('')
    setNewPhone('')
    setNewAddressStreet('')
    setNewAddressCity('')
    setNewAddressState('')
    setNewAddressZip('')
    setNewAddressCountry('DE')
    setNewAddressLine2('')
    setNewTaxId('')
    setNewWebsite('')
    setEditingContact(null)
  }

  const populateForm = (contact: ContactItem) => {
    setNewName(contact.name)
    setNewEmail(contact.email || '')
    setNewPhone(contact.phone || '')
    setNewAddressStreet(contact.addressStreet || '')
    setNewAddressCity(contact.addressCity || '')
    setNewAddressState(contact.addressState || '')
    setNewAddressZip(contact.addressZip || '')
    setNewAddressCountry((contact.addressCountry as CountryCode) || 'DE')
    setNewAddressLine2(contact.addressLine2 || '')
    setNewTaxId(contact.taxId || '')
    setNewWebsite(contact.website || '')
    setEditingContact(contact)
    setShowAddModal(true)
  }

  const saveContact = async () => {
    if (!newName.trim()) return
    const payload = {
      name: newName,
      email: newEmail || undefined,
      type: editingContact?.type ?? newType,
      phone: newPhone || undefined,
      addressStreet: newAddressStreet || undefined,
      addressCity: newAddressCity || undefined,
      addressState: newAddressState || undefined,
      addressZip: newAddressZip || undefined,
      addressCountry: newAddressCountry || undefined,
      addressLine2: newAddressLine2 || undefined,
      taxId: newTaxId || undefined,
      website: newWebsite || undefined,
    }

    if (editingContact) {
      await fetch(`/api/contacts/${editingContact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } else {
      await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }
    resetForm()
    setShowAddModal(false)
    void fetchContacts()
  }

  const formatAddress = (contact: ContactItem) => {
    const parts = [
      contact.addressStreet,
      contact.addressLine2,
      [contact.addressZip, contact.addressCity].filter(Boolean).join(' '),
      contact.addressState,
      contact.addressCountry,
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : null
  }

  const validateVat = async (vatId: string) => {
    try {
      const res = await fetch(`/api/contacts/validate-vat?vatId=${encodeURIComponent(vatId)}`)
      const data = await res.json()
      if (data.valid === true) {
        // Find contact with this taxId
        const contact = contacts.find(c => c.taxId === vatId)
        if (contact) {
          await fetch(`/api/contacts/validate-vat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactId: contact.id, vatValid: true, vatId: data.vatId, address: data.address }),
          })
        }
      }
      void fetchContacts()
    } catch {
      // ignore
    }
  }

  const deleteContact = async (contactId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!confirm('Delete this contact? This cannot be undone if they have related entries.')) return
    await fetch(`/api/contacts/${contactId}`, { method: 'DELETE' })
    setShowAddModal(false)
    resetForm()
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
              className="border border-zinc-800 rounded-lg p-4 bg-zinc-950 hover:border-zinc-700 transition-colors cursor-pointer"
              onClick={() => populateForm(contact)}
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
                    <a href={`mailto:${contact.email}`} className="text-xs text-blue-400 hover:underline mt-1 block" onClick={e => e.stopPropagation()}>
                      {contact.email}
                    </a>
                  )}
                  {contact.phone && (
                    <span className="text-xs text-zinc-400 mt-1 block">{contact.phone}</span>
                  )}
                  {formatAddress(contact) && (
                    <span className="text-xs text-zinc-500 mt-1 block" onClick={e => e.stopPropagation()}>
                      {formatAddress(contact)}
                    </span>
                  )}
                  {contact.website && (
                    <a href={contact.website} className="text-xs text-blue-400 hover:underline mt-1 block" onClick={e => e.stopPropagation()} target="_blank" rel="noopener noreferrer">
                      {contact.website}
                    </a>
                  )}
                  {contact.taxId && (
                    <span className="text-xs text-zinc-400 mt-1 block">Tax: {contact.taxId}</span>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {contact.taxId && (
                    <button
                      onClick={e => { e.stopPropagation(); void validateVat(contact.taxId!) }}
                      className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      title="Validate VAT"
                    >
                      Verify VAT
                    </button>
                  )}
                  {contact.vatValidated !== undefined && (
                    <span className={`text-xs ${contact.vatValid ? 'text-emerald-400' : 'text-rose-400'}`} title={contact.vatValid ? 'VAT valid' : 'VAT invalid'} onClick={e => e.stopPropagation()}>
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

      {(showAddModal || editingContact) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-4">
              {editingContact ? 'Edit Contact' : 'Add Contact'}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Name *</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                  required
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
              {!editingContact && (
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
              )}
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Phone (Intl format)</label>
                <input
                  type="text"
                  value={newPhone}
                  onChange={e => setNewPhone(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                  placeholder="+49 123 456789"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Address Line 1</label>
                <input
                  type="text"
                  value={newAddressStreet}
                  onChange={e => setNewAddressStreet(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                  placeholder="Street address"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Address Line 2</label>
                <input
                  type="text"
                  value={newAddressLine2}
                  onChange={e => setNewAddressLine2(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                  placeholder="Apartment, suite, etc."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">City</label>
                  <input
                    type="text"
                    value={newAddressCity}
                    onChange={e => setNewAddressCity(e.target.value)}
                    className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">State/Province</label>
                  <input
                    type="text"
                    value={newAddressState}
                    onChange={e => setNewAddressState(e.target.value)}
                    className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">ZIP/Postal Code</label>
                  <input
                    type="text"
                    value={newAddressZip}
                    onChange={e => setNewAddressZip(e.target.value)}
                    className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Country (ISO 3166-1)</label>
                  <select
                    value={newAddressCountry}
                    onChange={e => setNewAddressCountry(e.target.value as CountryCode)}
                    className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                  >
                    {COUNTRY_CODES.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Tax ID (VAT/EIN)</label>
                <input
                  type="text"
                  value={newTaxId}
                  onChange={e => setNewTaxId(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                  placeholder="DE276452187"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Website</label>
                <input
                  type="url"
                  value={newWebsite}
                  onChange={e => setNewWebsite(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                  placeholder="https://example.com"
                />
              </div>
            </div>
<div className="flex gap-2 mt-6">
               {editingContact && (
                 <button
                   onClick={e => void deleteContact(editingContact.id, e)}
                   className="px-3 py-2 rounded bg-rose-900/50 text-rose-400 hover:bg-rose-900/70"
                 >
                   Delete
                 </button>
               )}
               <button
                 onClick={saveContact}
                 className="flex-1 px-4 py-2 rounded bg-emerald-500 text-black font-medium"
               >
                 {editingContact ? 'Save Contact' : 'Add Contact'}
               </button>
               <button
                 onClick={() => { setShowAddModal(false); resetForm() }}
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

interface Invoice {
  id: string
  invoiceNumber: string
  status: string
  currency: string
  total: number
  subtotal: number
  taxAmount: number
  issueDate: string
  dueDate: string
  paidDate?: string
  contact: { name: string }
  lines: { description: string; quantity: number; unitPrice: number; lineTotal: number }[]
}

function InvoicingContent() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED'>('ALL')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [contacts, setContacts] = useState<{ id: string; name: string; email?: string }[]>([])
  const [processingPayment, setProcessingPayment] = useState<string | null>(null)

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/invoices?status=${statusFilter === 'ALL' ? '' : statusFilter}`)
      const data = await res.json()
      setInvoices(data.invoices || [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch('/api/contacts')
      const data = await res.json()
      setContacts(data.contacts || [])
    } catch {
      // ignore
    }
  }, [])

  const createPaymentLink = async (invoiceId: string) => {
    setProcessingPayment(invoiceId)
    try {
      const res = await fetch('/api/payments/stripe/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      })
      const data = await res.json()
      if (data.clientSecret) {
        window.open(`https://pay.stripe.com/${data.id}`, '_blank')
      }
      void fetchInvoices()
    } catch {
      // ignore
    } finally {
      setProcessingPayment(null)
    }
  }

  useEffect(() => {
    void fetchInvoices()
    void fetchContacts()
  }, [fetchInvoices, fetchContacts])

  const createInvoice = async (contactId: string, description: string, amount: number) => {
    await fetch('/api/invoices/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    })
    void fetchInvoices()
    setShowCreateModal(false)
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'PAID': return 'bg-emerald-950 text-emerald-400'
      case 'OVERDUE': return 'bg-rose-950 text-rose-400'
      case 'SENT': return 'bg-blue-950 text-blue-400'
      case 'DRAFT': return 'bg-zinc-800 text-zinc-400'
      default: return 'bg-zinc-800 text-zinc-400'
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Invoicing</h1>
          <p className="text-xs text-zinc-500 mt-1">Create and manage invoices with full branding control.</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500 text-black font-medium text-sm hover:bg-emerald-400"
        >
          <Plus className="w-4 h-4" />
          New Invoice
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search invoices..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
          className="px-2 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-sm"
        >
          <option value="ALL">All Status</option>
          <option value="DRAFT">Draft</option>
          <option value="SENT">Sent</option>
          <option value="PAID">Paid</option>
          <option value="OVERDUE">Overdue</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {loading ? (
        <div className="text-zinc-500">Loading...</div>
      ) : invoices.length === 0 ? (
        <div className="text-zinc-500">No invoices yet. Create your first invoice!</div>
      ) : (
        <div className="space-y-2">
          {invoices.map(invoice => (
            <div
              key={invoice.id}
              className="border border-zinc-800 rounded-lg p-4 bg-zinc-950 hover:border-zinc-700 transition-colors"
            >
<div className="flex items-center justify-between">
                 <div>
                   <div className="font-medium">{invoice.invoiceNumber}</div>
                   <div className="text-xs text-zinc-400">{invoice.contact.name}</div>
                   <div className="text-xs text-zinc-500 mt-1">
                     {new Date(invoice.issueDate).toLocaleDateString()} → {new Date(invoice.dueDate).toLocaleDateString()}
                   </div>
                 </div>
                 <div className="flex items-center gap-2">
                   <span className={`px-2 py-0.5 rounded text-xs ${statusColor(invoice.status)}`}>
                     {invoice.status}
                   </span>
                   <span className="font-medium">{formatCurrency(invoice.total, invoice.currency)}</span>
                   {invoice.status === 'DRAFT' && (
                     <button
                       onClick={() => void createPaymentLink(invoice.id)}
                       disabled={processingPayment === invoice.id}
                       className="p-1 rounded text-zinc-400 hover:text-emerald-400 disabled:opacity-50"
                       title="Send Invoice"
                     >
                       {processingPayment === invoice.id ? '...' : 'Send'}
                     </button>
                   )}
                 </div>
               </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-4">Create New Invoice</h2>
            <p className="text-sm text-zinc-400 mb-4">
              AI-powered invoice creation coming soon. Manual creation via API is available.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Contact</label>
                <select className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700">
                  <option>Select a contact...</option>
                  {contacts.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Description</label>
                <input
                  type="text"
                  placeholder="e.g., 'Website design for Sarah'"
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
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

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <NewEntryProvider>
      <Suspense fallback={<div className="flex h-screen items-center justify-center bg-zinc-950">Loading...</div>}>
        <AppContent>{children}</AppContent>
      </Suspense>
    </NewEntryProvider>
  )
}