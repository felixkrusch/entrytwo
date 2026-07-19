'use client'

import { useState } from 'react'

/**
 * LicenseModal
 *
 * Reusable modal for entering a license key.
 *
 * This is the user-facing entry point that leads to the single activation call
 * (`/api/license/activate`), which is the only place the app ever contacts the
 * external verify service. After success, "verify once, trust forever" applies.
 */
interface LicenseModalProps {
  isOpen: boolean
  onClose: () => void
  onActivated: () => void
}

export default function LicenseModal({ isOpen, onClose, onActivated }: LicenseModalProps) {
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleActivate = async () => {
    if (!key.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim() }),
      })
      if (res.ok) {
        onActivated()
        onClose()
        setKey('')
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Invalid license key')
      }
    } catch {
      setError('Failed to activate license')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-950 p-6 text-sm">
        <div className="mb-4 text-base font-medium text-white">Enter License Key</div>

        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste your license key"
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          onKeyDown={(e) => { if (e.key === 'Enter') void handleActivate() }}
        />

        {error && <div className="mt-2 text-xs text-rose-400">{error}</div>}

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => { setKey(''); onClose() }}
            className="flex-1 rounded border border-zinc-700 px-4 py-2 text-zinc-300 hover:bg-zinc-900"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleActivate()}
            disabled={loading || !key.trim()}
            className="flex-1 rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? 'Verifying...' : 'Activate'}
          </button>
        </div>

        <div className="mt-3 text-[10px] text-zinc-500">
          Don&apos;t have a key? <a href="https://entrytwo.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Get one at entrytwo.com</a>
        </div>
      </div>
    </div>
  )
}
