'use client'

import { ReactNode, useState, useEffect } from 'react'
import AccountsPanel from './AccountsPanel'
import JournalEntriesPanel from './JournalEntriesPanel'
import ReportsPanel from './ReportsPanel'
import ProfitLossPanel from './ProfitLossPanel'
import AuditLogPanel from './AuditLogPanel'
import AdminPanel from './AdminPanel'
import SummaryBar from './SummaryBar'
import NewJournalEntryModal from './NewJournalEntryModal'
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
    checkBootstrap()
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
      <div className="flex h-screen">
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
    )
  }

  return (
    <div className="flex h-screen">
      {/* Left: Chat (primary interface) */}
      <div className="w-2/5 border-r border-zinc-800 flex flex-col">
        {children}
      </div>

      {/* Right: Dynamic Context Panel */}
      <div className="flex-1 p-6 overflow-auto bg-zinc-900">
        <div className="max-w-5xl mx-auto space-y-8">
          <SummaryBar />
          <AccountsPanel
            onSelectAccount={setSelectedAccount}
            selectedAccountId={selectedAccount?.id}
          />
          <JournalEntriesPanel filterAccountId={selectedAccount?.code} />
          <ReportsPanel />
          <ProfitLossPanel />
          <AuditLogPanel />
          <AdminPanel />
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
