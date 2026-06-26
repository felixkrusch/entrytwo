'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useNewEntry, type NewEntrySuggestion } from './NewEntryContext'

interface Template {
  id: string
  name: string
  description: string
  lines: Array<{
    accountCode: string
    debit?: number
    credit?: number
    taxRateId?: string
  }>
}

export default function TemplatesPanel() {
  const t = useTranslations('app.panels.templates')
  const { openNewEntry } = useNewEntry()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')

  const fetchTemplates = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/templates')
      if (!res.ok) throw new Error('Failed to load templates')
      const data = await res.json()
      if (Array.isArray(data)) setTemplates(data)
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTemplates()
    const handler = () => fetchTemplates()
    window.addEventListener('journal-updated', handler)
    return () => window.removeEventListener('journal-updated', handler)
  }, [])

  const useTemplate = (tpl: Template) => {
    const suggestion: NewEntrySuggestion = {
      description: tpl.description,
      lines: tpl.lines.map(l => ({
        accountCode: l.accountCode,
        debit: l.debit,
        credit: l.credit,
        taxRateId: l.taxRateId,
      })),
      source: 'chat',
    }
    openNewEntry(suggestion)
  }

  const deleteTemplate = async (id: string) => {
    if (!confirm('Delete this template?')) return
    await fetch(`/api/templates/${id}`, { method: 'DELETE' })
    fetchTemplates()
  }

  return (
    <div className="mt-8">
      {error && <div className="text-[10px] text-rose-400 mb-2">{error}</div>}
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-zinc-500">Transaction Templates</div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-white"
        >
          {t('add') || '+ New Template'}
        </button>
      </div>

      {showAdd && (
        <div className="mb-3 p-3 rounded-lg bg-zinc-950 border border-zinc-800">
          <div className="text-xs text-zinc-400 mb-2">Save current entry as template (coming soon)</div>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Template name"
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm mb-2"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="flex-1 px-2 py-1 rounded bg-zinc-800 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-zinc-500 text-sm">Loading templates...</div>
      ) : templates.length === 0 ? (
        <div className="text-zinc-500 text-sm">No templates yet. Create one from journal entries.</div>
      ) : (
        <div className="space-y-2 text-sm">
          {templates.map(tpl => (
            <div key={tpl.id} className="flex items-center justify-between p-3 rounded-lg bg-zinc-950 border border-zinc-800 hover:bg-zinc-900 transition-colors">
              <div>
                <div className="font-medium">{tpl.name}</div>
                <div className="text-xs text-zinc-500">{tpl.description || tpl.lines.length + ' line(s)'}</div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => useTemplate(tpl)}
                  className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 hover:bg-emerald-900"
                >
                  Use
                </button>
                <button
                  onClick={() => deleteTemplate(tpl.id)}
                  className="text-xs px-2 py-0.5 rounded bg-rose-950 text-rose-400 hover:bg-rose-900"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}