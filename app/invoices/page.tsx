'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Search, FileText, Send, Eye } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

interface Invoice {
  id: string
  invoiceNumber: string
  status: string
  currency: string
  total: number
  issueDate: string
  dueDate: string
  paidDate?: string
  contact: { name: string }
}

export default function InvoicingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/invoices')
      const data = await res.json()
      setInvoices(data.invoices || [])
    } catch (error) {
      console.error('Error fetching invoices:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInvoices()
  }, [fetchInvoices])

  const statusColor = (status: string) => {
    switch (status) {
      case 'PAID': return 'bg-emerald-950 text-emerald-400'
      case 'OVERDUE': return 'bg-rose-950 text-rose-400'
      case 'SENT': return 'bg-blue-950 text-blue-400'
      default: return 'bg-zinc-800 text-zinc-400'
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Invoicing</h1>
          <p className="text-xs text-zinc-500 mt-1">Create and manage invoices.</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500 text-black font-medium text-sm hover:bg-emerald-400"
        >
          <Plus className="w-4 h-4" />
          New Invoice
        </button>
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          placeholder="Search invoices..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-sm"
        />
      </div>

      {loading ? (
        <div className="text-zinc-500">Loading...</div>
      ) : invoices.length === 0 ? (
        <div className="text-zinc-500">No invoices yet. Create your first invoice!</div>
      ) : (
        <div className="space-y-2">
          {invoices.map(invoice => (
            <div
              key={invoice.id}
              className="border border-zinc-800 rounded-lg p-4 bg-zinc-950 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{invoice.invoiceNumber}</div>
                  <div className="text-xs text-zinc-400">{invoice.contact.name}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${statusColor(invoice.status)}`}>
                    {invoice.status}
                  </span>
                  <span className="font-medium">{formatCurrency(invoice.total, invoice.currency)}</span>
                  <button className="p-1 hover:text-zinc-300" title="Preview">
                    <Eye className="w-4 h-4" />
                  </button>
                  <button className="p-1 hover:text-zinc-300" title="Send">
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-6 w-full max-w-lg">
            <h2 className="text-lg font-semibold mb-4">Create New Invoice</h2>
            <p className="text-sm text-zinc-400 mb-4">
              AI-powered invoice creation coming soon. 
              <br /><br />
              For now, create invoices via the API or let me know what you'd like to build!
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 px-4 py-2 rounded bg-zinc-800 text-zinc-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
