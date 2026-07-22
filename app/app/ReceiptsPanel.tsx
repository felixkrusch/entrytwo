'use client'

import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslations } from 'next-intl'

interface ReceiptItem {
  fileAssetId: string
  name: string
  url: string
  size: number
  mtime: string | null
}

export default function ReceiptsPanel() {
  const t = useTranslations('app.views.receipts')
  const tShell = useTranslations('app.shell')
  const [items, setItems] = useState<ReceiptItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const limit = 20

  const uploadInputRef = useRef<HTMLInputElement>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    fetch(`/api/receipts?page=${page}&limit=${limit}`)
      .then(r => r.json())
      .then(d => {
        if (d && Array.isArray(d.receipts)) {
          setItems(d.receipts)
          setTotal(typeof d.total === 'number' ? d.total : d.receipts.length)
        } else {
          setItems([])
          setTotal(0)
        }
      })
      .catch(() => setError(t('loadFailed')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page])

  const del = async (id: string, name: string) => {
    if (!confirm(t('deleteConfirm', { name }))) return
    try {
      const res = await fetch(`/api/receipts?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      toast.success(t('deleted'))
      load()
    } catch (e: unknown) {
      const msg = (e as Error)?.message || t('deleteFailed')
      toast.error(msg)
    }
  }

  const triggerUpload = () => {
    uploadInputRef.current?.click()
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || [])
    if (!selected.length) return

    const allowed = selected.filter(f => {
      const n = f.name.toLowerCase()
      return n.endsWith('.pdf') || /\.(jpg|jpeg|png|webp)$/.test(n) || f.type.startsWith('image/')
    })

    if (!allowed.length) {
      toast.error(t('selectTypes'))
      e.target.value = ''
      return
    }

    const form = new FormData()
    allowed.forEach(f => form.append('file', f))

    try {
      const res = await fetch('/api/invoices/process', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || !data?.saved?.length) {
        throw new Error('upload failed')
      }
      toast.success(`${allowed.length}`)
      load()
    } catch {
      toast.error(t('uploadFailed'))
    } finally {
      e.target.value = ''
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">{t('title')}</div>
        <div className="flex items-center gap-2">
          <button
            onClick={triggerUpload}
            className="text-xs px-2 py-1 bg-zinc-800 rounded hover:bg-zinc-700 text-zinc-200"
          >
            {t('uploadBtn')}
          </button>
          <button onClick={load} className="text-[10px] px-2 py-0.5 border border-zinc-700 rounded text-zinc-400 hover:bg-zinc-800">{t('refresh')}</button>
        </div>
      </div>

      <input
        ref={uploadInputRef}
        type="file"
        accept=".pdf,image/jpeg,image/jpg,image/png,image/webp"
        className="hidden"
        multiple
        onChange={handleUpload}
      />

      {loading ? (
        <div className="text-sm text-zinc-500">{t('loading')}</div>
      ) : error ? (
        <div className="text-sm text-rose-400">{error}</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-zinc-500">{t('empty')}</div>
      ) : (
        <div className="border border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950 text-zinc-400">
              <tr>
                <th className="text-left px-3 py-2 font-normal">{t('file')}</th>
                <th className="text-left px-3 py-2 font-normal w-24">{t('size')}</th>
                <th className="text-left px-3 py-2 font-normal w-44">{t('uploaded')}</th>
                <th className="w-28 text-right pr-3">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-zinc-800 hover:bg-zinc-900/50">
                  <td className="px-3 py-2 font-mono text-xs break-all">
                    <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">{it.name}</a>
                  </td>
                  <td className="px-3 py-2 text-zinc-400 text-xs">{Math.round(it.size / 1024)} KB</td>
                  <td className="px-3 py-2 text-zinc-400 text-xs">{it.mtime ? new Date(it.mtime).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2 text-right">
                     <button onClick={() => del(it.fileAssetId, it.name)} className="text-[10px] px-2 py-0.5 rounded border border-rose-800 text-rose-400 hover:bg-rose-950">{t('delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > limit && (
        <div className="flex items-center justify-between mt-2 text-[10px] text-zinc-400">
          <div>
            {tShell('contactsPage', { page, pages: totalPages })} • {total}
          </div>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-2 py-0.5 border border-zinc-700 rounded disabled:opacity-40 hover:bg-zinc-800"
            >
              {tShell('contactsPrev')}
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="px-2 py-0.5 border border-zinc-700 rounded disabled:opacity-40 hover:bg-zinc-800"
            >
              {tShell('contactsNext')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
