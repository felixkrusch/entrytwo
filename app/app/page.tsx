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
  // Small "View in list" button for autonomous creates (contact / invoice / journal)
  navigate?: { label: string; href: string }
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

  // Server-managed thread ID for proper context preservation.
  // Client only sends the new user message + threadId.
  // Server stores the full thread and returns the ID.
  const [threadId, setThreadId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('chatThreadId') || null
    }
    return null
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Filenames of files attached in this chat turn (display only, shown above LLM indicator).
  // Actual files + paths are stashed in (window as any).__pendingAttachments for send.
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ name: string; savedPath: string }>>([])

  // LLM live connection indicator (hybrid: real outcomes + cheap intent-driven probes + server cache)
  const [llmStatus, setLlmStatus] = useState<{
    connected: boolean
    hasKey: boolean
    provider?: string
    model?: string
    lastChecked?: number
  } | null>(null)

  // Single global lock.
  // false = unlocked (autonomous actions allowed when confident + validation passes)
  // true  = locked (chat can propose, but every execution requires explicit user confirmation)
  const [chatLocked, setChatLocked] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('chatLocked')
      if (saved === 'true') return true
      if (saved === 'false') return false
    }
    return false // default unlocked
  })

  const toggleChatLock = () => {
    const next = !chatLocked
    setChatLocked(next)
    if (typeof window !== 'undefined') {
      localStorage.setItem('chatLocked', String(next))
      // legacy compat for any panels that still read it
      localStorage.setItem('chatMode', next ? 'advisor' : 'execution')
    }
    toast.success(next ? 'Chat locked — proposals only' : 'Chat unlocked — autonomous actions enabled when confident')
  }

  // Chat scroll refs and auto-follow (standard chat app behaviour like GPT/Grok)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  const scrollToBottom = (force = false) => {
    if (!force && !autoScrollRef.current) return
    requestAnimationFrame(() => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' })
      } else if (scrollContainerRef.current) {
        const el = scrollContainerRef.current
        el.scrollTop = el.scrollHeight
      }
    })
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

  // Minimal client error response only. Two-pass on the server is the single source of truth.
  const generateErrorResponse = (text: string): { response: string } => {
    return { response: 'Chat service unavailable. Please try again.' }
  }

  const sendMessage = async () => {
    if (!input.trim()) return

    const userMessage: Message = { role: 'user', content: input }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    scrollToBottom(true)
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
    scrollToBottom(true)

    try {
      // Pass current Git view (branch / asOf) so autonomous actions respect the viewed state
      const sp = new URLSearchParams(window.location.search)
      const branch = sp.get('branch') || 'main'
      const asOf = sp.get('asOf') || sp.get('asof') || undefined

      // Collect any pending attachments (files + their saved server paths)
      const pending = ((window as any).__pendingAttachments || []) as Array<{ file: File; savedPath: string }>
      ;(window as any).__pendingAttachments = []
      setPendingAttachments([])

      // Proper context management: send ONLY the new user message + threadId.
      // Server owns the full thread and will append + call the LLM with appropriate context.
      const userMessageText = current

      // Build FormData if we have attachments, otherwise plain JSON
      let res: Response
      if (pending.length > 0) {
        const fd = new FormData()
        fd.append('message', userMessageText)
        if (threadId) fd.append('threadId', threadId)
        fd.append('chatLocked', String(chatLocked))
        fd.append('branch', branch)
        if (asOf) fd.append('asOf', asOf)

        pending.forEach((p, idx) => {
          fd.append('file', p.file, p.file.name)
          fd.append(`savedPath_${idx}`, p.savedPath)
        })

        res = await fetch('/api/chat', { method: 'POST', body: fd })
      } else {
        res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: userMessageText,
            threadId: threadId || undefined,
            chatLocked,
            branch,
            asOf,
          })
        })
      }

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
            scrollToBottom(true)
          }
        }
      } else {
        // Handle JSON response (transactions with suggestions)
        const data = await res.json()
        const d = data as any

        let synthesizedSuggestion: NewEntrySuggestion | undefined = data.suggestion

        // Normalize CREATE_JOURNAL proposals (from two-pass confidence gate or explicit proposals)
        // into the shape the journal modal expects.
        const isCreateJournalProposal =
          d?.proposedAction?.type === 'CREATE_JOURNAL' ||
          (d?.proposed && (d?.action === 'CREATE_JOURNAL' || d?.proposedAction?.type === 'CREATE_JOURNAL'))

        if (!synthesizedSuggestion && isCreateJournalProposal) {
          const p = d.proposedAction?.params || d.params || d
          if (p && (p.lines || p.description)) {
            synthesizedSuggestion = {
              description: p.description || data.response || 'Journal entry',
              lines: Array.isArray(p.lines) ? p.lines.map((l: any) => ({
                accountCode: l.accountCode,
                debit: l.debit || 0,
                credit: l.credit || 0,
                description: l.description,
                currency: l.currency,
                fxRateToBase: l.fxRateToBase,
                fxSource: l.fxSource,
                fxDate: l.fxDate,
                taxRateId: l.taxRateId,
              })) : [],
              // carry uploaded invoice/receipt so the journal entry can be linked to it
              sourcePdfPath: p?.sourcePdfPath || (d as any)?.sourcePdfPath || undefined,
            }
          }
        }

        // Compute a quick nav target for autonomous creates (used for both the button and auto-switch)
        // Supports two-pass (has action) and legacy high-confidence path (entryId + createdAutonomously, no action)
        let navigate: { label: string; href: string } | undefined
        if (d?.createdAutonomously) {
          const act = (d.action || '').toString().toUpperCase()
          const resp = String(d.response || '').toLowerCase()
          if (act === 'CREATE_CONTACT' || /contact/i.test(resp)) {
            navigate = { label: 'View contacts', href: '/app?view=contacts' }
          } else if (act === 'CREATE_INVOICE_DRAFT' || act === 'GENERATE_RECURRING_DRAFT' || /invoice/i.test(resp)) {
            navigate = { label: 'View invoices', href: '/app?view=invoicing' }
          } else if (act.includes('REVERSE') || /revers(ed|al)/i.test(resp)) {
            navigate = { label: 'View entries', href: '/app?view=dashboard' }
          } else if (act === 'CREATE_JOURNAL' || d.entryId || /journal|entry|autonomously/i.test(resp)) {
            navigate = { label: 'View entries', href: '/app?view=dashboard' }
          } else if (act === 'MATCH_FEED_TRANSACTION' || /feed|match.*post|posted/i.test(resp)) {
            navigate = { label: 'View entries', href: '/app?view=dashboard' }
          }
        }

        setMessages(prev => {
          const updated = [...prev]
          if (updated[streamingMsgIndex]) {
            const isInvoice = !!data.createInvoice

            updated[streamingMsgIndex] = {
              role: 'assistant',
              content: data.response || 'Got it.',
              action: isInvoice ? 'create_invoice' : (synthesizedSuggestion ? 'suggest_entry' : undefined),
              suggestion: synthesizedSuggestion,
              createInvoice: data.createInvoice,
              ...(navigate ? { navigate } : {}),
              // Preserve proposedAction for non-journal cases (restore/merge/...)
              ...(d?.proposedAction && !isCreateJournalProposal ? { proposedAction: d.proposedAction } : {})
            }
            // also surface sourcePdfPath on the message for proposals that don't go through the suggestion path
            if ((d as any)?.sourcePdfPath && updated[streamingMsgIndex]) {
              ;(updated[streamingMsgIndex] as any).sourcePdfPath = (d as any).sourcePdfPath
            }
          }
          return updated
        })

        // Persist server-assigned threadId for next turns (context is now server-managed)
        if (data?.threadId && typeof data.threadId === 'string') {
          setThreadId(data.threadId)
          if (typeof window !== 'undefined') {
            localStorage.setItem('chatThreadId', data.threadId)
          }
        }
        scrollToBottom(true)

        // When chat just created or updated a contact, open the form in the contacts view in focus
        const act = (d.action || '').toString().toUpperCase()
        if (act === 'CREATE_CONTACT' || act === 'UPDATE_CONTACT') {
          const cid = d.entityId
          ;(window as any).__pendingContactForm = {
            id: cid,
            prefill: { name: (d.response || '').replace(/^(Created|Updated) contact.*?:\s*/i, '').trim() }
          }
          setTimeout(() => {
            router.push('/app?view=contacts')
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('open-contact-form', {
                detail: (window as any).__pendingContactForm
              }))
            }, 140)
          }, 40)
        }

        // For journal proposals, open the entry modal directly (user expectation for "showing as proposal")
        if (isCreateJournalProposal && synthesizedSuggestion) {
          // small delay so the message appears first
          setTimeout(() => openNewEntry(synthesizedSuggestion), 80)
        }

        // Auto-switch the right panel for autonomous creates (contacts / invoices / journals)
        if (navigate) {
          setTimeout(() => router.push(navigate!.href), 70)
        }

        // Chat-triggered ledger open (AI-first high-reachability) — Git model: carry branch/asOf
        if ((data as any)?.openLedger?.code) {
          const ld = (data as any).openLedger
          const evt: any = { code: ld.code }
          if (ld.from) evt.from = ld.from
          if (ld.to) evt.to = ld.to
          if (ld.search) evt.search = ld.search
          if (ld.branch) evt.branch = ld.branch
          if (ld.asOf) evt.asOf = ld.asOf
          window.dispatchEvent(new CustomEvent('open-ledger', { detail: evt }))
        }

        // Git model signals: refresh all views after AI autonomous actions (full scope)
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
      const { response } = generateErrorResponse(current)
        setMessages(prev => {
          const updated = [...prev]
          if (updated[streamingMsgIndex]) {
            updated[streamingMsgIndex] = {
              role: 'assistant',
              content: response
            }
          }
          return updated
        })
        scrollToBottom(true)

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
      scrollToBottom(true)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleSuggest = (suggestion?: NewEntrySuggestion) => {
    if (chatLocked) {
      toast.error(t('lockedToast') || 'Chat is locked. Proposals only — confirm to execute.')
      return
    }
    openNewEntry(suggestion)
  }

  const handleCreateInvoice = async (prefill?: { contactName?: string; amount?: number; description?: string; currency?: string }) => {
    if (chatLocked) {
      toast.error(t('lockedToast') || 'Chat is locked. Proposals only — confirm to execute.')
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
    // Always allow explicit confirmation, even when locked.
    // The server will still re-validate everything.
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
            // For approvals we send the decision via approvedAction.
            // We still pass threadId so the server can associate it with the ongoing conversation if needed.
            threadId: threadId || undefined,
            chatLocked,
            branch,
            asOf,
            approvedAction: { action: proposed.type, params: proposed.params },
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

  // Listen for "attach from receipts list" (manual selection of already-uploaded files)
  useEffect(() => {
    const onAttachReceipt = (e: Event) => {
      const detail = (e as CustomEvent).detail as { name?: string; savedPath: string } | undefined
      if (!detail?.savedPath) return
      const name = detail.name || detail.savedPath.split('/').pop() || 'file'
      // show in yellow pending list
      setPendingAttachments(prev => [...prev, { name, savedPath: detail.savedPath }])
      // stash for next sendMessage (no File object for pre-existing)
      const win = window as any
      win.__pendingAttachments = [
        ...(win.__pendingAttachments || []),
        { file: undefined, savedPath: detail.savedPath, name }
      ]
    }
    window.addEventListener('attach-receipt', onAttachReceipt as EventListener)
    return () => window.removeEventListener('attach-receipt', onAttachReceipt as EventListener)
  }, [])

  // Attachments: multiple files (PDFs + images) are attached to the *next* user message.
  // They are sent together with the text prompt to the LLM (chat two-pass).
  // No legacy extraction, no heuristics here.
  const handleAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || [])
    if (!selected.length) return

    const allowed = selected.filter(f => {
      const n = f.name.toLowerCase()
      return n.endsWith('.pdf') || /\.(jpg|jpeg|png|webp)$/.test(n) || f.type.startsWith('image/')
    })

    if (!allowed.length) {
      toast.error('Please select PDF or image files (jpg, jpeg, png, webp)')
      e.target.value = ''
      return
    }

    // Save the files on the server so we can reference them later (journal.sourcePdfPath etc.)
    const form = new FormData()
    allowed.forEach(f => form.append('file', f))

    try {
      const res = await fetch('/api/invoices/process', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || !data?.saved?.length) {
        toast.error('Failed to attach file(s)')
        e.target.value = ''
        return
      }

      // Keep the actual File objects + their server paths for the next sendMessage
      const toAttach = allowed.map((f, i) => ({
        file: f,
        savedPath: (data.saved[i] as any)?.savedPath || '',
      }))

      // Stash for sendMessage
      ;(window as any).__pendingAttachments = [
        ...((window as any).__pendingAttachments || []),
        ...toAttach,
      ]

      const names = toAttach.map(a => a.file.name).join(', ')
      // Do not add a chat bubble. We show the filenames in small yellow text
      // just above the LLM status indicator instead.
      setPendingAttachments(prev => [...prev, ...toAttach.map(a => ({ name: a.file.name, savedPath: a.savedPath }))])

      toast.success(`${toAttach.length} file(s) attached`)
    } catch {
      toast.error('Failed to attach file(s)')
    } finally {
      e.target.value = ''
    }
  }

  // Always force scroll to bottom on assistant content (standard chat behaviour + explicit "always" requirement)
  const forceScrollToLatest = () => {
    autoScrollRef.current = true
    scrollToBottom(true)
  }

  // Attach scroll listener to pause auto-follow only if user deliberately scrolled far up
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const onScroll = () => {
      const threshold = 120
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
      autoScrollRef.current = isNearBottom
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto p-6 pb-1 flex flex-col"
      >
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

                    {/* Quick "view in list" button for autonomous creates (contact / invoice / journal) */}
                    {msg.navigate && (
                      <button
                        onClick={() => router.push(msg.navigate!.href)}
                        className="mt-2 block text-xs px-3 py-1 bg-zinc-700 text-white rounded-full hover:bg-zinc-600 transition"
                      >
                        {msg.navigate.label}
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
         <div ref={messagesEndRef} />

         {/* Pending attachment filenames (yellow, small, stacked) shown just above LLM indicator */}
        {pendingAttachments.length > 0 && (
          <div className="mt-auto mb-px text-[10px] text-amber-400 leading-tight">
            {pendingAttachments.map((a, i) => (
              <div key={i}>{a.name}</div>
            ))}
          </div>
        )}

        {/* LLM indicator at the very bottom of this div */}
        <div className="pt-1 text-[10px]">
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
              className={`p-3 transition-colors ${chatLocked ? 'text-sky-400 hover:text-sky-300' : 'text-zinc-400 hover:text-zinc-200'}`}
              title={chatLocked ? 'Chat is locked (proposals only — click to unlock)' : 'Chat is unlocked (autonomous actions when confident — click to lock)'}
              aria-label={chatLocked ? 'Unlock chat' : 'Lock chat'}
            >
              {chatLocked ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
            </button>

          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="p-3 bg-white text-black rounded-2xl disabled:opacity-50 transition-all active:scale-[0.985]"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
        {chatLocked && (
          <div className="mt-2 text-[11px] text-sky-400 text-center">
            Chat locked — proposals only. Confirm to execute any action.
          </div>
        )}
      </div>
    </div>
  )
}
