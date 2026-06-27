'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

type UpdateStatus = {
  currentCommit: string
  latestCommit: string
  updateAvailable: boolean
  lastChecked: string
  status: 'idle' | 'checking' | 'updating' | 'success' | 'error'
  progress: string
  error?: string
  message?: string
}

export default function UpdatePage() {
  const t = useTranslations('app.panels.admin')
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [createBackup, setCreateBackup] = useState(true)

  const checkForUpdates = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/update')
      if (res.ok) {
        const data = await res.json()
        setStatus(data)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  const performUpdate = async () => {
    if (!status?.updateAvailable) return

    if (!confirm(t('updateConfirm'))) return

    setUpdating(true)
    try {
      const res = await fetch('/api/admin/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', createBackup }),
      })

      const data = await res.json()

      if (res.ok) {
        setStatus({ ...status, status: 'success', message: data.message })
        setTimeout(() => window.location.reload(), 3000)
      } else {
        setStatus({ ...status, status: 'error', error: data.error })
      }
    } catch (e) {
      setStatus({ ...status, status: 'error', error: e instanceof Error ? e.message : 'Unknown error' })
    } finally {
      setUpdating(false)
    }
  }

  useEffect(() => {
    void checkForUpdates()
    const interval = setInterval(() => void checkForUpdates(), 60000)
    return () => clearInterval(interval)
  }, [])

  if (loading && !status) {
    return <div className="text-sm text-zinc-500">{t('loading')}</div>
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t('systemUpdate')}</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Check for and apply updates to entrytwo.
        </p>
      </div>

      {status && (
        <div className="space-y-4">
          <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-950">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-zinc-400 text-xs">Current Version</div>
                <div className="font-mono text-sm">#{status.currentCommit}</div>
              </div>
              {status.updateAvailable && (
                <div>
                  <div className="text-zinc-400 text-xs">{t('updateAvailable')}</div>
                  <div className="font-mono text-sm text-emerald-400">#{status.latestCommit}</div>
                </div>
              )}
            </div>

            {status.updateAvailable && (
              <div className="flex items-center gap-2 mb-4">
                <input
                  type="checkbox"
                  id="backup"
                  checked={createBackup}
                  onChange={e => setCreateBackup(e.target.checked)}
                  className="w-4 h-4"
                />
                <label htmlFor="backup" className="text-sm">
                  Create backup before update
                </label>
              </div>
            )}

            {status.status === 'updating' && (
              <div className="mb-4">
                <div className="text-emerald-400 text-sm mb-2">{status.progress || 'Updating...'}</div>
                <div className="w-full bg-zinc-800 rounded-full h-2">
                  <div className="bg-emerald-500 h-2 rounded-full animate-pulse" style={{ width: '100%' }}></div>
                </div>
              </div>
            )}

            {status.status === 'success' && (
              <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded">
                <div className="text-emerald-400 font-medium">Update completed successfully!</div>
                <div className="text-xs text-zinc-400 mt-1">Page will reload shortly...</div>
              </div>
            )}

            {status.status === 'error' && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded">
                <div className="text-rose-400 font-medium">Update failed</div>
                <div className="text-xs text-zinc-400 mt-1">{status.error}</div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => void checkForUpdates()}
                disabled={loading || updating}
                className="px-4 py-2 rounded bg-zinc-700 text-white font-medium text-sm hover:bg-zinc-600 disabled:opacity-50"
              >
                {loading ? t('loading') : t('refresh')}
              </button>

              {status.updateAvailable && (
                <button
                  onClick={() => void performUpdate()}
                  disabled={updating}
                  className="px-4 py-2 rounded bg-emerald-500 text-black font-medium text-sm hover:bg-emerald-400 disabled:opacity-50"
                >
                  {updating ? 'Updating...' : t('updateNow')}
                </button>
              )}
            </div>
          </div>

          {!status.updateAvailable && status && (
            <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-950">
              <div className="text-sm text-emerald-400">
                ✓ {t('upToDate')}
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                Last checked: {new Date(status.lastChecked).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}