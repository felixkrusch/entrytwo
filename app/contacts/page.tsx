'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Search, Plus } from 'lucide-react'

interface Contact {
  id: string
  name: string
  email?: string
  type: 'CUSTOMER' | 'VENDOR'
  phone?: string
  address?: string
  taxId?: string
  currency?: string
  notes?: string
  entryCount: number
  vatValidated?: boolean
  vatValid?: boolean
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CUSTOMER' | 'VENDOR'>('ALL')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [showAddModal, setShowAddModal] = useState(false)
  
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newType, setNewType] = useState<'CUSTOMER' | 'VENDOR'>('CUSTOMER')
  const [newPhone, setNewPhone] = useState('')
  const [newTaxId, setNewTaxId] = useState('')

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '20',
      })
      if (search) params.set('search', search)
      if (typeFilter !== 'ALL') params.set('type', typeFilter)

      const res = await fetch(`/api/contacts?${params}`)
      if (res.ok) {
        const data = await res.json()
        setContacts(data.contacts || [])
        setTotalPages(data.pages || 1)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [search, typeFilter, currentPage])

  useEffect(() => {
    void fetchContacts()
  }, [fetchContacts])

  const createContact = async () => {
    if (!newName.trim()) return
    await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName,
        email: newEmail || undefined,
        type: newType,
        phone: newPhone || undefined,
        taxId: newTaxId || undefined,
      }),
    })
    setNewName('')
    setNewEmail('')
    setNewPhone('')
    setNewTaxId('')
    setShowAddModal(false)
    void fetchContacts()
  }

  const filteredContacts = useMemo(() => {
    return contacts.filter(c => {
      if (typeFilter !== 'ALL' && c.type !== typeFilter) return false
      if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && 
          !(c.email || '').toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [contacts, search, typeFilter])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Contacts</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Manage customers and vendors.
        </p>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search contacts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-sm"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as 'ALL' | 'CUSTOMER' | 'VENDOR')}
          className="px-2 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-sm"
        >
          <option value="ALL">All types</option>
          <option value="CUSTOMER">Customers</option>
          <option value="VENDOR">Vendors</option>
        </select>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500 text-black font-medium text-sm hover:bg-emerald-400"
        >
          <Plus className="w-4 h-4" />
          Add Contact
        </button>
      </div>

      {loading ? (
        <div className="text-zinc-500">Loading...</div>
      ) : filteredContacts.length === 0 ? (
        <div className="text-zinc-500">No contacts yet.</div>
      ) : (
        <div className="space-y-2">
          {filteredContacts.map(contact => (
            <div
              key={contact.id}
              className="border border-zinc-800 rounded-lg p-4 bg-zinc-950 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{contact.name}</div>
                  <div className="flex items-center gap-2 mt-1 text-xs">
                    <span className={`px-2 py-0.5 rounded ${
                      contact.type === 'CUSTOMER' 
                        ? 'bg-emerald-950 text-emerald-400' 
                        : 'bg-amber-950 text-amber-400'
                    }`}>
                      {contact.type === 'CUSTOMER' ? 'Customer' : 'Vendor'}
                    </span>
                    {contact.entryCount > 0 && (
                      <span className="text-zinc-500">{contact.entryCount} entries</span>
                    )}
                  </div>
                  {contact.email && (
                    <a href={`mailto:${contact.email}`} className="text-xs text-blue-400 hover:underline mt-1 block">
                      {contact.email}
                    </a>
                  )}
                  {contact.phone && (
                    <span className="text-xs text-zinc-400 mt-1 block">{contact.phone}</span>
                  )}
                  {contact.taxId && (
                    <span className="text-xs text-zinc-400 mt-1 block">Tax: {contact.taxId}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {contact.vatValidated !== undefined && (
                    <span className={`text-xs ${contact.vatValid ? 'text-emerald-400' : 'text-rose-400'}`} title={contact.vatValid ? 'VAT valid' : 'VAT invalid'}>
                      {contact.vatValid ? '✓' : '✗'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1 rounded bg-zinc-800 text-zinc-300 disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-sm text-zinc-500">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-1 rounded bg-zinc-800 text-zinc-300 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">Add Contact</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Type</label>
                <select
                  value={newType}
                  onChange={e => setNewType(e.target.value as 'CUSTOMER' | 'VENDOR')}
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                >
                  <option value="CUSTOMER">Customer</option>
                  <option value="VENDOR">Vendor</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Phone</label>
                <input
                  type="text"
                  value={newPhone}
                  onChange={e => setNewPhone(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                  placeholder="+49 123 456789"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Tax ID</label>
                <input
                  type="text"
                  value={newTaxId}
                  onChange={e => setNewTaxId(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700"
                  placeholder="DE276452187"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={createContact}
                className="flex-1 px-4 py-2 rounded bg-emerald-500 text-black font-medium"
              >
                Add Contact
              </button>
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded bg-zinc-800 text-zinc-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}