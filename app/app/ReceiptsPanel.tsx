'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

interface ReceiptItem {
  name: string
  url: string
  size: number
  mtime: string | null
}

export default function ReceiptsPanel() {
  const [items, setItems] = useState<ReceiptItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    fetch('/api/receipts')
      .then(r => r.json())
      .then(d => {
        if (d && Array.isArray(d.receipts)) setItems(d.receipts)
        else setItems([])
      })
      .catch(() => setError('Failed to load receipts'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const del = async (name: string) => {
    if (!confirm(`Delete ${name}?`)) return
    try {
      const res = await fetch(`/api/receipts?file=${encodeURIComponent(name)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      toast.success('Deleted')
      load()
    } catch (e: any) {
      toast.error(e?.message || 'Delete failed')
    }
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">Uploaded receipts &amp; invoices</div>
        <button onClick={load} className="text-[10px] px-2 py-0.5 border border-zinc-700 rounded text-zinc-400 hover:bg-zinc-800">Refresh</button>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500">Loading…</div>
      ) : error ? (
        <div className="text-sm text-rose-400">{error}</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-zinc-500">No files yet. Upload PDFs or images via the paperclip in chat.</div>
      ) : (
        <div className="border border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950 text-zinc-400">
              <tr>
                <th className="text-left px-3 py-2 font-normal">File</th>
                <th className="text-left px-3 py-2 font-normal w-24">Size</th>
                <th className="text-left px-3 py-2 font-normal w-44">Uploaded</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-zinc-800 hover:bg-zinc-900/50">
                  <td className="px-3 py-2 font-mono text-xs break-all">
                    <a href={it.url} target="_blank" rel="noopener" className="text-emerald-400 hover:underline">{it.name}</a>
                  </td>
                  <td className="px-3 py-2 text-zinc-400 text-xs">{Math.round(it.size / 1024)} KB</td>
                   <td className="px-3 py-2 text-zinc-400 text-xs">{it.mtime ? new Date(it.mtime).toLocaleString() : '—'}</td>
                   <td className="px-3 py-2 text-right">
                     <a href={it.url} target="_blank" rel="noopener" className="text-[10px] px-2 py-0.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800">Open</a>
                     <button onClick={() => del(it.name)} className="ml-2 text-[10px] px-2 py-0.5 rounded border border-rose-800 text-rose-400 hover:bg-rose-950">Delete</button>
                   </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-2 text-[10px] text-zinc-500">
        Files are stored under <code className="text-zinc-400">/public/uploads/receipts</code> and linked to journal entries when used.
      </div>
    </div>
  )
}
