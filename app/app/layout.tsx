'use client'

import { ReactNode, useState, useEffect } from 'react'
import AccountsPanel from './AccountsPanel'
import JournalEntriesPanel from './JournalEntriesPanel'
import ReportsPanel from './ReportsPanel'
import ProfitLossPanel from './ProfitLossPanel'
import AuditLogPanel from './AuditLogPanel'
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
