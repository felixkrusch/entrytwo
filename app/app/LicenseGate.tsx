'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

interface LicenseGateProps {
  onActivated: () => void
}

export default function LicenseGate({ onActivated }: LicenseGateProps) {
  const t = useTranslations('app.views.license')
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || t('invalid'))
      }
    } catch {
      setError(t('failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center h-full bg-zinc-950 p-6">
      <div className="max-w-md w-full text-center">
        <h1 className="text-2xl font-semibold text-white mb-2">{t('required')}</h1>
        <p className="text-zinc-400 mb-6">
          {t('verifyOnce')}
        </p>

        <div className="space-y-3">
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t('pasteHere')}
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-mono text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleActivate()
            }}
          />
          <button
            onClick={() => void handleActivate()}
            disabled={loading || !key.trim()}
            className="w-full rounded bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? t('activating') : t('activate')}
          </button>
          {error && <div className="text-sm text-rose-400">{error}</div>}
        </div>

        <div className="mt-6 text-xs text-zinc-500">
          <a href="https://entrytwo.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
            {t('getOne')}
          </a>
        </div>
      </div>
    </div>
  )
}
