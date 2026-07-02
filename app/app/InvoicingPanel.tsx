'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { formatCurrency } from '@/lib/utils'

interface ContactItem {
  id: string
  name: string
  email?: string
  type: 'CUSTOMER' | 'VENDOR'
}

interface InvoiceLineForm {
  description: string
  quantity: number
  unitPrice: number
  taxRateId?: string | null
}

interface SavedSnippet {
  id: string
  name: string
  description?: string
  quantity?: number
  unitPrice?: number
  kind?: string
  text?: string
}

interface TaxRate {
  id: string
  name: string
  rate: number
  jurisdiction: string
}

interface Invoice {
  id: string
  invoiceNumber: string
  status: string
  currency: string
  total: number
  subtotal: number
  taxAmount: number
  issueDate: string
  dueDate: string
  paidDate?: string
  notes?: string | null
  createdAt?: string
  contact: { id: string; name: string }
  lines: { description: string; quantity: number; unitPrice: number; lineTotal: number; taxRate?: { name: string; rate: number } | null }[]
  journalEntry?: {
    id: string
    description?: string | null
    lines: Array<{
      account: { code: string; name: string }
      debit: number
      credit: number
      description?: string | null
    }>
  } | null
}

export default function InvoicingPanel() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED'>('ALL')
  const [processingPayment, setProcessingPayment] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [createdInvoiceId, setCreatedInvoiceId] = useState<string | null>(null)

  // Quick financial overview (computed on fetch)
  const [stats, setStats] = useState<{ outstanding: number; overdue: number; thisMonthPaid: number }>({ outstanding: 0, overdue: 0, thisMonthPaid: 0 })

  // Payment provider availability (hide buttons if no keys)
  const [stripeEnabled, setStripeEnabled] = useState(false)
  const [paypalEnabled, setPaypalEnabled] = useState(false)
  const [emailEnabled, setEmailEnabled] = useState(false)

  // Editing state
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null)

  // Recurring schedules (per plan: generate DRAFT by default, optional autoSend)
  const [recurring, setRecurring] = useState<any[]>([])
  const [showRecurring, setShowRecurring] = useState(false)

  // Accordion expansion (in-place details, no hidden bottom panel)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedData, setExpandedData] = useState<any>(null)

  const fetchRecurring = useCallback(async () => {
    try {
      const res = await fetch('/api/recurring-invoices')
      const data = await res.json()
      setRecurring(data.recurring || [])
    } catch {}
  }, [])

  // Create recurring schedule from current form
  const makeRecurring = async () => {
    if (!newContactId || newLines.every(l => !l.description.trim())) {
      alert('Add a customer and at least one line to make recurring')
      return
    }
    const name = prompt('Recurring schedule name?', 'Monthly retainer')
    if (!name) return
    const freq = prompt('Frequency? WEEKLY / MONTHLY / QUARTERLY / YEARLY', 'MONTHLY') || 'MONTHLY'
    const intervalStr = prompt('Every how many periods?', '1') || '1'
    const interval = parseInt(intervalStr, 10) || 1
    const auto = confirm('Auto-send after generation? (recommended: No = create DRAFT for review)')

    const payload = {
      name,
      contactId: newContactId,
      frequency: freq.toUpperCase(),
      interval,
      startDate: new Date().toISOString(),
      autoSend: auto,
      templateData: {
        currency: 'EUR',
        lines: newLines.filter(l => l.description.trim()).map(l => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRateId: l.taxRateId,
        })),
      },
    }

    const res = await fetch('/api/recurring-invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      alert('Recurring schedule created. It will generate DRAFT invoices on schedule.')
      void fetchRecurring()
    } else {
      alert('Failed to create recurring schedule')
    }
  }

  const generateNow = async (recId: string) => {
    const res = await fetch(`/api/recurring-invoices/${recId}/generate`, { method: 'POST' })
    const data = await res.json()
    if (data.invoiceId) {
      alert(`Draft invoice created: ${data.invoiceId}`)
      void fetchInvoices()
      void loadInvoiceDetails(data.invoiceId)
    } else {
      alert(data.error || 'Generation failed')
    }
  }

  const toggleRecurringStatus = async (rec: any) => {
    const newStatus = rec.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    await fetch(`/api/recurring-invoices/${rec.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    void fetchRecurring()
  }

  useEffect(() => {
    fetch('/api/payments/stripe/status').then(r => r.json()).then(d => setStripeEnabled(!!d.configured)).catch(() => {})
    fetch('/api/payments/paypal/status').then(r => r.json()).then(d => setPaypalEnabled(!!d.configured)).catch(() => {})
    // Email availability (SMTP configured) — gates Email button
    fetch('/api/invoices/email/status').then(r => r.json()).then(d => setEmailEnabled(!!d.configured)).catch(() => {})
    // Preload text snippets so they are ready when opening the create form
    void fetchTextSnippets()
  }, [])

  // Create form state
  const [contacts, setContacts] = useState<ContactItem[]>([])
  const [snippets, setSnippets] = useState<SavedSnippet[]>([])
  const [taxRates, setTaxRates] = useState<TaxRate[]>([])
  const [saving, setSaving] = useState(false)
  const [newContactId, setNewContactId] = useState('')
  const [newLines, setNewLines] = useState<InvoiceLineForm[]>([{ description: '', quantity: 1, unitPrice: 0, taxRateId: null }])
  const [formIssueDate, setFormIssueDate] = useState('')
  const [formDueDate, setFormDueDate] = useState('')

  // Invoice-level free text (notes/message) + its text snippets
  const [notes, setNotes] = useState('')
  const [textSnippets, setTextSnippets] = useState<any[]>([])

  // --- All useCallback definitions FIRST (before any useEffect that references them) ---
  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch('/api/contacts?type=CUSTOMER')
      const data = await res.json()
      setContacts(data.contacts || [])
    } catch {}
  }, [])

  const fetchSnippets = useCallback(async () => {
    try {
      const res = await fetch('/api/invoices/snippets')
      const data = await res.json()
      setSnippets((data.snippets || []).filter((s: any) => !s.kind || s.kind === 'line'))
    } catch {}
  }, [])

  const fetchTextSnippets = useCallback(async () => {
    try {
      const res = await fetch('/api/invoices/snippets?kind=text')
      const data = await res.json()
      setTextSnippets(data.snippets || [])
    } catch {}
  }, [])

  const fetchTaxRates = useCallback(async () => {
    try {
      const res = await fetch('/api/tax-rates')
      const data = await res.json()
      setTaxRates(Array.isArray(data) ? data : [])
    } catch {}
  }, [])

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/invoices${statusFilter === 'ALL' ? '' : `?status=${statusFilter}`}`)
      const data = await res.json()
      let list: Invoice[] = data.invoices || []
      // Ensure latest created is always at the very top
      list = [...list].sort((a, b) => {
        const ta = a.createdAt || a.issueDate || ''
        const tb = b.createdAt || b.issueDate || ''
        if (tb !== ta) return tb.localeCompare(ta)
        return (b.id || '').localeCompare(a.id || '')
      })
      setInvoices(list)

      const now = new Date()
      let outstanding = 0
      let overdue = 0
      let thisMonthPaid = 0

      list.forEach(inv => {
        const tot = Number(inv.total) || 0
        if (inv.status === 'PAID') {
          const pd = inv.paidDate ? new Date(inv.paidDate) : null
          if (pd && pd.getMonth() === now.getMonth() && pd.getFullYear() === now.getFullYear()) {
            thisMonthPaid += tot
          }
        } else {
          outstanding += tot
          if (inv.dueDate && new Date(inv.dueDate) < now) overdue += tot
        }
      })

      setStats({ outstanding, overdue, thisMonthPaid })
    } catch {} finally {
      setLoading(false)
    }
  }, [statusFilter])
  // Accordion style: expand details in-place under the row
  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      setExpandedData(null)
      return
    }
    try {
      const res = await fetch(`/api/invoices/${id}`)
      if (res.ok) {
        const full = await res.json()
        setExpandedId(id)
        setExpandedData(full)
        // close any old bottom panel
        setSelectedInvoice(null)
      }
    } catch {}
  }

  // Keep the old function for explicit "Edit Draft" flows only
  const loadInvoiceDetails = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/invoices/${id}`)
      if (res.ok) {
        const full = await res.json()
        setSelectedInvoice(full)
        setShowCreate(false)
        setEditingInvoiceId(null)
      }
    } catch {}
  }, [])

  const closeDetails = useCallback(() => setSelectedInvoice(null), [])

  // --- Effects (now safe because callbacks are declared above) ---
  useEffect(() => {
    if (showCreate && taxRates.length > 0 && newLines.length === 1 && !newLines[0].taxRateId) {
      const first = taxRates[0]
      if (first) {
        setNewLines([{ ...newLines[0], taxRateId: first.id }])
      }
    }
  }, [showCreate, taxRates]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      if (detail.contactName || detail.amount || detail.description) {
        setShowCreate(true)
        setCreatedInvoiceId(null)
        setEditingInvoiceId(null)
        // default dates on prefill
        const today = new Date().toISOString().slice(0, 10)
        setFormIssueDate(today)
        const due = new Date()
        due.setDate(due.getDate() + 30)
        setFormDueDate(due.toISOString().slice(0, 10))
        setTimeout(() => {
          if (detail.contactName) {
            const match = contacts.find(c => c.name.toLowerCase().includes(String(detail.contactName).toLowerCase()))
            if (match) setNewContactId(match.id)
          }
          if (detail.amount) {
            const amt = Number(detail.amount)
            setNewLines([{ description: detail.description || 'Services', quantity: 1, unitPrice: amt, taxRateId: taxRates[0]?.id || null }])
          } else if (detail.description) {
            setNewLines([{ description: detail.description, quantity: 1, unitPrice: 0, taxRateId: taxRates[0]?.id || null }])
          }
        }, 50)
      }
    }
    window.addEventListener('prefill-invoice', handler)
    return () => window.removeEventListener('prefill-invoice', handler)
  }, [contacts, taxRates])

  useEffect(() => {
    const openHandler = async (e: Event) => {
      const id = (e as CustomEvent).detail?.id
      if (id) {
        await loadInvoiceDetails(id)
        void fetchInvoices()
      }
    }
    window.addEventListener('open-invoice-details', openHandler)
    return () => window.removeEventListener('open-invoice-details', openHandler)
  }, [loadInvoiceDetails, fetchInvoices])

  useEffect(() => {
    if (createdInvoiceId && selectedInvoice && selectedInvoice.id !== createdInvoiceId) {
      // keep selection only if user is viewing the one they just created
    }
  }, [createdInvoiceId, selectedInvoice])

  useEffect(() => {
    void fetchInvoices()
    void fetchRecurring()
  }, [fetchInvoices, fetchRecurring])

  // Autonomous execution refresh
  useEffect(() => {
    const h = () => { void fetchInvoices(); void fetchRecurring() }
    window.addEventListener('invoices-updated', h)
    window.addEventListener('journal-updated', h)
    return () => {
      window.removeEventListener('invoices-updated', h)
      window.removeEventListener('journal-updated', h)
    }
  }, [fetchInvoices, fetchRecurring])

  useEffect(() => {
    if (showCreate) {
      void fetchContacts()
      void fetchSnippets()
      void fetchTextSnippets()
      void fetchTaxRates()
    }
  }, [showCreate, fetchContacts, fetchSnippets, fetchTextSnippets, fetchTaxRates])

  const addLine = () => {
    setNewLines([...newLines, { description: '', quantity: 1, unitPrice: 0, taxRateId: null }])
  }

  const removeLine = (index: number) => {
    setNewLines(newLines.filter((_, i) => i !== index))
  }

  const updateLine = (index: number, field: keyof InvoiceLineForm, value: string | number) => {
    setNewLines(newLines.map((line, i) => {
      if (i !== index) return line
      if (field === 'description') {
        return { ...line, description: String(value) }
      }
      if (field === 'quantity' || field === 'unitPrice') {
        return { ...line, [field]: Number(value) || 0 }
      }
      if (field === 'taxRateId') {
        return { ...line, taxRateId: value === '' ? null : String(value) }
      }
      return line
    }))
  }

  const applySnippet = (snippet: SavedSnippet) => {
    const desc = ((snippet.description || snippet.text) || '').toString().trim()
    if (!desc) return
    setNewLines(prev => {
      // Always replace the *first* blank line if present (the initial empty starter line, or any user-left blank).
      // This prevents "clicking snippet adds empty lines".
      const idx = prev.findIndex(l => !String(l.description || '').trim())
      if (idx !== -1) {
        const base = prev[idx]
        const copy = [...prev]
        copy[idx] = {
          ...base,
          description: desc,
          quantity: Number(snippet.quantity) || base.quantity || 1,
          unitPrice: Number(snippet.unitPrice) || base.unitPrice || 0,
        }
        return copy
      }
      // No blank line: append the snippet as a new line
      return [...prev, {
        description: desc,
        quantity: Number(snippet.quantity) || 1,
        unitPrice: Number(snippet.unitPrice) || 0,
        taxRateId: null
      }]
    })
  }



  const applyTextSnippet = (s: any) => {
    const t = (s.text || s.description || '').toString().trim()
    if (!t) return
    setNotes(prev => {
      const base = (prev || '').trim()
      return base ? base + '\n\n' + t : t
    })
  }

  const saveCurrentTextAsSnippet = async () => {
    const txt = (notes || '').trim()
    if (!txt) return
    const name = prompt('Text snippet name?', txt.slice(0, 50))
    if (!name) return
    try {
      const res = await fetch('/api/invoices/snippets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, kind: 'text', text: txt }),
      })
      if (res.ok) void fetchTextSnippets()
    } catch {}
  }



  const subtotal = useMemo(() => {
    return newLines.reduce((sum, line) => sum + (line.quantity * line.unitPrice), 0)
  }, [newLines])

  const taxTotal = useMemo(() => {
    return newLines.reduce((sum, line) => {
      const rate = taxRates.find(r => r.id === line.taxRateId)?.rate || 0
      return sum + (line.quantity * line.unitPrice * rate)
    }, 0)
  }, [newLines, taxRates])

  const grandTotal = subtotal + taxTotal

  const saveAsSnippet = async () => {
    // Pick the first line that actually has a description (avoid saving empty)
    const meaningful = newLines.find(l => l.description && l.description.trim().length > 0)
    if (!meaningful) {
      alert('Type a description in a line first, then save as snippet.')
      return
    }
    const name = prompt('Snippet name?', meaningful.description || 'New snippet')
    if (!name) return
    try {
      const res = await fetch('/api/invoices/snippets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: meaningful.description,
          quantity: meaningful.quantity,
          unitPrice: meaningful.unitPrice,
          kind: 'line',
        }),
      })
      if (res.ok) {
        void fetchSnippets()
      }
    } catch {}
  }

  const saveInvoice = async () => {
    if (!newContactId || newLines.every(l => !l.description.trim())) return
    setSaving(true)
    try {
      const validLines = newLines.filter(l => l.description.trim())

      const payload: any = {
        contactId: newContactId,
        status: 'DRAFT',
        issueDate: formIssueDate ? new Date(formIssueDate).toISOString() : undefined,
        dueDate: formDueDate ? new Date(formDueDate).toISOString() : undefined,
        notes: notes || undefined,
        lines: validLines.map(l => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRateId: l.taxRateId || undefined
        }))
      }

      let res: Response
      if (editingInvoiceId) {
        // editing a draft keeps it draft until user actually sends
        res = await fetch(`/api/invoices/${editingInvoiceId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        res = await fetch('/api/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }

      if (res.ok) {
        const invoice = await res.json()
        setCreatedInvoiceId(invoice.id)
        setEditingInvoiceId(null)
        setShowCreate(false)          // close the form
        void fetchInvoices()

        // open the newly created one inline (accordion)
        setTimeout(async () => {
          const detailRes = await fetch(`/api/invoices/${invoice.id}`)
          if (detailRes.ok) {
            const full = await detailRes.json()
            setExpandedId(invoice.id)
            setExpandedData(full)
          }
        }, 80)
      }
    } finally {
      setSaving(false)
    }
  }

  const markPaidManual = async (id: string) => {
    setProcessingPayment(id)
    try {
      await fetch(`/api/invoices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PAID', paidDate: new Date().toISOString() }),
      })
      void fetchInvoices()
      if (selectedInvoice?.id === id) await loadInvoiceDetails(id)
    } finally {
      setProcessingPayment(null)
    }
  }

  // Explicit "I actually sent/delivered this invoice to the customer"
  const markSent = async (id: string) => {
    try {
      await fetch(`/api/invoices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'SENT' }),
      })
      void fetchInvoices()
      // refresh accordion if open
      if (expandedId === id) {
        const r = await fetch(`/api/invoices/${id}`)
        if (r.ok) setExpandedData(await r.json())
      }
    } catch {}
  }

  const cancelInvoice = async (id: string) => {
    if (!confirm('Cancel this invoice? It will be marked CANCELLED and can no longer be sent or edited.')) return
    try {
      await fetch(`/api/invoices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      })
      closeDetails()
      void fetchInvoices()
    } catch {}
  }

  const deleteDraft = async (id: string) => {
    if (!confirm('Permanently delete this DRAFT? This will also remove its journal entry. This cannot be undone.')) return
    try {
      await fetch(`/api/invoices/${id}`, { method: 'DELETE' })
      closeDetails()
      void fetchInvoices()
    } catch {}
  }

  const createPaymentLink = async (invoiceId?: string) => {
    const id = invoiceId || createdInvoiceId
    if (!id) return
    setProcessingPayment(id)
    try {
      // Do NOT mark SENT here. Creating a payment link is not "sending" the invoice.
      const res = await fetch('/api/payments/stripe/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: id }),
      })
      const data = await res.json()
      if (data.clientSecret) {
        window.open(`https://pay.stripe.com/${data.id}`, '_blank')
      }
      // Refresh so the detail shows the new paymentLink if we want to surface it
      void fetchInvoices()
      if (expandedId === id) {
        const r = await fetch(`/api/invoices/${id}`)
        if (r.ok) setExpandedData(await r.json())
      }
    } finally {
      setProcessingPayment(null)
    }
  }

  const sendPayPalInvoice = async (invoiceId?: string) => {
    const id = invoiceId || createdInvoiceId
    if (!id) return
    setProcessingPayment(id)
    try {
      // Same rule: payment link creation ≠ sending the invoice to the customer
      const res = await fetch('/api/payments/paypal/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: id }),
      })
      const data = await res.json()
      if (data.link) {
        window.open(data.link, '_blank')
      }
      void fetchInvoices()
      if (expandedId === id) {
        const r = await fetch(`/api/invoices/${id}`)
        if (r.ok) setExpandedData(await r.json())
      }
    } finally {
      setProcessingPayment(null)
    }
  }

  const createAnother = () => {
    setNewContactId('')
    setNewLines([{ description: '', quantity: 1, unitPrice: 0, taxRateId: null }])
    setNotes('')
    setCreatedInvoiceId(null)
    setEditingInvoiceId(null)
  }

  const downloadPdf = (invoiceId: string) => {
    window.open(`/api/invoices/${invoiceId}/pdf`, '_blank')
  }

  const sendViaEmail = async (invoiceId?: string) => {
    const id = invoiceId || createdInvoiceId
    if (!id) return
    setProcessingPayment(id)
    try {
      // Emailing the PDF is a delivery method, not automatic "SENT" status.
      // User can explicitly "Mark as Sent" afterwards if they want the state to reflect that.
      const res = await fetch(`/api/invoices/${id}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.error) {
        alert(data.error)
      } else {
        alert(`Email sent to ${data.sentTo || 'customer'}`)
      }
      void fetchInvoices()
      if (expandedId === id) {
        const r = await fetch(`/api/invoices/${id}`)
        if (r.ok) setExpandedData(await r.json())
      }
    } finally {
      setProcessingPayment(null)
    }
  }

  const openCreate = () => {
    setShowCreate(true)
    setCreatedInvoiceId(null)
    setEditingInvoiceId(null)
    setNotes('')
    // always start a fresh create with exactly ONE clean empty line
    // (this is critical so that the first snippet click replaces it instead of appending empties)
    setNewLines([{ description: '', quantity: 1, unitPrice: 0, taxRateId: null }])
    // default dates
    const today = new Date().toISOString().slice(0, 10)
    setFormIssueDate(today)
    const due = new Date()
    due.setDate(due.getDate() + 30)
    setFormDueDate(due.toISOString().slice(0, 10))
  }

  const closeCreate = () => {
    setShowCreate(false)
    setNewContactId('')
    setNewLines([{ description: '', quantity: 1, unitPrice: 0, taxRateId: null }])
    setFormIssueDate('')
    setFormDueDate('')
    setNotes('')
    setCreatedInvoiceId(null)
    setEditingInvoiceId(null)
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'PAID': return 'bg-emerald-950 text-emerald-400'
      case 'OVERDUE': return 'bg-rose-950 text-rose-400'
      case 'SENT': return 'bg-blue-950 text-blue-400'
      case 'DRAFT': return 'bg-zinc-800 text-zinc-400'
      default: return 'bg-zinc-800 text-zinc-400'
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Invoicing</h1>
          <p className="text-xs text-zinc-500 mt-1">
            AI-first invoicing. Chat on the left to create invoices naturally. Or use the form below.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-3 py-1.5 rounded bg-emerald-500 text-black font-medium text-sm hover:bg-emerald-400"
        >
          New Invoice
        </button>
      </div>

      {/* Recurring controls */}
      <div className="mb-4 flex items-center gap-2 text-xs">
        <button
          onClick={() => setShowRecurring(!showRecurring)}
          className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
        >
          {showRecurring ? 'Hide' : 'Show'} Recurring Schedules
        </button>
        {showCreate && (
          <button onClick={makeRecurring} className="px-3 py-1 rounded bg-emerald-800 text-emerald-200 hover:bg-emerald-700">
            Make this form recurring…
          </button>
        )}
        <span className="text-zinc-500 ml-2">Recurring always creates DRAFT first. You review and send.</span>
      </div>

      {showRecurring && (
        <div className="mb-6 border border-zinc-800 rounded p-3 text-sm">
          <div className="text-xs text-zinc-400 mb-2">Recurring schedules (generate DRAFT invoices on schedule)</div>
          {recurring.length === 0 ? (
            <div className="text-zinc-500 text-xs">No recurring schedules yet. Create one from the invoice form.</div>
          ) : (
            <div className="space-y-1">
              {recurring.map(r => (
                <div key={r.id} className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded px-3 py-1">
                  <div>
                    <span className="font-medium">{r.name}</span>
                    <span className="text-zinc-400 ml-2">• {r.contact?.name}</span>
                    <span className="text-xs ml-2 text-zinc-500">{r.frequency} ×{r.interval} • next {new Date(r.nextDueDate).toLocaleDateString()}</span>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => generateNow(r.id)} className="px-2 py-0.5 rounded bg-emerald-800 text-emerald-200">Generate now</button>
                    <button onClick={() => toggleRecurringStatus(r)} className="px-2 py-0.5 rounded bg-zinc-800">{r.status === 'ACTIVE' ? 'Pause' : 'Resume'}</button>
                    <span className={`px-2 py-0.5 rounded ${r.autoSend ? 'bg-amber-900 text-amber-200' : 'bg-zinc-800'}`}>
                      {r.autoSend ? 'auto-send' : 'draft only'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quick stats */}
      <div className="mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <div className="text-[10px] text-zinc-400">Outstanding</div>
          <div className="text-lg font-semibold tabular-nums mt-0.5">{formatCurrency(stats.outstanding)}</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <div className="text-[10px] text-rose-400">Overdue</div>
          <div className="text-lg font-semibold tabular-nums mt-0.5 text-rose-400">{formatCurrency(stats.overdue)}</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <div className="text-[10px] text-emerald-400">Collected this month</div>
          <div className="text-lg font-semibold tabular-nums mt-0.5 text-emerald-400">{formatCurrency(stats.thisMonthPaid)}</div>
        </div>
      </div>

      {/* Inline creation form (right panel, consistent with chat-left pattern) */}
      {showCreate && (
        <div className="mb-8 border border-zinc-700 rounded-lg p-4 bg-zinc-950">
           <div className="flex items-center justify-between mb-4">
             <div className="font-medium">{editingInvoiceId ? 'Edit Invoice (DRAFT)' : 'Create Invoice'}</div>
             <button onClick={closeCreate} className="text-2xl leading-none px-2 text-zinc-400 hover:text-rose-400" aria-label="Close">×</button>
           </div>

          <div className="max-w-2xl space-y-4">
             <div>
               <label className="text-xs text-zinc-400 block mb-1">Customer *</label>
               <select
                 value={newContactId}
                 onChange={e => setNewContactId(e.target.value)}
                 className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-sm"
               >
                 <option value="">Select a customer...</option>
                 {contacts.map(c => (
                   <option key={c.id} value={c.id}>{c.name}{c.email ? ` (${c.email})` : ''}</option>
                 ))}
               </select>
             </div>

             {/* Issue / Due dates */}
             <div className="grid grid-cols-2 gap-3">
               <div>
                 <label className="text-xs text-zinc-400 block mb-1">Issue Date</label>
                 <input
                   type="date"
                   value={formIssueDate}
                   onChange={e => setFormIssueDate(e.target.value)}
                   className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-sm"
                 />
               </div>
               <div>
                 <label className="text-xs text-zinc-400 block mb-1">Due Date</label>
                 <input
                   type="date"
                   value={formDueDate}
                   onChange={e => setFormDueDate(e.target.value)}
                   className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-sm"
                 />
               </div>
             </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-zinc-400">Line Items</label>
                <button type="button" onClick={addLine} className="text-xs text-emerald-400 hover:text-emerald-300">
                  + Add Line
                </button>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {newLines.map((line, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Description"
                      value={line.description}
                      onChange={e => updateLine(index, 'description', e.target.value)}
                      className="flex-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-sm"
                    />
                    <input
                      type="number" min="1" value={line.quantity}
                      onChange={e => updateLine(index, 'quantity', e.target.value)}
                      className="w-16 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-sm"
                    />
                     <input
                       type="number" min="0" step="0.01" value={line.unitPrice}
                       onChange={e => updateLine(index, 'unitPrice', e.target.value)}
                       className="w-24 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-sm"
                       placeholder="0.00"
                     />
                     <select
                       value={line.taxRateId || ''}
                       onChange={e => updateLine(index, 'taxRateId', e.target.value)}
                       className="w-28 px-1 py-1 rounded bg-zinc-900 border border-zinc-700 text-xs"
                       title="Tax rate"
                     >
                       <option value="">No tax</option>
                       {taxRates.map(tr => (
                         <option key={tr.id} value={tr.id}>
                           {tr.name} ({(tr.rate * 100).toFixed(0)}%)
                         </option>
                       ))}
                     </select>
                     {newLines.length > 1 && (
                       <button type="button" onClick={() => removeLine(index)} className="px-2 text-rose-400 hover:text-rose-300">×</button>
                     )}
                  </div>
                ))}
              </div>
             </div>

               {snippets.length > 0 && (
                 <div>
                   <div className="flex items-center justify-between mb-2">
                     <label className="text-xs text-zinc-400">Saved Snippets</label>
                     <button type="button" onClick={saveAsSnippet} className="text-[10px] text-emerald-400 hover:text-emerald-300">Save current line as snippet</button>
                   </div>
                   <div className="flex flex-wrap gap-1">
                     {snippets.map(s => (
                       <button key={s.id} type="button" onClick={() => applySnippet(s)} className="px-2 py-1 rounded bg-zinc-800 text-xs text-zinc-300 hover:bg-zinc-700" title={(s.description || s.text || '')}>
                         {s.name}
                       </button>
                     ))}
                   </div>
                 </div>
               )}

               {/* Invoice-level free text field + its own text snippets (parallel to line snippets) */}
               <div>
                 <div className="flex items-center justify-between mb-1">
                   <label className="text-xs text-zinc-400">Notes / Message on invoice</label>
                   <button type="button" onClick={saveCurrentTextAsSnippet} className="text-[10px] text-emerald-400 hover:text-emerald-300">Save current text as snippet</button>
                 </div>
                 <textarea
                   value={notes}
                   onChange={e => setNotes(e.target.value)}
                   rows={3}
                   className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-sm"
                   placeholder="Thank you for your business. Payment is due by the due date above."
                 />
                 <div className="mt-2">
                   <div className="text-[10px] text-zinc-400 mb-1">Text Snippets</div>
                   {textSnippets.length > 0 ? (
                     <div className="flex flex-wrap gap-1">
                       {textSnippets.map(ts => (
                         <button key={ts.id} type="button" onClick={() => applyTextSnippet(ts)} className="px-2 py-0.5 rounded bg-zinc-800 text-xs text-zinc-300 hover:bg-zinc-700" title={(ts.text || ts.description || '')}>
                           {ts.name}
                         </button>
                       ))}
                     </div>
                   ) : (
                     <div className="text-[10px] text-zinc-500">No text snippets yet. Write in the Notes box above and click "Save current text as snippet".</div>
                   )}
                 </div>
                </div>

             <div className="border-t border-zinc-700 pt-4 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              {taxTotal > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Tax</span>
                  <span>{formatCurrency(taxTotal)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-medium">
                <span>Total</span>
                <span>{formatCurrency(grandTotal)}</span>
              </div>
            </div>

             <button
               onClick={() => void saveInvoice()}
               disabled={saving || !newContactId || newLines.every(l => !l.description.trim())}
               className="w-full px-4 py-2 rounded bg-emerald-500 text-black font-medium disabled:opacity-50"
             >
               {saving ? (editingInvoiceId ? 'Saving...' : 'Creating...') : (editingInvoiceId ? 'Update Invoice' : 'Create Invoice')}
             </button>
            <div className="text-[10px] text-zinc-500 text-center mt-1">
              Creates as DRAFT. Use Send buttons below to actually deliver it.
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
          className="px-2 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-sm"
        >
          <option value="ALL">All Status</option>
          <option value="DRAFT">Draft</option>
          <option value="SENT">Sent</option>
          <option value="PAID">Paid</option>
          <option value="OVERDUE">Overdue</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {/* Invoice list */}
      <div className="max-w-4xl space-y-2 max-h-[55vh] overflow-y-auto">
        {loading ? (
          <div className="text-zinc-500">Loading...</div>
        ) : invoices.length === 0 ? (
          <div className="text-zinc-500 p-4">No invoices yet. Click &quot;New Invoice&quot; above.</div>
         ) : (
           invoices.map(invoice => (
              <div
                key={invoice.id}
                onClick={() => toggleExpand(invoice.id)}
                className="border border-zinc-800 rounded-lg p-4 bg-zinc-950 hover:border-zinc-700 transition-colors cursor-pointer"
              >
               <div className="flex items-center justify-between">
                 <div>
                   <div className="font-medium">{invoice.invoiceNumber}</div>
                   <div className="text-xs text-zinc-400">{invoice.contact.name}</div>
                   <div className="text-xs text-zinc-500 mt-1">
                     {new Date(invoice.issueDate).toLocaleDateString()} → {new Date(invoice.dueDate).toLocaleDateString()}
                   </div>
                 </div>
                 <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                   <span className={`px-2 py-0.5 rounded text-xs ${statusColor(invoice.status)}`}>
                     {invoice.status}
                   </span>
                   <span className="font-medium">{formatCurrency(invoice.total, invoice.currency)}</span>
                    {invoice.status === 'DRAFT' && (
                       <>
                         <button onClick={(e) => { e.stopPropagation(); 
                           setEditingInvoiceId(invoice.id);
                           setNewContactId(invoice.contact?.id || '');
                           fetch(`/api/invoices/${invoice.id}`).then(r => r.json()).then(full => {
                             const mapped = (full.lines || []).map((l: any) => ({
                               description: l.description,
                               quantity: Number(l.quantity) || 1,
                               unitPrice: Number(l.unitPrice) || 0,
                               taxRateId: l.taxRateId || null,
                             }));
                             setNewLines(mapped.length ? mapped : [{ description: '', quantity: 1, unitPrice: 0, taxRateId: null }]);
                             setFormIssueDate(full.issueDate ? new Date(full.issueDate).toISOString().slice(0,10) : '');
                             setFormDueDate(full.dueDate ? new Date(full.dueDate).toISOString().slice(0,10) : '');
                             setNotes(full.notes || '');
                             setShowCreate(true);
                             setCreatedInvoiceId(null);
                             setExpandedId(null); setExpandedData(null);
                           });
                         }} className="px-2 py-1 rounded text-xs text-emerald-400 hover:text-emerald-300">Edit Invoice</button>

                         <button onClick={(e) => { e.stopPropagation(); void deleteDraft(invoice.id); }} className="px-2 py-1 rounded text-xs text-rose-400 hover:text-rose-300">Delete</button>
                         <button onClick={(e) => { e.stopPropagation(); downloadPdf(invoice.id); }} className="px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200">PDF</button>
                         <button onClick={(e) => { e.stopPropagation(); void sendViaEmail(invoice.id); }} disabled={processingPayment === invoice.id || !emailEnabled} className="px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50" title={!emailEnabled ? 'SMTP not configured' : ''}>Email</button>
                         <button onClick={(e) => { e.stopPropagation(); void markSent(invoice.id); }} className="px-2 py-1 rounded text-xs bg-blue-800 text-blue-200" title="Mark as actually sent to customer">Mark Sent</button>
                       </>
                     )}

                   {invoice.status === 'SENT' && (
                     <>
                       {stripeEnabled && <button onClick={() => void createPaymentLink(invoice.id)} disabled={processingPayment === invoice.id} className="px-2 py-1 rounded text-xs text-zinc-400 hover:text-emerald-400 disabled:opacity-50">Stripe</button>}
                       {paypalEnabled && <button onClick={() => void sendPayPalInvoice(invoice.id)} disabled={processingPayment === invoice.id} className="px-2 py-1 rounded text-xs text-zinc-400 hover:text-blue-400 disabled:opacity-50">PayPal</button>}
                        <button onClick={() => void sendViaEmail(invoice.id)} disabled={processingPayment === invoice.id || !emailEnabled} className="px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50" title={!emailEnabled ? 'SMTP not configured' : ''}>Email</button>
                       <button onClick={() => void markPaidManual(invoice.id)} disabled={processingPayment === invoice.id} className="px-2 py-1 rounded text-xs text-zinc-400 hover:text-emerald-400 disabled:opacity-50">Paid</button>
                       <button onClick={() => downloadPdf(invoice.id)} className="px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200">PDF</button>
                     </>
                   )}

                   {invoice.status === 'PAID' && (
                     <button onClick={() => downloadPdf(invoice.id)} className="px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200">PDF</button>
                   )}

                   {invoice.status === 'CANCELLED' && (
                     <span className="text-[10px] text-zinc-500 px-2">Cancelled</span>
                   )}
                  </div>
                </div>

                {/* Inline accordion details (replaces hidden bottom panel) */}
                {expandedId === invoice.id && expandedData && (
                  <div className="mt-4 border-t border-zinc-800 pt-4 text-sm" onClick={e => e.stopPropagation()}>
                     <div className="flex items-center justify-between mb-3">
                       <div>
                         <div className="font-medium">{expandedData.invoiceNumber} — {expandedData.contact.name}</div>
                         <div className="text-[10px] text-zinc-500">
                           {new Date(expandedData.issueDate).toLocaleDateString()} → {new Date(expandedData.dueDate).toLocaleDateString()}
                           {expandedData.paidDate ? ` • paid ${new Date(expandedData.paidDate).toLocaleDateString()}` : ''}
                         </div>
                       </div>
                       <div className="flex gap-2">
                         <button onClick={() => downloadPdf(expandedData.id)} className="text-xs px-2 py-0.5 rounded bg-zinc-800">PDF</button>
                          <button onClick={() => { setExpandedId(null); setExpandedData(null) }} className="text-xs px-2 py-0.5 rounded bg-zinc-800" aria-label="Close">×</button>
                       </div>
                     </div>

                      <div className="text-xs text-zinc-400 mb-1">Line items</div>
                      <div className="space-y-1 mb-3">
                        {(expandedData.lines || []).map((l: any, i: number) => (
                          <div key={i} className="flex justify-between text-xs">
                            <span>{l.description} × {Number(l.quantity)} @ {formatCurrency(l.unitPrice, expandedData.currency)}{l.taxRate ? ` +${(l.taxRate.rate*100).toFixed(0)}%` : ''}</span>
                            <span>{formatCurrency(l.lineTotal, expandedData.currency)}</span>
                          </div>
                        ))}
                      </div>

                      {expandedData.notes && (
                        <div className="mb-3">
                          <div className="text-xs text-zinc-400 mb-1">Notes</div>
                          <div className="text-xs whitespace-pre-wrap text-zinc-300">{expandedData.notes}</div>
                        </div>
                      )}

                     <div className="flex justify-end text-sm mb-2">
                       <div className="text-right">
                         <div className="text-xs text-zinc-400">Subtotal {formatCurrency(expandedData.subtotal || expandedData.total - (expandedData.taxAmount||0), expandedData.currency)}</div>
                         {(expandedData.taxAmount || 0) > 0 && <div className="text-xs text-zinc-400">Tax {formatCurrency(expandedData.taxAmount, expandedData.currency)}</div>}
                         <div>Total: <span className="font-medium">{formatCurrency(expandedData.total, expandedData.currency)}</span></div>
                         <div className="text-[10px] text-zinc-400">Status: {expandedData.status}</div>
                       </div>
                     </div>

                     {expandedData.journalEntry && (
                       <div className="text-[10px] text-zinc-500 mb-2">
                         Journal: {expandedData.journalEntry.lines?.length || 0} lines • {expandedData.journalEntry.description || ''}
                       </div>
                     )}

                    {/* Lifecycle-aware actions inside the accordion */}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {expandedData.status === 'DRAFT' && (
                        <>
                          <button onClick={() => {
                            setEditingInvoiceId(expandedData.id)
                            setNewContactId(expandedData.contact?.id || '')
                             const mapped = (expandedData.lines || []).map((l: any) => ({
                               description: l.description,
                               quantity: Number(l.quantity) || 1,
                               unitPrice: Number(l.unitPrice) || 0,
                               taxRateId: l.taxRateId || null,
                             }))
                             setNewLines(mapped.length ? mapped : [{ description: '', quantity: 1, unitPrice: 0, taxRateId: null }])
                              setFormIssueDate(expandedData.issueDate ? new Date(expandedData.issueDate).toISOString().slice(0,10) : '')
                              setFormDueDate(expandedData.dueDate ? new Date(expandedData.dueDate).toISOString().slice(0,10) : '')
                              setNotes(expandedData.notes || '')
                              setShowCreate(true)
                              setCreatedInvoiceId(null)
                              setExpandedId(null); setExpandedData(null)
                           }} className="px-3 py-1 text-xs rounded bg-emerald-700">Edit Invoice</button>

                         <button onClick={() => void deleteDraft(expandedData.id)} className="px-3 py-1 text-xs rounded bg-rose-900 text-rose-200">Delete Draft</button>

                            <button onClick={() => void sendViaEmail(expandedData.id)} disabled={processingPayment === expandedData.id || !emailEnabled} className="px-3 py-1 text-xs rounded bg-zinc-700 disabled:opacity-50" title={!emailEnabled ? 'SMTP not configured' : ''}>Email PDF</button>
                           <button onClick={() => void markSent(expandedData.id)} className="px-3 py-1 text-xs rounded bg-blue-800">Mark as Sent</button>
                        </>
                      )}

                      {expandedData.status === 'SENT' && (
                        <>
                          {stripeEnabled && <button onClick={() => void createPaymentLink(expandedData.id)} disabled={processingPayment === expandedData.id} className="px-3 py-1 text-xs rounded bg-emerald-700">Stripe</button>}
                          {paypalEnabled && <button onClick={() => void sendPayPalInvoice(expandedData.id)} disabled={processingPayment === expandedData.id} className="px-3 py-1 text-xs rounded bg-blue-700">PayPal</button>}
                           <button onClick={() => void sendViaEmail(expandedData.id)} disabled={processingPayment === expandedData.id || !emailEnabled} className="px-3 py-1 text-xs rounded bg-zinc-700 disabled:opacity-50" title={!emailEnabled ? 'SMTP not configured' : ''}>Email PDF</button>
                          <button onClick={() => void markPaidManual(expandedData.id)} disabled={processingPayment === expandedData.id} className="px-3 py-1 text-xs rounded bg-emerald-700">Mark Paid</button>
                          <button onClick={() => void markSent(expandedData.id)} className="px-3 py-1 text-xs rounded bg-zinc-700" title="Re-send / confirm sent">Mark Sent (again)</button>
                        </>
                      )}

                      {expandedData.status === 'PAID' && (
                        <button onClick={() => downloadPdf(expandedData.id)} className="px-3 py-1 text-xs rounded bg-zinc-700">Download PDF</button>
                      )}

                      {['DRAFT', 'SENT'].includes(expandedData.status) && (
                        <button onClick={() => void cancelInvoice(expandedData.id)} className="px-3 py-1 text-xs rounded bg-rose-900 text-rose-200 ml-auto">Cancel</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
       </div>

      <div className="mt-4 text-[10px] text-zinc-500">
        Invoices are created as DRAFT. Click a row to expand details in place (accordion). Use "Mark Sent" only when you have actually delivered it.
      </div>
    </div>
  )
}
