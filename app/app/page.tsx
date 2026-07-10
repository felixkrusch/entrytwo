'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Paperclip, Mic, Lock, Unlock } from 'lucide-react'
import toast from 'react-hot-toast'
import { useNewEntry, NewEntrySuggestion } from './NewEntryContext'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { JournalLineInput } from '@/lib/chat/validation'
import AmberTerminalThinking from './AmberTerminalThinking'

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
  // Small "View in list" button for autonomous creates (contact / invoice / journal)
  navigate?: { label: string; href: string }
  sourcePdfPath?: string
  proposedAction?: ProposedAction
}

type ProposalParams = {
  lines?: JournalLineInput[]
  description?: string
  sourcePdfPath?: string
  entries?: Array<{
    lines?: JournalLineInput[]
    description?: string
    date?: string
    sourcePdfPath?: string
  }>
}

interface ProposedAction {
  type?: string
  params?: ProposalParams
}

interface ChatResponse {
  suggestion?: NewEntrySuggestion
  proposedAction?: ProposedAction
  proposed?: boolean
  action?: string
  response?: string
  params?: ProposalParams
  entryId?: string
  entityId?: string
  sourcePdfPath?: string
  threadId?: string
  createInvoice?: Message['createInvoice']
  openLedger?: PendingLedger
  reconciled?: boolean
  restored?: boolean
  executed?: boolean
  createdAutonomously?: boolean
  lines?: JournalLineInput[]
  description?: string
}

type PendingLedger = { code: string; from?: string; to?: string; search?: string; branch?: string; asOf?: string }

