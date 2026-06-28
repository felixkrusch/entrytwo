'use client'

import { createContext, useContext, useState, ReactNode } from 'react'

export interface SuggestedLine {
  accountCode?: string
  debit?: number
  credit?: number
  description?: string
  taxRateId?: string
  taxIsInput?: boolean
  currency?: string
  fxRateToBase?: number
  fxSource?: string
  fxDate?: string
  contactId?: string
}

export interface FeedMatchInfo {
  matched: boolean
  baseAmount?: number
  foreignAmount?: number
  settlementCurrency?: string
  date?: string
  description?: string
  fxRateToBase?: number
  fxSource?: string
}

export interface NewEntrySuggestion {
  description?: string
  merchant?: string
  lines?: SuggestedLine[]
  reversingOriginalId?: string
  source?: 'pdf' | 'chat' | 'repeat'
  needsConfirmation?: boolean
  feedMatch?: FeedMatchInfo
  originalDate?: string
  memory?: {
    merchant?: string
    suggestedAccountCode?: string
    suggestedTaxRateId?: string
    lastUsed?: string
  }
  contact?: {
    id: string
    newlyCreated?: boolean
  }
}

interface NewEntryContextType {
  openNewEntry: (suggestion?: NewEntrySuggestion) => void
  isOpen: boolean
  suggestion: NewEntrySuggestion | null
  closeNewEntry: () => void
}

const NewEntryContext = createContext<NewEntryContextType | undefined>(undefined)

export function useNewEntry() {
  const ctx = useContext(NewEntryContext)
  if (!ctx) {
    throw new Error('useNewEntry must be used within NewEntryProvider')
  }
  return ctx
}

export function NewEntryProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [suggestion, setSuggestion] = useState<NewEntrySuggestion | null>(null)

  const openNewEntry = (sugg?: NewEntrySuggestion) => {
    setSuggestion(sugg || null)
    setIsOpen(true)
  }

  const closeNewEntry = () => {
    setIsOpen(false)
    setSuggestion(null)
  }

  return (
    <NewEntryContext.Provider value={{ openNewEntry, isOpen, suggestion, closeNewEntry }}>
      {children}
    </NewEntryContext.Provider>
  )
}