'use client'

import { createContext, useContext, useState, ReactNode } from 'react'

export interface SuggestedLine {
  accountCode?: string
  debit?: number
  credit?: number
  description?: string
  taxRateId?: string   // tax foundation from chat
  currency?: string    // multi-currency from chat

  // FX metadata (populated especially from PDF + feed cross-check)
  fxRateToBase?: number
  fxSource?: string
  fxDate?: string      // YYYY-MM-DD
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
  lines?: SuggestedLine[]
  reversingOriginalId?: string   // when present, this is a reversal suggestion
  source?: 'pdf' | 'chat'        // origin of the suggestion
  needsConfirmation?: boolean    // true when currency or rate should be reviewed by user (esp. from PDF when no confident feed match)
  feedMatch?: FeedMatchInfo      // when PDF was cross-checked against a bank/card feed
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