declare global {
  interface Window {
    __pendingAttachments?: Array<{ file?: File; savedPath: string; name?: string }>
    __pendingContactForm?: { id: string; prefill: { name: string } }
    __pendingLedger?: PendingLedger
  }
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

  // Staged receipts (pending receipt state): survive multiple turns until attached to a journal or cleared by user.
  // Goal: user can attach a receipt, discuss over several messages, then create the entry (AI or manual) and it gets linked.
  const [stagedReceipts, setStagedReceipts] = useState<Array<{ name: string; savedPath: string }>>(() => {
    if (typeof window !== 'undefined') {
      return (window as any).__stagedReceipts || []
    }
    return []
  })

  const syncStagedToWindow = (next: Array<{ name: string; savedPath: string }>) => {
    if (typeof window !== 'undefined') {
      (window as any).__stagedReceipts = next
    }
  }

  const addToStaged = (item: { name: string; savedPath: string }) => {
    setStagedReceipts(prev => {
      if (prev.some(r => r.savedPath === item.savedPath)) return prev
      const next = [...prev, item]
      syncStagedToWindow(next)
      return next
    })
  }

  const removeFromStaged = (savedPath: string) => {
    setStagedReceipts(prev => {
      const next = prev.filter(r => r.savedPath !== savedPath)
      syncStagedToWindow(next)
      return next
    })
  }

  // Consume (remove) a specific receipt path after it has been attached to a journal.
  const consumeStagedReceipt = (savedPath?: string | null) => {
    if (!savedPath) return
    removeFromStaged(savedPath)
  }

  // Clear all staged (user action)
  const clearAllStaged = () => {
    setStagedReceipts([])
    syncStagedToWindow([])
  }

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

    // Add a placeholder for the assistant response (no streaming - we never got it to work)
    const assistantIndex = newMessages.length
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: ''
    }])
    scrollToBottom(true)

    try {
      // Pass current Git view (branch / asOf) so autonomous actions respect the viewed state
      const sp = new URLSearchParams(window.location.search)
      const branch = sp.get('branch') || 'main'
      const asOf = sp.get('asOf') || sp.get('asof') || undefined

      // Collect any pending attachments (files + their saved server paths) for *this message*.
      const pending = window.__pendingAttachments || []
      window.__pendingAttachments = []
      setPendingAttachments([])

      // Collect staged receipts (the persistent "pending receipt state").
      // These stay until a journal entry is created with them or the user clears them.
      const stagedNow: Array<{ name: string; savedPath: string }> = ((window as any).__stagedReceipts || []);

      // Merge staged into the outgoing request. The server will use them for sourcePdfPath
      // on CREATE_JOURNAL even if several messages were sent after the user attached the receipt.
      const combinedForSend = [...pending];
      stagedNow.forEach(s => {
        if (!combinedForSend.some(p => p.savedPath === s.savedPath)) {
          combinedForSend.push({ file: undefined, savedPath: s.savedPath, name: s.name });
        }
      });

      // Proper context management: send ONLY the new user message + threadId.
      // Server owns the full thread and will append + call the LLM with appropriate context.
      const userMessageText = current

      // Build FormData if we have attachments (including staged), otherwise plain JSON
      let res: Response
      const hasAnyFiles = combinedForSend.length > 0;
      if (hasAnyFiles) {
        const fd = new FormData()
        fd.append('message', userMessageText)
        if (threadId) fd.append('threadId', threadId)
        fd.append('chatLocked', String(chatLocked))
        fd.append('branch', branch)
        if (asOf) fd.append('asOf', asOf)

        combinedForSend.forEach((p, idx) => {
          if (p.file) fd.append('file', p.file, p.file.name)
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

      // Always treat response as JSON (streaming was never enabled)
      const data = await res.json() as ChatResponse
      const d = data

      let synthesizedSuggestion: NewEntrySuggestion | undefined = data.suggestion

      // Normalize CREATE_JOURNAL proposals (from two-pass confidence gate or explicit proposals)
      // into the shape the journal modal expects.
      const isCreateJournalProposal =
        d?.proposedAction?.type === 'CREATE_JOURNAL' ||
        (d?.proposed && (d?.action === 'CREATE_JOURNAL' || d?.proposedAction?.type === 'CREATE_JOURNAL'))
      const isJournalBatchProposal =
        d?.proposedAction?.type === 'CREATE_JOURNAL_BATCH' ||
        (d?.proposed && d?.action === 'CREATE_JOURNAL_BATCH')

      if (!synthesizedSuggestion && isCreateJournalProposal) {
        const p = d.proposedAction?.params || d.params || d
        if (p && (p.lines || p.description)) {
          synthesizedSuggestion = {
            description: p.description || data.response || 'Journal entry',
            lines: Array.isArray(p.lines) ? p.lines.map((l: JournalLineInput) => ({
              accountCode: l.accountCode,
              debit: typeof l.debit === 'string' ? Number(l.debit) : (l.debit || 0),
              credit: typeof l.credit === 'string' ? Number(l.credit) : (l.credit || 0),
              description: l.description,
              currency: l.currency,
              fxRateToBase: l.fxRateToBase != null ? Number(l.fxRateToBase) : undefined,
              fxSource: l.fxSource,
              fxDate: l.fxDate,
              taxRateId: l.taxRateId ?? undefined,
            })) : [],
            // carry uploaded invoice/receipt so the journal entry can be linked to it
            sourcePdfPath: p?.sourcePdfPath || d.sourcePdfPath || undefined,
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
        if (updated[assistantIndex]) {
          const isInvoice = !!data.createInvoice

          updated[assistantIndex] = {
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
          if (d.sourcePdfPath) {
            const msg = updated[assistantIndex]
            if (msg) msg.sourcePdfPath = d.sourcePdfPath
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

      // Consume staged receipt if a journal was created (autonomous or via this response)
      const usedPath = data?.sourcePdfPath || (data as any)?.entity?.sourcePdfPath || synthesizedSuggestion?.sourcePdfPath
      if (usedPath && (d?.createdAutonomously || d?.executed || d?.action === 'CREATE_JOURNAL')) {
        consumeStagedReceipt(usedPath)
      }

      scrollToBottom(true)

      // When chat just created or updated a contact, open the form in the contacts view in focus
      const act = (d.action || '').toString().toUpperCase()
      if (act === 'CREATE_CONTACT' || act === 'UPDATE_CONTACT') {
        const cid = d.entityId
        window.__pendingContactForm = {
          id: cid ?? '',
          prefill: { name: (d.response || '').replace(/^(Created|Updated) contact.*?:\s*/i, '').trim() }
        }
        setTimeout(() => {
          router.push('/app?view=contacts')
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('open-contact-form', {
              detail: window.__pendingContactForm
            }))
          }, 140)
        }, 40)
      }

      // For journal proposals, open the entry modal directly (user expectation for "showing as proposal")
      if (isCreateJournalProposal && synthesizedSuggestion) {
        // small delay so the message appears first
        setTimeout(() => openNewEntry(synthesizedSuggestion), 80)
      }

      if (isJournalBatchProposal) {
        setTimeout(() => router.push('/app?view=journal'), 80)
      }

      // Auto-switch the right panel for autonomous creates (contacts / invoices / journals)
      if (navigate) {
        setTimeout(() => router.push(navigate!.href), 70)
      }

      // Chat-triggered ledger open (AI-first high-reachability) — Git model: carry branch/asOf
      if (data.openLedger?.code) {
        const ld = data.openLedger
        const evt: PendingLedger = { code: ld.code }
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
          if (updated[assistantIndex]) {
            updated[assistantIndex] = {
              role: 'assistant',
              content: response
            }
          }
          return updated
        })
        scrollToBottom(true)

      // Local fallback path: also support ledger navigation hints
      const pending = window.__pendingLedger
      if (pending?.code) {
        window.dispatchEvent(new CustomEvent('open-ledger', { detail: pending }))
        delete window.__pendingLedger
      }
    } finally {
      setIsLoading(false)
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
    // If there are staged receipts and the suggestion doesn't already carry one,
    // inject the first staged one so the manual journal modal also gets the receipt.
    const s = suggestion ? { ...suggestion } : {}
    if (!s.sourcePdfPath && stagedReceipts.length > 0) {
      s.sourcePdfPath = stagedReceipts[0].savedPath
    }
    openNewEntry(s as any)
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
  const handleApproveProposal = async (msg: Message) => {
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
  // These go to the persistent *staged* list (pending receipt state) and also to this-turn pending.
  useEffect(() => {
    const onAttachReceipt = (e: Event) => {
      const detail = (e as CustomEvent).detail as { name?: string; savedPath: string } | undefined
      if (!detail?.savedPath) return
      const name = detail.name || detail.savedPath.split('/').pop() || 'file'
      const item = { name, savedPath: detail.savedPath }

      // Persistent staged receipts ("pending receipt state")
      addToStaged(item)

      // Also available for the immediate next message sent to the model
      setPendingAttachments(prev => [...prev, item])
      window.__pendingAttachments = [
        ...(window.__pendingAttachments || []),
        { file: undefined, savedPath: detail.savedPath, name }
      ]
    }
    window.addEventListener('attach-receipt', onAttachReceipt as EventListener)

    // When manual journal entry consumes a staged receipt (from NewJournalEntryModal)
    const onStagedUsed = (e: Event) => {
      const detail = (e as CustomEvent).detail as { savedPath?: string } | undefined
      if (detail?.savedPath) {
        removeFromStaged(detail.savedPath)
      }
    }
    window.addEventListener('staged-receipt-used', onStagedUsed as EventListener)

    return () => {
      window.removeEventListener('attach-receipt', onAttachReceipt as EventListener)
      window.removeEventListener('staged-receipt-used', onStagedUsed as EventListener)
    }
  }, [])

  // Attachments: multiple files (PDFs + images) are attached to the *next* user message.
  // They are sent together with the text prompt to the LLM (chat two-pass).
  // No legacy extraction, no heuristics here.
  const handleAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || [])
    if (!selected.length) return

    const allowed = selected.filter(f => {
      const n = f.name.toLowerCase()
      return n.endsWith('.pdf') || /\.(jpg|jpeg|png|webp)$/.test(n) || f.type.startsWith('image/') || n.endsWith('.csv') || f.type === 'text/csv'
    })

    if (!allowed.length) {
      toast.error('Please select PDF, image, or CSV files')
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
        savedPath: data.saved[i]?.savedPath || '',
      }))

      // Stash for sendMessage
      window.__pendingAttachments = [
        ...(window.__pendingAttachments || []),
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
          {messages.map((msg, i) => {
            // Pure loading state for assistant: show the amber terminal animation with NO bubble
            if (msg.role === 'assistant' && !msg.content) {
              return <AmberTerminalThinking key={i} />;
            }

            return (
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

                  {msg.createInvoice && (
                    <button
                      onClick={() => handleCreateInvoice(msg.createInvoice)}
                      className="mt-2 block text-xs px-3 py-1 bg-emerald-500 text-black rounded-full hover:bg-emerald-400 transition"
                    >
                      Create Invoice
                    </button>
                  )}

                  {/* Quick "view in list" button for autonomous creates */}
                  {msg.navigate && (
                    <button
                      onClick={() => router.push(msg.navigate!.href)}
                      className="mt-2 block text-xs px-3 py-1 bg-zinc-700 text-white rounded-full hover:bg-zinc-600 transition"
                    >
                      {msg.navigate.label}
                    </button>
                  )}

                  {/* Autonomous proposal confirmation surface */}
                  {(msg).proposedAction && (
                    <div className="mt-3 p-2 border border-amber-700 bg-amber-950/30 rounded text-xs">
                      <div className="mb-1 text-amber-400">Action requires confirmation:</div>
                      <div className="font-mono text-[10px] mb-2">{JSON.stringify((msg).proposedAction)}</div>
                      <button
                        onClick={() => handleApproveProposal(msg)}
                        className="px-3 py-1 bg-amber-600 text-black rounded-full text-xs hover:bg-amber-500"
                      >
                        Confirm & Execute
                      </button>
                    </div>
                  )}

                  {/* Phase 1: merchant + real feed rate usage */}
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
            );
          })}
        </div>
         <div ref={messagesEndRef} />

          {/* Staged receipts (persistent pending receipt state) */}
          {stagedReceipts.length > 0 && (
            <div className="mt-auto mb-1 text-[10px] text-emerald-400">
              <div className="flex items-center gap-2 mb-0.5">
                <span>Staged for next journal entry:</span>
                <button
                  onClick={clearAllStaged}
                  className="text-[9px] px-1.5 py-px border border-emerald-800 text-emerald-400 hover:bg-emerald-950 rounded"
                >
                  clear all
                </button>
              </div>
              {stagedReceipts.map((r, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className="truncate">{r.name}</span>
                  <button
                    onClick={() => removeFromStaged(r.savedPath)}
                    className="text-emerald-400 hover:text-rose-400 px-1"
                    title="Unstage this receipt"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Pending attachment filenames for the *next message* only (yellow, this-turn) */}
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
               {llmStatus.connected ? 'connected' : (llmStatus.hasKey ? 'unreachable' : 'not configured')}
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
              accept=".pdf,image/jpeg,image/jpg,image/png,image/webp,.csv,text/csv"
              className="hidden"
              onChange={handleAttachment}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-3 text-zinc-400 hover:text-zinc-200 transition-colors"
              title="Attach file (PDF, image, or CSV)"
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
