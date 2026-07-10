'use client'

import { useRef, useState } from 'react'
import { Archive, CheckCircle2, Database, FileArchive, HardDriveDownload, ReceiptText, ShieldAlert, Upload } from 'lucide-react'

type ImportResult = {
  ok: boolean
  version: number
  exportedAt: string
  imported: Record<string, number>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export default function BackupPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [importing, setImporting] = useState(false)
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string; details?: string[] } | null>(null)

  const handleExport = () => {
    setStatus(null)
    // A normal browser navigation streams directly to disk instead of buffering a multi-GB archive in JavaScript.
    window.location.assign('/api/backup/export')
  }

  const handleImport = async () => {
    if (!selectedFile || !confirmed || importing) return
    setImporting(true)
    setStatus(null)
    try {
      const response = await fetch('/api/backup/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/gzip',
          'X-Entrytwo-Confirm-Replace': 'replace-all-data',
        },
        body: selectedFile,
      })
      const result = await response.json() as ImportResult & { error?: string }
      if (!response.ok) throw new Error(result.error || 'Restore failed')

      const details = Object.entries(result.imported)
        .filter(([, count]) => count > 0)
        .map(([name, count]) => `${count.toLocaleString()} ${name}`)
      setStatus({
        kind: 'success',
        message: `Backup from ${new Date(result.exportedAt).toLocaleString()} restored successfully.`,
        details,
      })
      setSelectedFile(null)
      setConfirmed(false)
      if (fileRef.current) fileRef.current.value = ''
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Restore failed' })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-400">
          <Archive className="h-4 w-4" />
          Disaster recovery
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Portable backup and restore</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
          Move a complete entrytwo installation between local machines or VPS hosts. One compressed archive contains all accounting records, Git history, users, configuration, feeds, schedules, invoices, and uploaded receipts or statements.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 font-medium text-zinc-100">
                <HardDriveDownload className="h-4 w-4 text-emerald-400" />
                Export complete archive
              </h2>
              <p className="mt-2 text-xs leading-5 text-zinc-500">The download is compressed and streamed directly to disk.</p>
            </div>
            <span className="rounded border border-emerald-900 bg-emerald-950/50 px-2 py-1 font-mono text-[10px] text-emerald-400">.etbackup</span>
          </div>

          <div className="my-6 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <Database className="mb-2 h-4 w-4 text-sky-400" />
              <div className="text-xs font-medium text-zinc-200">Complete database</div>
              <div className="mt-1 text-[11px] leading-4 text-zinc-500">All tables, original IDs, relationships, branches, events, and settings.</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <ReceiptText className="mb-2 h-4 w-4 text-amber-400" />
              <div className="text-xs font-medium text-zinc-200">All documents</div>
              <div className="mt-1 text-[11px] leading-4 text-zinc-500">Receipts, invoices, card statements, and bank statements.</div>
            </div>
          </div>

          <div className="mb-5 rounded-lg border border-zinc-800 bg-black/20 p-3 text-[11px] leading-5 text-zinc-500">
            Every database table and receipt is recorded in a versioned manifest with its byte size and SHA-256 checksum. Restore rejects incomplete, modified, or unsupported archives before changing data.
          </div>

          <button
            type="button"
            onClick={handleExport}
            className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400"
          >
            <FileArchive className="h-4 w-4" />
            Download full backup
          </button>
        </section>

        <section className="rounded-xl border border-rose-950 bg-zinc-950 p-6">
          <div>
            <h2 className="flex items-center gap-2 font-medium text-zinc-100">
              <Upload className="h-4 w-4 text-rose-400" />
              Restore complete archive
            </h2>
            <p className="mt-2 text-xs leading-5 text-zinc-500">Designed for a fresh installation or a deliberate full rollback.</p>
          </div>

          <div className="my-5 flex gap-3 rounded-lg border border-rose-900/60 bg-rose-950/25 p-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <div className="text-xs leading-5 text-rose-200">
              Restore replaces the entire current database and receipt directory. It is not a merge. Existing users and sessions are replaced by those in the archive.
            </div>
          </div>

          <label className="block cursor-pointer rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-5 text-center transition hover:border-zinc-600 hover:bg-zinc-900">
            <FileArchive className="mx-auto h-6 w-6 text-zinc-500" />
            <div className="mt-2 text-sm text-zinc-300">{selectedFile ? selectedFile.name : 'Choose an entrytwo backup archive'}</div>
            <div className="mt-1 text-[11px] text-zinc-500">{selectedFile ? formatBytes(selectedFile.size) : '.etbackup files only'}</div>
            <input
              ref={fileRef}
              type="file"
              accept=".etbackup,application/gzip"
              disabled={importing}
              className="hidden"
              onChange={event => {
                setSelectedFile(event.target.files?.[0] || null)
                setConfirmed(false)
                setStatus(null)
              }}
            />
          </label>

          <label className={`mt-4 flex items-start gap-3 rounded-lg border p-3 text-xs leading-5 ${selectedFile ? 'cursor-pointer border-zinc-800 text-zinc-300' : 'cursor-not-allowed border-zinc-900 text-zinc-600'}`}>
            <input
              type="checkbox"
              className="mt-1 accent-rose-500"
              checked={confirmed}
              disabled={!selectedFile || importing}
              onChange={event => setConfirmed(event.target.checked)}
            />
            <span>I understand that this permanently replaces all current entrytwo data and uploaded documents.</span>
          </label>

          <button
            type="button"
            onClick={handleImport}
            disabled={!selectedFile || !confirmed || importing}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Upload className="h-4 w-4" />
            {importing ? 'Validating and restoring...' : 'Replace all data from backup'}
          </button>
        </section>
      </div>

      {status && (
        <div className={`mt-6 rounded-xl border p-4 ${status.kind === 'success' ? 'border-emerald-900 bg-emerald-950/30' : 'border-rose-900 bg-rose-950/30'}`}>
          <div className={`flex items-center gap-2 text-sm font-medium ${status.kind === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}>
            {status.kind === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            {status.message}
          </div>
          {status.details?.length ? <div className="mt-2 text-[11px] leading-5 text-zinc-400">{status.details.join(' · ')}</div> : null}
        </div>
      )}

      <div className="mt-8 border-t border-zinc-800 pt-5 text-[11px] leading-5 text-zinc-500">
        For VPS and Docker installations, keep the uploads volume persistent between container replacements. Export archives remain the portable off-host recovery copy and should be stored separately from the server. To preserve encrypted bank-feed credentials when moving hosts, configure the original <code className="text-zinc-300">ENCRYPTION_KEY</code> on the fresh installation before restoring.
      </div>
    </div>
  )
}
