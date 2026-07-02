'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Paperclip, Mic, Lock, Unlock } from 'lucide-react'
import toast from 'react-hot-toast'
import { useNewEntry, NewEntrySuggestion } from './NewEntryContext'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

interface Message {
  role: 'user' | 'assistant'
  content: string
  action?: 'suggest_entry' | 'create_invoice'
  suggestion?: NewEntrySuggestion
  createInvoice?: {
    contactName?: string
    amount?: number
    description?: string
    currency?: string
  }
  isStreaming?: boolean
}

export default function ChatPage() {
  const { openNewEntry } = useNewEntry()
  const router = useRouter()
  const t = useTranslations('app.chat')
  const tToasts = useTranslations('app.toasts')

  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: t('welcome') }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // LLM live connection indicator (hybrid: real outcomes + cheap intent-driven probes + server cache)
  const [llmStatus, setLlmStatus] = useState<{
    connected: boolean
    hasKey: boolean
    provider?: string
    model?: string
    lastChecked?: number
  } | null>(null)

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

  // Hybrid LLM status:
  // - Primary signal: real /api/chat outcomes (updated in sendMessage success/failure)
  // - Secondary cheap probes: on mount + when tab becomes visible + on input focus (debounced)
  const lastStatusCheckRef = useRef(0)
  const STATUS_STALE_MS = 60_000

  const refreshLlmStatus = async (force = false) => {
    const now = Date.now()
    if (!force && now - lastStatusCheckRef.current < STATUS_STALE_MS) return
    lastStatusCheckRef.current = now
    try {
      const r = await fetch('/api/llm/status')
      const d = await r.json()
      setLlmStatus(d)
    } catch {
      setLlmStatus({ connected: false, hasKey: false })
    }
  }

  useEffect(() => {
    // Initial cheap probe on mount
    refreshLlmStatus(true)
  }, [])

  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) {
        refreshLlmStatus()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Client fallback (used only if /api/chat fails). Server version is much smarter.
  const generateResponse = (text: string): { response: string; suggestion?: NewEntrySuggestion; createInvoice?: { contactName?: string; amount?: number; description?: string; currency?: string } } => {
    const lower = text.toLowerCase().trim()
    const amountMatch = text.match(/(\d+[\.,]?\d*)/)
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '.')) : 100

    // Multi-currency detection in fallback (Phase 0)
    const currency = /usd|\$|dollars/.test(lower) ? 'USD' : (/eur|euro/.test(lower) ? 'EUR' : 'EUR')

    // Extract merchant early (used for invoice prefill)
    const merchantMatch = text.match(/from\s+([A-Za-z0-9 .&'-]+)/i)
    const extractedMerchant: string | undefined = merchantMatch ? merchantMatch[1].trim() : undefined

    let response = ''
    let suggestion: NewEntrySuggestion | undefined
    let createInvoice: { contactName?: string; amount?: number; description?: string; currency?: string } | undefined = undefined

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
      // Revenue invoice for customer (AI-first path) → use the invoice form, not journal
      const looksLikeCustomerInvoice = /invoice|bill.*(client|customer|acme|john|sarah|corp|gmbh|ltd|inc)/i.test(text) || (lower.includes('invoice') && !lower.includes('from '))
      if (looksLikeCustomerInvoice) {
        response = `I'll create a customer invoice for ~${amount}.`
        suggestion = undefined
        createInvoice = {
          contactName: extractedMerchant,
          amount,
          description: text,
          currency,
        }
      } else {
        response = `Expense via payable ~${amount}.`
        suggestion = {
          description: text,
          lines: [
            { accountCode: '5200', debit: amount, currency },
            { accountCode: '2000', credit: amount, description: 'Accounts payable', currency }
          ]
        }
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
    } else if (/(how much|spent|spend|expense|cost).*?(on|for|in)\s+([A-Za-z0-9 ]{2,30})/i.test(text) || /utilities|office supplies|rent|travel|software/i.test(lower)) {
      // Chat can trigger the dedicated ledger view for an account (AI-first pattern)
      const accountMatch = text.match(/(?:on|for|in)\s+([A-Za-z0-9 ]{2,30})/i)
      let hint = accountMatch ? accountMatch[1].trim().toLowerCase() : ''
      if (!hint) {
        if (lower.includes('utilities')) hint = 'utilities'
        else if (lower.includes('supplies')) hint = 'supplies'
        else if (lower.includes('rent')) hint = 'rent'
      }

      // Try to guess account code from common names (best effort)
      let code = '5200' // fallback expense
      if (hint.includes('util')) code = '5200'
      else if (hint.includes('supply') || hint.includes('office')) code = '5000'
      else if (hint.includes('rent')) code = '5100'
      else if (hint.includes('travel')) code = '5300'
      else if (hint.includes('software') || hint.includes('adobe')) code = '5110'

      // Extract year if present
      const yearMatch = text.match(/\b(20\d{2})\b/)
      const year = yearMatch ? yearMatch[1] : null

      response = `Opening the ledger for account ${code}.`

      // We return a special payload that the UI will turn into a ledger navigation
      ;(window as any).__pendingLedger = {
        code,
        from: year ? `${year}-01-01` : undefined,
        to: year ? `${year}-12-31` : undefined,
        search: hint || undefined
      }
    } else {
      response = "I can draft journal entries. Try 'bought supplies for 65', 'client paid 800', or 'reverse last entry'."
    }

    // Phase 1: client fallback non-EUR → needs confirmation.
    // Also extract merchant (e.g. "Adobe invoice") for future feed rate lookup.
    if (suggestion) {
      if (currency !== 'EUR') {
        suggestion = { ...suggestion, needsConfirmation: true }
      }
      if (extractedMerchant && !suggestion.merchant) {
        suggestion = { ...suggestion, merchant: extractedMerchant }
      }
    }

    return { response, suggestion, createInvoice }
  }

  const sendMessage = async () => {
    if (!input.trim()) return

    const userMessage: Message = { role: 'user', content: input }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    const current = input
    setInput('')
    setIsLoading(true)

    // Add a placeholder for streaming response
    const streamingMsgIndex = newMessages.length
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: '',
      isStreaming: true
    }])

    try {
      const history = newMessages.slice(-8).map(m => ({
        role: m.role,
        content: m.content
      }))

      // Pass current Git view (branch / asOf) so autonomous actions respect the viewed state
      const sp = new URLSearchParams(window.location.search)
      const branch = sp.get('branch') || 'main'
      const asOf = sp.get('asOf') || sp.get('asof') || undefined

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, chatLocked: isChatLocked, branch, asOf })
      })

      if (!res.ok) {
        // Real outcome: mark LLM as not connected right now
        setLlmStatus(prev => ({
          connected: false,
          hasKey: !!prev?.hasKey,
          provider: prev?.provider,
          model: prev?.model,
          lastChecked: Date.now(),
        }))
        throw new Error('Chat request failed')
      } else {
        // Real successful outcome → mark healthy
        setLlmStatus(prev => ({
          connected: true,
          hasKey: true,
          provider: prev?.provider,
          model: prev?.model,
          lastChecked: Date.now(),
        }))
      }

      // Check if response is streaming (text/plain) or JSON
      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('text/plain')) {
        // Handle streaming response
        const reader = res.body?.getReader()
        const decoder = new TextDecoder()
        let accumulatedContent = ''

        if (reader) {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value, { stream: true })
            accumulatedContent += chunk

            setMessages(prev => {
              const updated = [...prev]
              if (updated[streamingMsgIndex]) {
                updated[streamingMsgIndex] = {
                  ...updated[streamingMsgIndex],
                  content: accumulatedContent
                }
              }
              return updated
            })
          }
        }
      } else {
        // Handle JSON response (transactions with suggestions)
        const data = await res.json()
        setMessages(prev => {
          const updated = [...prev]
          if (updated[streamingMsgIndex]) {
            const isInvoice = !!data.createInvoice
            updated[streamingMsgIndex] = {
              role: 'assistant',
              content: data.response || 'Got it.',
              action: isInvoice ? 'create_invoice' : (data.suggestion ? 'suggest_entry' : undefined),
              suggestion: data.suggestion,
              createInvoice: data.createInvoice
            }
          }
          return updated
        })

        // Chat-triggered ledger open (AI-first high-reachability) — Git model: carry branch/asOf
        if ((data as any)?.openLedger?.code) {
          const d = (data as any).openLedger
          const evt: any = { code: d.code }
          if (d.from) evt.from = d.from
          if (d.to) evt.to = d.to
          if (d.search) evt.search = d.search
          if (d.branch) evt.branch = d.branch
          if (d.asOf) evt.asOf = d.asOf
          window.dispatchEvent(new CustomEvent('open-ledger', { detail: evt }))
        }

        // Git model signals: refresh all views after AI autonomous actions (full scope)
        const d = data as any
        if (d?.createdAutonomously || d?.reconciled || d?.restored || d?.executed) {
          window.dispatchEvent(new CustomEvent('journal-updated'))
          window.dispatchEvent(new CustomEvent('contacts-updated'))
          window.dispatchEvent(new CustomEvent('invoices-updated'))
          window.dispatchEvent(new CustomEvent('feeds-updated'))
          window.dispatchEvent(new CustomEvent('git-head-changed'))
        }
      }
    } catch {
      // Real outcome: hard failure (network, etc.)
      setLlmStatus(prev => ({
        connected: false,
        hasKey: !!prev?.hasKey,
        provider: prev?.provider,
        model: prev?.model,
        lastChecked: Date.now(),
      }))
      toast.error(tToasts('chatError') || 'Chat service unavailable, using local fallback.')
      const { response, suggestion } = generateResponse(current)
      setMessages(prev => {
        const updated = [...prev]
        if (updated[streamingMsgIndex]) {
          updated[streamingMsgIndex] = {
            role: 'assistant',
            content: response,
            action: suggestion ? 'suggest_entry' : undefined,
            suggestion
          }
        }
        return updated
      })

      // Local fallback path: also support ledger navigation hints
      const pending = (window as any).__pendingLedger
      if (pending?.code) {
        window.dispatchEvent(new CustomEvent('open-ledger', { detail: pending }))
        delete (window as any).__pendingLedger
      }
    } finally {
      setIsLoading(false)
      // Mark the message as no longer streaming
      setMessages(prev => {
        const updated = [...prev]
        if (updated[streamingMsgIndex]?.isStreaming) {
          updated[streamingMsgIndex] = {
            ...updated[streamingMsgIndex],
            isStreaming: false
          }
        }
        return updated
      })
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

  const handleCreateInvoice = async (prefill?: { contactName?: string; amount?: number; description?: string; currency?: string }) => {
    if (isChatLocked) {
      toast.error(t('lockedToast') || 'Chat is locked (advisory mode). Unlock to allow actions.')
      return
    }

    // If we have a clean structured payload (amount + description), try direct creation first
    if (prefill?.amount && prefill.description) {
      try {
        // Find a default customer (first CUSTOMER) for direct create path
        const cRes = await fetch('/api/contacts?type=CUSTOMER')
        const cData = await cRes.json()
        const firstCustomer = (cData.contacts || [])[0]

        if (firstCustomer) {
          const body = {
            contactId: firstCustomer.id,
            lines: [{
              description: prefill.description,
              quantity: 1,
              unitPrice: prefill.amount,
            }]
          }
          const createRes = await fetch('/api/invoices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (createRes.ok) {
            const inv = await createRes.json()
            router.push('/app?view=invoicing')
            // Open the newly created invoice details
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('open-invoice-details', { detail: { id: inv.id } }))
            }, 180)
            return
          }
        }
      } catch {
        // fall through to the prefill flow
      }
    }

    // Fallback: open panel + prefill form (user still clicks Create)
    router.push('/app?view=invoicing')
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('prefill-invoice', { detail: prefill || {} }))
    }, 120)
  }

  // Handle approval of a proposed autonomous action (destructive / high-impact)
  const handleApproveProposal = async (msg: any) => {
    if (isChatLocked) {
      toast.error(t('lockedToast') || 'Chat is locked.')
      return
    }
    const proposed = msg.proposedAction
    if (!proposed) return

    try {
      const sp = new URLSearchParams(window.location.search)
      const branch = sp.get('branch') || 'main'
      const asOf = sp.get('asOf') || undefined

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `APPROVE ${proposed.type}` }],
          chatLocked: false,
          branch,
          asOf,
          // Send the original intent back with approved flag
          intent: { action: proposed.type, params: proposed.params, approved: true, confidence: 1.0, branch },
        }),
      })
      const data = await res.json()
      if (data?.executed) {
        toast.success('Action executed after confirmation.')
        window.dispatchEvent(new CustomEvent('journal-updated'))
        window.dispatchEvent(new CustomEvent('contacts-updated'))
        window.dispatchEvent(new CustomEvent('invoices-updated'))
        window.dispatchEvent(new CustomEvent('git-head-changed'))
      } else {
        toast.error(data?.response || 'Confirmation failed')
      }
    } catch (e) {
      toast.error('Confirmation request failed')
    }
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

            // If the PDF processor signals high-confidence autonomous draft, create it directly (safe autonomous path)
            if (data.autonomousDraft && !needsConfirm && !isChatLocked) {
              try {
                const cRes = await fetch('/api/contacts?type=CUSTOMER&limit=1')
                const cData = await cRes.json()
                const cust = (cData.contacts || [])[0]
                const body = {
                  contactId: cust?.id,
                  currency: data.autonomousDraft.currency || detectedCurrency,
                  lines: [{
                    description: data.autonomousDraft.description,
                    quantity: 1,
                    unitPrice: data.autonomousDraft.amount || amount,
                  }]
                }
                const invRes = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                if (invRes.ok) {
                  const inv = await invRes.json()
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `Extracted from ${file.name} and created draft invoice autonomously: ${inv.invoiceNumber || ''}\n\n${currencyNote}${taxNote ? `\n${taxNote}` : ''}`
                  }])
                  router.push('/app?view=invoicing')
                  setTimeout(() => window.dispatchEvent(new CustomEvent('open-invoice-details', { detail: { id: inv.id } })), 150)
                  window.dispatchEvent(new CustomEvent('invoices-updated'))
                  toast.success('Draft invoice created autonomously from PDF')
                  toast.dismiss(loadingId)
                  return
                }
              } catch {}
            }

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
      <div className="flex-1 overflow-auto p-6 pb-1 flex flex-col">
        {/* Messages fill the space above */}
        <div className="flex-1 space-y-6">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : ''}`}>
              <div className={`max-w-[82%] rounded-2xl px-5 py-3 text-sm whitespace-pre-wrap ${
                msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-zinc-800'
              }`}>
                {msg.content || (msg.isStreaming ? '' : null)}
                  {msg.isStreaming && !msg.content && (
                    <span className="text-zinc-500">...</span>
                  )}
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

                   {msg.createInvoice && (
                     <button
                       onClick={() => handleCreateInvoice(msg.createInvoice)}
                       className="mt-2 block text-xs px-3 py-1 bg-emerald-500 text-black rounded-full hover:bg-emerald-400 transition"
                     >
                       Create Invoice
                     </button>
                   )}

                   {/* New autonomous proposal confirmation surface */}
                   {(msg as any).proposedAction && (
                     <div className="mt-3 p-2 border border-amber-700 bg-amber-950/30 rounded text-xs">
                       <div className="mb-1 text-amber-400">Action requires confirmation:</div>
                       <div className="font-mono text-[10px] mb-2">{JSON.stringify((msg as any).proposedAction)}</div>
                       <button
                         onClick={() => handleApproveProposal(msg as any)}
                         className="px-3 py-1 bg-amber-600 text-black rounded-full text-xs hover:bg-amber-500"
                       >
                         Confirm & Execute
                       </button>
                     </div>
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
        </div>

        {/* LLM indicator at the very bottom of this div */}
        <div className="mt-auto pt-1 text-[10px]">
          {llmStatus ? (
            <span className={`inline-flex items-center gap-1.5 ${llmStatus.connected ? 'text-emerald-400' : 'text-rose-400'}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${llmStatus.connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              {llmStatus.connected ? 'LLM connected' : (llmStatus.hasKey ? 'LLM unreachable' : 'LLM not configured')}
              {llmStatus.model ? ` • ${llmStatus.model}` : ''}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-zinc-500">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-500" />
              Checking LLM…
            </span>
          )}
        </div>
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
            onFocus={() => refreshLlmStatus()}
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
      </div>
    </div>
  )
}
