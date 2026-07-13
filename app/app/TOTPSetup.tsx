'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import QRCode from 'qrcode'
import Image from 'next/image'

export default function TOTPSetup({ required = false }: { required?: boolean }) {
  const { data: session, update } = useSession()
  const t = useTranslations('app.auth.totp')
  const [secret, setSecret] = useState('')
  const [qrCode, setQrCode] = useState('')
  const [token, setToken] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [enabled, setEnabled] = useState(!!session?.user?.totpEnabled)

  if (!session?.user?.email) return null

  const beginSetup = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/auth/totp/setup')
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not start setup')
      setSecret(data.secret)
      setQrCode(await QRCode.toDataURL(data.totpUri, { width: 192, margin: 1 }))
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : 'Could not start setup')
    } finally {
      setLoading(false)
    }
  }

  const confirmSetup = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/auth/totp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Verification failed')
      setRecoveryCodes(data.recoveryCodes || [])
      setEnabled(true)
      setSecret('')
      setQrCode('')
      setToken('')
      await update()
    } catch (verificationError) {
      setError(verificationError instanceof Error ? verificationError.message : 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-2 font-medium">Two-Factor Authentication</div>
      {enabled && recoveryCodes.length === 0 && (
        <div className="space-y-3">
          <p className="text-xs text-emerald-400">TOTP is enabled for this account.</p>
          {required && <a href="/app" className="inline-block rounded bg-white px-3 py-1.5 text-xs font-medium text-black">Continue to entrytwo</a>}
        </div>
      )}

      {!enabled && !secret && (
        <>
          <p className="mb-3 text-xs text-zinc-400">Require a time-based code after every primary sign-in.</p>
          <button onClick={beginSetup} disabled={loading} className="rounded bg-emerald-950 px-3 py-1 text-xs text-emerald-400 hover:bg-emerald-900 disabled:opacity-50">
            {loading ? 'Preparing...' : (t('setup') || 'Enable TOTP')}
          </button>
        </>
      )}

      {!enabled && secret && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-400">Scan this code with your authenticator app, then enter the six-digit code to confirm setup.</p>
          {qrCode && <Image unoptimized src={qrCode} width={192} height={192} alt="TOTP setup QR code" className="rounded bg-white p-1" />}
          <div className="text-[10px] text-zinc-500">Manual key</div>
          <code className="block break-all rounded bg-zinc-900 p-2 text-xs text-zinc-300">{secret}</code>
          <div className="flex max-w-xs gap-2">
            <input value={token} onChange={event => setToken(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-mono text-sm tracking-widest" />
            <button onClick={confirmSetup} disabled={loading || token.length !== 6} className="rounded bg-white px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50">Confirm</button>
          </div>
        </div>
      )}

      {recoveryCodes.length > 0 && (
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium text-amber-300">Save your recovery codes</div>
            <p className="mt-1 text-xs text-zinc-400">Each code can be used once. They will not be shown again.</p>
          </div>
          <div className="grid max-w-md grid-cols-2 gap-1 rounded border border-zinc-800 bg-zinc-900 p-3 font-mono text-xs text-zinc-300">
            {recoveryCodes.map(code => <div key={code}>{code}</div>)}
          </div>
          <button onClick={() => setRecoveryCodes([])} className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800">I saved these codes</button>
          {required && <a href="/app" className="ml-2 inline-block rounded bg-white px-3 py-1 text-xs font-medium text-black">Continue to entrytwo</a>}
        </div>
      )}

      {error && <div className="mt-3 text-xs text-rose-400">{error}</div>}
    </div>
  )
}
