'use client'

import { useEffect, useState, useRef } from 'react'
import { useTranslations } from 'next-intl'

type UpdateStatus = {
  currentVersion: string
  latestVersion: string
  targetDigest?: string
  channel?: string
  changelogUrl?: string
  appImage?: string
  updateAvailable: boolean
  lastChecked: string
  status: 'idle' | 'checking' | 'updating' | 'success' | 'error'
  progress: string
  error?: string
  message?: string
  backupPath?: string
  licensed?: boolean
  inTrial?: boolean
}

export default function UpdatePage() {
  const t = useTranslations('app.panels.admin')
  const tPages = useTranslations('app.adminPages')
  const tForm = useTranslations('app.updateForm')
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const pollUntilDone = () => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/admin/update')
        if (!res.ok) return
        const data = await res.json()
        setStatus(data)
        if (data.status !== 'updating') {
          stopPolling()
          setUpdating(false)
        }
      } catch {
        // keep polling
      }
    }, 2000)
  }

  const performUpdate = async () => {
    if (!status?.updateAvailable) return
    if (!confirm(t('updateConfirm'))) return

    setUpdating(true)
    try {
      const res = await fetch('/api/admin/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setStatus({ ...status, status: 'error', error: data.error || 'Update failed to start' })
        setUpdating(false)
        return
      }
      pollUntilDone()
    } catch (e) {
      setStatus({ ...status, status: 'error', error: e instanceof Error ? e.message : 'Unknown error' })
      setUpdating(false)
    }
  }

  useEffect(() => {
    void checkForUpdates()
    const onLicense = () => void checkForUpdates()
    window.addEventListener('license-updated', onLicense)
    return () => {
      stopPolling()
      window.removeEventListener('license-updated', onLicense)
    }
  }, [])

  // License state (licensed / inTrial) comes from /api/admin/update,
  // which in turn uses getLicenseStatus(). This only reads the stored
  // "license.acceptedKey". Per "verify once, trust forever", no re-verification
  // against the external service happens here or on the update page.

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
                <div className="text-zinc-400 text-xs">{tForm('currentVersion')}</div>
                <div className="font-mono text-sm">{status.currentVersion}</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  {status.licensed ? 'Licensed' : status.inTrial ? 'Trial' : 'Unlicensed (updates disabled)'}
                </div>
              </div>
              {status.updateAvailable && (
                <div className="text-right">
                  <div className="text-zinc-400 text-xs">{t('updateAvailable')}</div>
                  <div className="font-mono text-sm text-emerald-400">{status.latestVersion}</div>
                  {status.channel && (
                    <div className="text-[10px] text-zinc-500 mt-0.5">{status.channel}</div>
                  )}
                </div>
              )}
            </div>

            {status.targetDigest && (
              <div className="mb-4">
                <div className="text-zinc-400 text-xs">{tForm('targetDigest')}</div>
                <div className="font-mono text-[11px] text-zinc-300 break-all">{status.targetDigest}</div>
              </div>
            )}

            {status.changelogUrl && status.updateAvailable && (
              <div className="mb-4">
                <a
                  href={status.changelogUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-emerald-400 hover:underline"
                >
                  View changelog
                </a>
              </div>
            )}

            {status.updateAvailable && (
              <div className="flex items-center gap-2 mb-4">
                <input
                  type="checkbox"
                  id="backup"
                  checked
                  disabled
                  className="w-4 h-4"
                />
                <label htmlFor="backup" className="text-sm text-zinc-400">
                  Full backup is created automatically before update
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
                <div className="text-emerald-400 font-medium">{tForm('success')}</div>
                {status.backupPath && (
                  <div className="text-xs text-zinc-400 mt-1">Backup: {status.backupPath}</div>
                )}
              </div>
            )}

            {status.status === 'error' && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded">
                <div className="text-rose-400 font-medium">{tForm('failed')}</div>
                <div className="text-xs text-zinc-400 mt-1 whitespace-pre-wrap">{status.error}</div>
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

              {status.updateAvailable && status.status !== 'updating' && (
                <button
                  onClick={() => void performUpdate()}
                  disabled={updating}
                  className="px-4 py-2 rounded bg-emerald-500 text-black font-medium text-sm hover:bg-emerald-400 disabled:opacity-50"
                >
                  {updating ? 'Updating...' : t('updateNow')}
                </button>
              )}

              {(!status.licensed && !status.inTrial) && (
                <div className="text-xs text-amber-400 ml-2 self-center">
                  License required for updates
                </div>
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

          {!status.updateAvailable && !status.latestVersion && (
            <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-950">
              <div className="text-sm text-amber-400">
                Update source not configured
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                Set <code className="font-mono">UPDATE_MANIFEST_URL</code> to a signed release manifest to enable updates.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
