'use client'

import { ReactNode, useState, useEffect, Suspense, useCallback, useMemo } from 'react'
import AccountsPanel from './AccountsPanel'
import JournalEntriesPanel from './JournalEntriesPanel'
import ReportsPanel from './ReportsPanel'
import AuditLogPanel from './AuditLogPanel'
import SummaryBar from './SummaryBar'
import PendingFxPanel from './PendingFxPanel'
import LatestRealRates from './LatestRealRates'
import NewJournalEntryModal from './NewJournalEntryModal'
import TopBar from './TopBar'
import { NewEntryProvider, useNewEntry } from './NewEntryContext'
import InvoicingPanel from './InvoicingPanel'
import LedgerView from './LedgerView'
import GitModelBootstrap from './GitModelBootstrap'
import GitModelControls from './GitModelControls'
import BooksViewIndicator from './BooksViewIndicator'
import ReceiptsPanel from './ReceiptsPanel'
import RecurringJournalPanel from './RecurringJournalPanel'
import ClaimsPanel from './ClaimsPanel'
import { useTranslations } from 'next-intl'
import toast from 'react-hot-toast'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'

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
  const [showRecurring, setShowRecurring] = useState(false)
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean | null>(null)

  useEffect(() => {
    if (pathname === '/reports') router.replace('/app?view=reports')
    else if (pathname === '/contacts') router.replace('/app?view=contacts')
    else if (pathname === '/invoicing') router.replace('/app?view=invoicing')
  }, [pathname, router])

  const rawView = searchParams?.get('view')
  const hasAccountParam = !!(searchParams?.get('accountCode') || searchParams?.get('account'))
  const view = (rawView as 'dashboard' | 'contacts' | 'invoicing' | 'reports' | 'ledger' | 'receipts' | 'claims' | 'journal' | 'history') ?? (hasAccountParam ? 'ledger' : 'dashboard')
  const ledgerAccountCode = searchParams?.get('accountCode') || searchParams?.get('account') || undefined

  // Git Model for Accounting: branch + asOf (point in time / branch view)
  const currentBranch = searchParams?.get('branch') || 'main'
  const asOf = searchParams?.get('asOf') || searchParams?.get('asof') || undefined

  // Support chat-driven ledger open (Git model: also carries branch/asOf when provided)
  useEffect(() => {
    const handler = (e: Event & { detail?: { code?: string; from?: string; to?: string; search?: string; branch?: string; asOf?: string } }) => {
      const d = (e as Event & { detail?: Record<string, unknown> }).detail || {}
      const code = typeof d.code === 'string' ? d.code : undefined
      if (code) {
        const params = new URLSearchParams(searchParams?.toString() || '')
        params.set('view', 'ledger')
        params.set('accountCode', code)
        if (typeof d.from === 'string') params.set('from', d.from)
        if (typeof d.to === 'string') params.set('to', d.to)
        if (typeof d.search === 'string') params.set('search', d.search)
        if (typeof d.branch === 'string') params.set('branch', d.branch)
        if (typeof d.asOf === 'string') params.set('asOf', d.asOf)
        router.push(`${pathname}?${params.toString()}`)
      }
    }
    window.addEventListener('open-ledger', handler)
    return () => window.removeEventListener('open-ledger', handler)
  }, [router, pathname, searchParams])

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

  useEffect(() => {
    if (needsBootstrap) router.replace('/auth/signin')
  }, [needsBootstrap, router])

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
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Opening initial setup...
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="no-print">
        <TopBar showSettings={true} />
      </div>

      <div className="flex flex-1 min-h-0">
        <div className={`no-print w-full md:w-2/5 border-r border-zinc-800 flex-col ${isOpen ? 'hidden md:flex' : 'flex'}`}>
          {children}
        </div>

        <div className={`${isOpen ? 'block' : 'hidden md:block'} flex-1 p-4 md:p-6 overflow-auto bg-zinc-900`}>
          <div className="max-w-5xl mx-auto space-y-8">
            {isOpen ? (
              <NewJournalEntryModal
                isOpen={isOpen}
                onClose={closeNewEntry}
                onSuccess={handleModalSuccess}
                initialSuggestion={suggestion}
              />
            ) : (
              <>
            {/* Persistent view indicator for Git model (branch / asOf) — shown on dashboard and ledger */}
            <ErrorBoundary>
              <BooksViewIndicator />
            </ErrorBoundary>

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

                {/* Git Model controls (branch selector, asOf, recent commits, reconcile, merge, tag, etc.)
                    are ONLY available in the dedicated Git view: /app?view=history
                    All other views still honor ?branch and ?asOf from the URL if present. */}

                {/* Live dashboard main grid:
                    - lg: 3 columns for the primary live sections
                    - xl and above: allow up to 6 columns for denser layouts / future widgets
                */}
                <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-6 gap-6">
                  <div className="lg:col-span-3 xl:col-span-6">
                    {/* Dashboard shows only the 5 most recent entries. Full journal with pagination is at ?view=journal */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium text-zinc-300">Recent entries</div>
                      <div className="flex items-center gap-2">
                         <button
                           onClick={() => router.push('/app?view=journal')}
                           className="text-[10px] px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                           title="Open the full journal with pagination"
                         >
                           {t('summary.viewAll')}
                         </button>
                      </div>
                    </div>
                    <ErrorBoundary>
                      <JournalEntriesPanel
                        filterAccountId={selectedAccount?.code}
                        branch={currentBranch}
                        asOf={asOf}
                        limit={5}
                        showPagination={false}
                      />
                    </ErrorBoundary>
                  </div>

                  {/* Chart of Accounts, P&L, Templates and Processor Feeds have moved to their own
                      dedicated pages (see top nav + Admin). The dashboard is now a focused summary. */}

                    {/* Latest real rates used — calm, read-only (replaces old technical "Recent authoritative feed rates" button) */}
                    <div className="lg:col-span-3 xl:col-span-6">
                      <ErrorBoundary>
                        <LatestRealRates />
                      </ErrorBoundary>
                    </div>

                    {/* Pending FX provisional items - first class on dashboard */}
                   <div className="lg:col-span-3 xl:col-span-6">
                     <div className="text-sm font-medium text-zinc-300 mb-2">Pending FX (provisional rates)</div>
                     <ErrorBoundary>
                       <PendingFxPanel />
                     </ErrorBoundary>
                   </div>
                 </div>
              </>
            )}

 {view === 'contacts' && (
                <ContactsContent />
               )}

              {view === 'invoicing' && (
                 <InvoicingPanel />
               )}

                {view === 'reports' && (
                  <ReportsContent />
                )}

                  {view === 'ledger' && ledgerAccountCode && (
                    <LedgerView accountCode={ledgerAccountCode} branch={currentBranch} asOf={asOf} />
                  )}

                  {view === 'ledger' && !ledgerAccountCode && (
                    <div className="p-6">
                      <div className="mb-6">
                        <h1 className="text-2xl font-semibold tracking-tight">Ledger</h1>
                        <p className="text-sm text-zinc-400 mt-1 max-w-prose">
                          A ledger shows the activity and running balance for <span className="text-zinc-200">one specific account</span> over time — like a bank statement for that account.
                          It includes the full double-entry of each transaction for context.
                        </p>
                        <p className="text-sm text-zinc-400 mt-3">Select an account to begin.</p>
                      </div>

                      <ErrorBoundary>
                        <AccountsPanel branch={currentBranch} asOf={asOf} />
                      </ErrorBoundary>
                    </div>
                  )}

                 {view === 'receipts' && (
                   <ReceiptsPanel />
                 )}

                 {view === 'claims' && (
                   <ClaimsPanel />
                 )}

                  {/* Full journal view (all entries, with pagination). 5 most recent stay on dashboard. */}
                  {view === 'journal' && (
                    <div className="p-4">
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <h1 className="text-xl font-semibold">Journal</h1>
                          <p className="text-xs text-zinc-500 mt-1">All journal entries with pagination.</p>
                        </div>
                        <button
                          onClick={() => setShowRecurring(v => !v)}
                          className="text-xs px-3 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                        >
                          {showRecurring ? 'Show entries' : 'Recurring schedules'}
                        </button>
                      </div>
                      {showRecurring ? (
                        <ErrorBoundary>
                          <RecurringJournalPanel />
                        </ErrorBoundary>
                      ) : (
                        <ErrorBoundary>
                          <JournalEntriesPanel
                            filterAccountId={selectedAccount?.code}
                            branch={currentBranch}
                            asOf={asOf}
                            showPagination={true}
                          />
                        </ErrorBoundary>
                      )}
                    </div>
                  )}

                   {/* Dedicated Git view: full Git Model controls + complete commit history */}
                   {view === 'history' && (
                     <div className="p-4 space-y-6">
                       <div>
                         <h1 className="text-xl font-semibold">Commit History</h1>
                         <p className="text-xs text-zinc-500 mt-1">
                           Branching, point-in-time views, reconcile, merge, tagging, and the full immutable commit log.
                         </p>
                       </div>

                       {/* The complete Git toolbar (branch, asOf, recent commits, reconcile, merge, tag, etc.) */}
                       <ErrorBoundary>
                         <GitModelControls />
                       </ErrorBoundary>

                       {/* Full commit history list */}
                       <div>
                         <div className="mb-2 text-sm font-medium text-zinc-300">Commits</div>
                         <ErrorBoundary>
                           <AuditLogPanel />
                         </ErrorBoundary>
                       </div>
                     </div>
                   )}
              </>
            )}
             </div>
        </div>
      </div>

      {/* Git Model for Accounting bootstrap (ensures main branch etc.) */}
      <GitModelBootstrap />
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
  const [showForm, setShowForm] = useState(false)
  const [editingContact, setEditingContact] = useState<ContactItem | null>(null)

  // Quick stats like InvoicingPanel
  const [stats, setStats] = useState<{ total: number; customers: number; vendors: number }>({ total: 0, customers: 0, vendors: 0 })
  
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
        limit: '100',
      })
      if (search) params.set('search', search)
      if (typeFilter !== 'ALL') params.set('type', typeFilter)

      const res = await fetch(`/api/contacts?${params}`)
      if (res.ok) {
        const data = await res.json()
        const list: ContactItem[] = data.contacts || []
        setContacts(list)

        // Compute stats (like InvoicingPanel)
        const total = list.length
        const customers = list.filter(c => c.type === 'CUSTOMER').length
        const vendors = list.filter(c => c.type === 'VENDOR').length
        setStats({ total, customers, vendors })
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [search, typeFilter])

  useEffect(() => {
    void fetchContacts()
  }, [fetchContacts])

  // Autonomous execution refresh for contacts
  useEffect(() => {
    const h = () => void fetchContacts()
    window.addEventListener('contacts-updated', h)
    window.addEventListener('journal-updated', h)
    return () => {
      window.removeEventListener('contacts-updated', h)
      window.removeEventListener('journal-updated', h)
    }
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
    setShowForm(true)
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
    setShowForm(false)
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

  const deleteContact = async (contactId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!confirm('Delete this contact? This cannot be undone if they have related entries.')) return
    try {
      const res = await fetch(`/api/contacts/${contactId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || 'Failed to delete contact')
        return
      }
      toast.success('Contact deleted')
    } catch {
      toast.error('Failed to delete contact')
      return
    }
    setShowForm(false)
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

  // Listen for chat-triggered "open contact form in focus"
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      if (detail.id) {
        const found = contacts.find(c => c.id === detail.id)
        if (found) {
          populateForm(found)
          // scroll the form into view and focus
          setTimeout(() => {
            const formEl = document.getElementById('contact-form-section')
            formEl?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            const nameInput = formEl?.querySelector('input') as HTMLInputElement | null
            nameInput?.focus()
            nameInput?.select()
          }, 60)
        } else {
          // not in current page, still open form with partial data
          resetForm()
          if (detail.prefill?.name) setNewName(detail.prefill.name)
          setShowForm(true)
          setTimeout(() => {
            const formEl = document.getElementById('contact-form-section')
            formEl?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            const nameInput = formEl?.querySelector('input') as HTMLInputElement | null
            nameInput?.focus()
          }, 80)
        }
      } else if (detail.prefill) {
        resetForm()
        if (detail.prefill.name) setNewName(detail.prefill.name)
        setShowForm(true)
        setTimeout(() => {
          const formEl = document.getElementById('contact-form-section')
          formEl?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          const nameInput = formEl?.querySelector('input') as HTMLInputElement | null
          nameInput?.focus()
        }, 80)
      }
    }
    window.addEventListener('open-contact-form', handler)
    return () => window.removeEventListener('open-contact-form', handler)
  }, [contacts])



  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Contacts</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Manage customers and vendors.
          </p>
        </div>
        <button
          onClick={() => { setShowForm(true); resetForm(); setEditingContact(null); }}
          className="px-3 py-1.5 rounded bg-emerald-500 text-black font-medium text-sm hover:bg-emerald-400"
        >
          Add Contact
        </button>
      </div>

      {/* Quick stats (mirrors InvoicingPanel) */}
      <div className="mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <div className="text-[10px] text-zinc-400">Total</div>
          <div className="text-lg font-semibold tabular-nums mt-0.5">{stats.total}</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <div className="text-[10px] text-emerald-400">Customers</div>
          <div className="text-lg font-semibold tabular-nums mt-0.5 text-emerald-400">{stats.customers}</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <div className="text-[10px] text-amber-400">Vendors</div>
          <div className="text-lg font-semibold tabular-nums mt-0.5 text-amber-400">{stats.vendors}</div>
        </div>
      </div>

      {/* Filters row (search + type). "Add Contact" is now top-right like "New Invoice" */}
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
      </div>

      {/* Contact form (rendered above the list when open, exactly like the invoice create/edit form) */}
      {showForm && (
        <div id="contact-form-section" className="mb-8 border border-zinc-700 rounded-lg p-4 bg-zinc-950">
          <div className="flex items-center justify-between mb-4">
            <div className="font-medium">{editingContact ? 'Edit Contact' : 'Add Contact'}</div>
            <button onClick={() => { setShowForm(false); resetForm() }} className="text-2xl leading-none px-2 text-zinc-400 hover:text-rose-400" aria-label="Close">×</button>
          </div>

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
              onClick={() => { setShowForm(false); resetForm() }}
              className="px-4 py-2 rounded bg-zinc-800 text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Contact list (accordion rows like invoices; form above when open) */}
      {loading ? (
        <div className="text-zinc-500">Loading...</div>
      ) : filteredContacts.length === 0 ? (
        <div className="text-zinc-500 p-4">No contacts yet. Click &quot;Add Contact&quot; above.</div>
      ) : (
         <div className="grid grid-cols-1 gap-3">
            {filteredContacts.map(contact => (
              <div
                key={contact.id}
                className="border border-zinc-800 rounded-lg p-4 bg-zinc-950"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
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

                    <div className="mt-3 space-y-1 text-xs text-zinc-300">
                      {contact.email && (
                        <div>
                          Email: <a href={`mailto:${contact.email}`} className="text-blue-400 hover:underline">{contact.email}</a>
                        </div>
                      )}
                      {contact.phone && <div>Phone: {contact.phone}</div>}
                      {contact.taxId && <div>Tax ID: {contact.taxId}</div>}
                      {contact.website && (
                        <div>
                          Website: <a href={contact.website} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{contact.website}</a>
                        </div>
                      )}
                      {formatAddress(contact) && <div>Address: {formatAddress(contact)}</div>}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 shrink-0">
                    <button
                      onClick={() => { populateForm(contact); setShowForm(true) }}
                      className="px-3 py-1 text-xs rounded bg-emerald-700 hover:bg-emerald-600"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); void deleteContact(contact.id, e) }}
                      className="px-3 py-1 text-xs rounded bg-rose-900 text-rose-200 hover:bg-rose-800"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
         </div>
      )}



    </div>
  )
}

function ReportsContent() {
  return <ReportsPanel />
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
