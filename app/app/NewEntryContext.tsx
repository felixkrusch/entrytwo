'use client'

import { createContext, useContext, useState, ReactNode } from 'react'

export interface SuggestedLine {
  accountCode?: string
  debit?: number
  credit?: number
  description?: string
  taxRateId?: string   // tax foundation from chat
  currency?: string    // multi-currency from chat
}

export interface NewEntrySuggestion {
  description?: string
  lines?: SuggestedLine[]
  reversingOriginalId?: string   // when present, this is a reversal suggestion
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
