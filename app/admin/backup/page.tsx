'use client'

import { useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'

export default function BackupPage() {
  const t = useTranslations('app.backup')
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [status, setStatus] = useState('')

  const handleExport = async () => {
    setExporting(true)
    setStatus('')
    try {
      const res = await fetch('/api/backup/export')
      const data = await res.json()
      
      // Download as JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `entrytwo-backup-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
      
      setStatus(`Exported ${data.data?.accounts?.length || 0} accounts, ${data.data?.journalEntries?.length || 0} entries`)
    } catch {
      setStatus('Export failed')
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImporting(true)
    setStatus('')
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      
      const res = await fetch('/api/backup/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      
      if (!res.ok) throw new Error('Import failed')
      
      const result = await res.json()
      setStatus(`Imported: ${result.imported?.accounts || 0} accounts, ${result.imported?.journalEntries || 0} entries`)
    } catch {
      setStatus('Import failed - invalid file or error')
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Export your data for backup or migration. Supports full data restore.
        </p>
      </div>

      <div className="space-y-6">
        <div className="border border-zinc-800 rounded-lg p-6 bg-zinc-950">
          <div className="font-medium mb-3 flex items-center gap-2">
            <Download className="w-4 h-4" />
            {t('export')}
          </div>
          <p className="text-xs text-zinc-400 mb-4">{t('exportDesc')}</p>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2 rounded bg-emerald-950 text-emerald-400 hover:bg-emerald-900 disabled:opacity-50"
          >
            {exporting ? t('exporting') : 'Export All Data'}
          </button>
        </div>

        <div className="border border-zinc-800 rounded-lg p-6 bg-zinc-950">
          <div className="font-medium mb-3 flex items-center gap-2">
            <Upload className="w-4 h-4" />
            {t('import')}
          </div>
          <p className="text-xs text-zinc-400 mb-4">{t('importDesc')}</p>
          <label className="px-4 py-2 rounded bg-white text-black hover:bg-zinc-200 cursor-pointer inline-block">
            {importing ? t('importing') : t('chooseFile')}
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleImport}
              disabled={importing}
              className="hidden"
            />
          </label>
        </div>

        {status && <div className="text-xs text-zinc-400">{status}</div>}
      </div>
    </div>
  )
}