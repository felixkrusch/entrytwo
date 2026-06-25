'use client'

import { useState, useRef } from 'react'
import { Send, Paperclip, Mic, Lock, Unlock } from 'lucide-react'
import toast from 'react-hot-toast'
import { useNewEntry, NewEntrySuggestion } from './NewEntryContext'
import { useTranslations } from 'next-intl'

interface Message {
  role: 'user' | 'assistant'
  content: string
  action?: 'suggest_entry'
  suggestion?: NewEntrySuggestion
}

export default function ChatPage() {
  const { openNewEntry } = useNewEntry()
  const t = useTranslations('app.chat')
  const tToasts = useTranslations('app.toasts')

  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: t('welcome') }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Chat Lock: when true, chat is advisory only. No create/modify/reverse actions allowed.
  // This is a deliberate safety control (see docs for rationale).
  const [isChatLocked, setIsChatLocked] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('chatLocked') === 'true'
    }
    return false
  })

  // Persist lock state
  const toggleChatLock = () => {
    const next = !isChatLocked
    setIsChatLocked(next)
    if (typeof window !== 'undefined') {
      localStorage.setItem('chatLocked', String(next))
    }
    toast.success(next ? t('lockedToast') : t('unlockedToast'))
  }

  // Client fallback (used only if /api/chat fails). Server version is much smarter.
  const generateResponse = (text: string): { response: string; suggestion?: NewEntrySuggestion } => {
    const lower = text.toLowerCase().trim()
    const amountMatch = text.match(/(\d+[\.,]?\d*)/)
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '.')) : 100

    // Multi-currency detection in fallback (Phase 0)
    const currency = /usd|\$|dollars/.test(lower) ? 'USD' : (/eur|euro/.test(lower) ? 'EUR' : 'EUR')

    let response = ''
    let suggestion: NewEntrySuggestion | undefined

    if (lower.includes('reverse')) {
      response = 'Use the chat to reverse the most recent unreversed entry. It will prefill the reversal lines.'
    } else if (lower.includes('supplies') || lower.includes('office supplies')) {
      response = `Office supplies ~${amount}. Debit Office Supplies (5000), credit Cash (1000).`
      suggestion = {
        description: text,
        lines: [
          { accountCode: '5000', debit: amount, description: 'Office supplies', currency },
          { accountCode: '1000', credit: amount, description: 'Cash paid', currency }
        ]
      }
    } else if (lower.includes('software') || lower.includes('subscription')) {
      response = `Software ~${amount}. Debit Software & Subscriptions (5100), credit Cash (1000).`
      suggestion = {
        description: text,
        lines: [
          { accountCode: '5100', debit: amount, description: 'Software', currency },
          { accountCode: '1000', credit: amount, currency }
        ]
      }
    } else if (lower.includes('professional') || lower.includes('consult') || lower.includes('services')) {
      response = `Professional services ~${amount}.`
      suggestion = {
        description: text,
        lines: [
          { accountCode: '5200', debit: amount, currency },
          { accountCode: '1000', credit: amount, currency }
        ]
      }
    } else if (lower.includes('revenue') || lower.includes('client paid') || lower.includes('received')) {
      response = `Revenue ~${amount}. Bank (1100) debit + Revenue (4000) credit.`
      suggestion = {
        description: text,
        lines: [
          { accountCode: '1100', debit: amount, description: 'Bank deposit', currency },
          { accountCode: '4000', credit: amount, description: 'Revenue earned', currency }
        ]
      }
    } else if (lower.includes('invoice') || lower.includes('bill') || lower.includes('payable')) {
      response = `Expense via payable ~${amount}.`
      suggestion = {
        description: text,
        lines: [
          { accountCode: '5200', debit: amount, currency },
          { accountCode: '2000', credit: amount, description: 'Accounts payable', currency }
        ]
      }
    } else if (lower.includes('equity') || lower.includes('owner') || lower.includes('capital')) {
      response = `Owner contribution ~${amount}.`
      suggestion = {
        description: text,
        lines: [
          { accountCode: '1000', debit: amount, currency },
          { accountCode: '3000', credit: amount, currency }
        ]
      }
    } else if (lower.includes('journal') || lower.includes('entry')) {
      response = 'Manual journal entry.'
      suggestion = {
        description: text || 'Manual entry',
        lines: [
          { accountCode: '1000', debit: amount, currency },
          { accountCode: '3000', credit: amount, currency }
        ]
      }
    } else if (lower.includes('cash') && lower.includes('balance')) {
      response = 'Ask the chat "what is my cash balance?" for a live number.'
    } else if (lower.includes('balance') || lower.includes('report') || lower.includes('asset') || lower.includes('net')) {
      response = 'Live Balance Sheet, P&L and Summary are on the right. Or ask the chat for specific numbers.'
    } else if (lower.includes('account') || lower.includes('chart')) {
      response = 'Chart of accounts is on the right.'
    } else {
      response = "I can draft journal entries. Try 'bought supplies for 65', 'client paid 800', or 'reverse last entry'."
    }

    // Phase 1: client fallback non-EUR → needs confirmation.
    // Also extract merchant (e.g. "Adobe invoice") for future feed rate lookup.
    const merchantMatch = text.match(/from\s+([A-Za-z0-9 .&'-]+)/i)
    const extractedMerchant = merchantMatch ? merchantMatch[1].trim() : undefined

    if (suggestion) {
      if (currency !== 'EUR') {
        suggestion = { ...suggestion, needsConfirmation: true }
      }
      if (extractedMerchant && !suggestion.merchant) {
        suggestion = { ...suggestion, merchant: extractedMerchant }
      }
    }

    return { response, suggestion }
  }

  const sendMessage = async () => {
    if (!input.trim()) return

    const userMessage: Message = { role: 'user', content: input }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    const current = input
    setInput('')
    setIsLoading(true)

    try {
      const history = newMessages.slice(-8).map(m => ({
        role: m.role,
        content: m.content
      }))

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history })
      })

      if (!res.ok) {
        throw new Error('Chat request failed')
      }

      const data = await res.json()

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response || 'Got it.',
        action: data.suggestion ? 'suggest_entry' : undefined,
        suggestion: data.suggestion
      }])
    } catch {
      toast.error(tToasts('chatError') || 'Chat service unavailable, using local fallback.')
      const { response, suggestion } = generateResponse(current)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: response,
        action: suggestion ? 'suggest_entry' : undefined,
        suggestion
      }])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleSuggest = (suggestion?: NewEntrySuggestion) => {
    if (isChatLocked) {
      toast.error(t('lockedToast') || 'Chat is locked (advisory mode). Unlock to allow actions.')
      return
    }
    openNewEntry(suggestion)
  }

  const handleAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const lowerName = file.name.toLowerCase()
    const isPdf = lowerName.endsWith('.pdf')
    const isImage = /\.(jpg|jpeg|png|webp)$/.test(lowerName) || file.type.startsWith('image/')

    if (!isPdf && !isImage) {
      toast.error('Please select a PDF or image (jpg, jpeg, png, webp)')
      e.target.value = ''
      return
    }

    e.target.value = ''

    if (isPdf) {
      const formData = new FormData()
      formData.append('file', file)

      const loadingId = toast.loading(t('pdfProcessing'))
      try {
        const res = await fetch('/api/invoices/process', { method: 'POST', body: formData })
        const data = await res.json()
        toast.dismiss(loadingId)

        if (data.text) {
          const preview = data.text.substring(0, 280) + (data.text.length > 280 ? '...' : '')

          const det = data.detected || {}
          const detectedCurrency = det.currency || 'EUR'
          const detectedTotal = typeof det.total === 'number' ? det.total : null
          const amount = detectedTotal ?? 100

          const apiSuggestion = data.suggestion
          const pdfSuggestion: NewEntrySuggestion = apiSuggestion
            ? {
                description: apiSuggestion.description,
                lines: apiSuggestion.lines,
              }
            : {
                description: `Invoice: ${file.name}${det.vendor ? ` — ${det.vendor}` : ''}`,
                lines: [
                  { accountCode: '5200', debit: amount, description: 'Expense from invoice', currency: detectedCurrency },
                  { accountCode: '2000', credit: amount, description: 'Accounts payable', currency: detectedCurrency }
                ]
              }

          const currencyNote = det.currency
            ? `Detected currency: ${det.currency} (confidence: ${det.currencyConfidence || 'low'})`
            : 'Currency not confidently detected from PDF.'

          const taxNote = det.tax
            ? `Detected tax: ${det.tax.jurisdiction} ${det.tax.name} (${(det.tax.rate * 100).toFixed(0)}%)`
            : ''

          const needsConfirm = apiSuggestion?.needsConfirmation || (!det.currency || det.currencyConfidence === 'low')

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `Extracted from ${file.name}:\n${preview}\n\n${currencyNote}${taxNote ? `\n${taxNote}` : ''}${detectedTotal ? `\nGuessed total: ${detectedTotal}` : ''}\n\n${needsConfirm ? 'Please review currency, tax, and amounts and confirm before posting.' : 'Review the suggestion.'}`,
            action: 'suggest_entry',
            suggestion: {
              ...pdfSuggestion,
              source: 'pdf',
              needsConfirmation: needsConfirm,
            }
          }])

          toast.success(t('pdfParsed'))
        } else {
          toast.dismiss(loadingId)
          toast.error(t('pdfNoText'))
        }
      } catch {
        toast.dismiss(loadingId)
        toast.error(t('pdfFailed') || 'Failed to process PDF')
      }
      return
    }

    // Image attachment
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `Attached image: ${file.name}`
    }])
    toast.success('Image attached')
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : ''}`}>
            <div className={`max-w-[82%] rounded-2xl px-5 py-3 text-sm whitespace-pre-wrap ${
              msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-zinc-800'
            }`}>
              {msg.content}
                {msg.action === 'suggest_entry' && (
                  <button
                    onClick={() => handleSuggest(msg.suggestion)}
                    className="mt-2 block text-xs px-3 py-1 bg-white text-black rounded-full hover:bg-zinc-200 transition"
                  >
                     {msg.suggestion?.reversingOriginalId
                       ? t('reviewReversal')
                       : (msg.suggestion?.needsConfirmation ? t('reviewAndConfirm') : t('createEntry'))}
                  </button>
                )}

                {/* Phase 1: show merchant + real feed rate usage */}
                {msg.suggestion && (
                  <div className="mt-1 text-[10px] space-x-2">
                    {msg.suggestion.merchant && (
                      <span className="text-amber-400">from {msg.suggestion.merchant}</span>
                    )}
                     {Array.isArray(msg.suggestion.lines) && msg.suggestion.lines.some((l: { fxSource?: string | null }) => String(l.fxSource || '').startsWith('BANK_FEED')) && (
                      <span className="text-emerald-400">real feed rate</span>
                    )}
                    {msg.suggestion.merchant && !msg.suggestion.needsConfirmation && !msg.suggestion.reversingOriginalId && (
                      <span className="text-zinc-500">(authoritative)</span>
                    )}
                  </div>
                )}
            </div>
          </div>
        ))}
         {isLoading && (
           <div className="flex">
             <div className="bg-zinc-800 rounded-2xl px-5 py-3 text-sm">{t('thinking')}</div>
           </div>
         )}
      </div>

      <div className="border-t border-zinc-800 p-4">
        <div className="flex gap-3 items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/jpeg,image/jpg,image/png,image/webp"
            className="hidden"
            onChange={handleAttachment}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-3 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Attach file (PDF or image)"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('placeholder')}
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-3 text-sm focus:outline-none focus:border-zinc-700"
          />

          <button className="p-3 text-zinc-400 hover:text-zinc-200 transition-colors">
            <Mic className="w-5 h-5" />
          </button>
          <button
            onClick={toggleChatLock}
            className={`p-3 transition-colors ${isChatLocked ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-400 hover:text-zinc-200'}`}
            title={isChatLocked ? t('unlock') : t('lock')}
            aria-label={isChatLocked ? t('unlock') : t('lock')}
          >
            {isChatLocked ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
          </button>

          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="p-3 bg-white text-black rounded-2xl disabled:opacity-50 transition-all active:scale-[0.985]"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
        {isChatLocked && (
          <div className="mt-2 text-[11px] text-amber-400 text-center">
            {t('lockedStatus')}
          </div>
        )}
        <div className="text-[10px] text-center text-zinc-600 mt-2">
          Phase 0/1 • Fully i18n-ready + tax + multi-currency foundations + chat lock safety
        </div>
      </div>
    </div>
  )
}
