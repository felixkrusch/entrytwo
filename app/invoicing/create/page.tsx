'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
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
}

interface SavedSnippet {
  id: string
  name: string
  description: string
  quantity: number
  unitPrice: number
}

export default function CreateInvoicePage() {
  const router = useRouter()
  const [contacts, setContacts] = useState<ContactItem[]>([])
  const [snippets, setSnippets] = useState<SavedSnippet[]>([])
  const [processingPayment, setProcessingPayment] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  
  const [newContactId, setNewContactId] = useState('')
  const [newLines, setNewLines] = useState<InvoiceLineForm[]>([{ description: '', quantity: 1, unitPrice: 0 }])
  const [createdInvoiceId, setCreatedInvoiceId] = useState<string | null>(null)

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
      setSnippets(data.snippets || [])
    } catch {}
  }, [])

  useEffect(() => {
    void fetchContacts()
    void fetchSnippets()
  }, [fetchContacts, fetchSnippets])

  const addLine = () => {
    setNewLines([...newLines, { description: '', quantity: 1, unitPrice: 0 }])
  }

  const removeLine = (index: number) => {
    setNewLines(newLines.filter((_, i) => i !== index))
  }

  const updateLine = (index: number, field: keyof InvoiceLineForm, value: string | number) => {
    setNewLines(newLines.map((line, i) => 
      i === index ? { ...line, [field]: field === 'quantity' || field === 'unitPrice' ? Number(value) || 0 : value } : line
    ))
  }

  const applySnippet = (snippet: SavedSnippet) => {
    setNewLines([...newLines, { 
      description: snippet.description, 
      quantity: snippet.quantity, 
      unitPrice: snippet.unitPrice 
    }])
  }

  const subtotal = useMemo(() => {
    return newLines.reduce((sum, line) => sum + (line.quantity * line.unitPrice), 0)
  }, [newLines])

  const saveInvoice = async () => {
    if (!newContactId || newLines.every(l => !l.description.trim())) return
    setSaving(true)
    try {
      const validLines = newLines.filter(l => l.description.trim())
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: newContactId,
          lines: validLines.map(l => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice
          }))
        })
      })
      if (res.ok) {
        const invoice = await res.json()
        setCreatedInvoiceId(invoice.id)
      }
    } finally {
      setSaving(false)
    }
  }

  const createPaymentLink = async () => {
    if (!createdInvoiceId) return
    setProcessingPayment(createdInvoiceId)
    try {
      const res = await fetch('/api/payments/stripe/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: createdInvoiceId }),
      })
      const data = await res.json()
      if (data.clientSecret) {
        window.open(`https://pay.stripe.com/${data.id}`, '_blank')
      }
    } finally {
      setProcessingPayment(null)
    }
  }

  const sendPayPalInvoice = async () => {
    if (!createdInvoiceId) return
    setProcessingPayment(createdInvoiceId)
    try {
      const res = await fetch('/api/payments/paypal/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: createdInvoiceId }),
      })
      const data = await res.json()
      if (data.link) {
        window.open(data.link, '_blank')
      }
    } finally {
      setProcessingPayment(null)
    }
  }

  const createAnother = () => {
    setNewContactId('')
    setNewLines([{ description: '', quantity: 1, unitPrice: 0 }])
    setCreatedInvoiceId(null)
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Create Invoice</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Build invoices with smart defaults and one-click payment options.
          </p>
        </div>
        <button
          onClick={() => router.push('/app?view=invoicing')}
          className="px-3 py-1.5 rounded bg-zinc-800 text-zinc-300 text-sm"
        >
          Back to Invoices
        </button>
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

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-zinc-400">Line Items</label>
            <button
              type="button"
              onClick={addLine}
              className="text-xs text-emerald-400 hover:text-emerald-300"
            >
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
                  type="number"
                  min="1"
                  value={line.quantity}
                  onChange={e => updateLine(index, 'quantity', e.target.value)}
                  className="w-16 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-sm"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.unitPrice}
                  onChange={e => updateLine(index, 'unitPrice', e.target.value)}
                  className="w-24 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-sm"
                  placeholder="0.00"
                />
                {newLines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLine(index)}
                    className="px-2 text-rose-400 hover:text-rose-300"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {snippets.length > 0 && (
          <div>
            <label className="text-xs text-zinc-400 block mb-2">Saved Snippets</label>
            <div className="flex flex-wrap gap-1">
              {snippets.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => applySnippet(s)}
                  className="px-2 py-1 rounded bg-zinc-800 text-xs text-zinc-300 hover:bg-zinc-700"
                  title={s.description}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-zinc-700 pt-4">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm font-medium mt-1">
            <span>Total</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
        </div>

        {!createdInvoiceId ? (
          <button
            onClick={() => void saveInvoice()}
            disabled={saving || !newContactId || newLines.every(l => !l.description.trim())}
            className="w-full px-4 py-2 rounded bg-emerald-500 text-black font-medium disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Create Invoice'}
          </button>
        ) : (
          <div className="space-y-2">
            <div className="text-emerald-400 text-sm mb-2">Invoice created!</div>
            <button
              onClick={() => void createPaymentLink()}
              disabled={processingPayment === createdInvoiceId}
              className="w-full px-4 py-2 rounded bg-emerald-500 text-black font-medium disabled:opacity-50"
            >
              Send via Stripe
            </button>
            <button
              onClick={() => void sendPayPalInvoice()}
              disabled={processingPayment === createdInvoiceId}
              className="w-full px-4 py-2 rounded bg-blue-500 text-white font-medium disabled:opacity-50"
            >
              Send via PayPal
            </button>
            <button
              onClick={createAnother}
              className="w-full px-4 py-2 rounded bg-zinc-800 text-zinc-300 font-medium"
            >
              Create Another Invoice
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
