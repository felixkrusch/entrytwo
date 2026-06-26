'use client'

import { ReactNode, useState, useEffect } from 'react'
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
import AdminPanel from './AdminPanel'
import { NewEntryProvider, useNewEntry } from './NewEntryContext'
import { useTranslations } from 'next-intl'

interface Account {
  id: string
  code: string
  name: string
  type: string
}

function AppContent({ children }: { children: ReactNode }) {
  const { isOpen, suggestion, closeNewEntry } = useNewEntry()
  const t = useTranslations('app.toasts')
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null)
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean | null>(null)

  // Phase 2: allow reports / P&L / journal lines to filter by account code (interactivity)
  const handleFilterAccountByCode = (code: string) => {
    setSelectedAccount(prev => {
      if (prev && prev.code === code) return prev
      return { id: '', code, name: code, type: '' } as unknown as Account
    })
  }

  // Support clicking account codes inside the journal list
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
      setNeedsBootstrap(false) // fail open in dev
    }
  }

  useEffect(() => {
    // Defer to avoid "setState synchronously in effect" lint rule
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

  // Support "Clear filter" button from JournalEntriesPanel
  useEffect(() => {
    const handler = () => setSelectedAccount(null)
    window.addEventListener('clear-account-filter', handler)
    return () => window.removeEventListener('clear-account-filter', handler)
  }, [])

  // First-admin bootstrap gate: block the entire right panel until an ADMIN exists.
  if (needsBootstrap === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Checking setup...
      </div>
    )
  }

  if (needsBootstrap) {
    return (
      <div className="flex flex-col h-screen">
        <TopBar showSettings={false} />
        <div className="flex flex-1">
          <div className="w-2/5 border-r border-zinc-800 flex flex-col p-6 bg-zinc-950">
            <div className="text-lg font-semibold mb-1">entrytwo</div>
            <div className="text-sm text-amber-400">Initial setup required</div>
            <div className="mt-4 text-xs text-zinc-500 leading-relaxed">
              No administrator account exists yet.<br />
              Create the first ADMIN user on the right to unlock the full application.
            </div>
            <div className="mt-auto text-[10px] text-zinc-600">After creation you will get full access to chat, journal, reports, and settings.</div>
          </div>
          <div className="flex-1 p-8 overflow-auto bg-zinc-900 flex items-start justify-center">
            <div className="max-w-xl w-full">
              <AdminPanel onBootstrapComplete={checkBootstrap} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      <TopBar showSettings={true} />

      <div className="flex flex-1 min-h-0">
        {/* Left: Chat (primary interface) */}
        <div className="w-2/5 border-r border-zinc-800 flex flex-col">
          {children}
        </div>

        {/* Right: Dynamic Context Panel */}
        <div className="flex-1 p-6 overflow-auto bg-zinc-900">
          <div className="max-w-5xl mx-auto space-y-8">
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

            {/* Phase 2: visible active filter indicator for the right panel (reports/dashboard interactivity) */}
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
            <AccountsPanel
              onSelectAccount={setSelectedAccount}
              selectedAccountId={selectedAccount?.id}
              selectedAccountCode={selectedAccount?.code}
            />
            <JournalEntriesPanel filterAccountId={selectedAccount?.code} />
            <ReportsPanel onFilterAccount={handleFilterAccountByCode} currentFilterCode={selectedAccount?.code} />
            <ProfitLossPanel onFilterAccount={handleFilterAccountByCode} currentFilterCode={selectedAccount?.code} />
            <AuditLogPanel />
            <TemplatesPanel />
            <QuickFeedImport />
            <RecentFeedRates />
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

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <NewEntryProvider>
      <AppContent>{children}</AppContent>
    </NewEntryProvider>
  )
}
