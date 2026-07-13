'use client'

import { useState } from 'react'
import Image from 'next/image'

export default function TotpChallengePage() {
  const [value, setValue] = useState('')
  const [useRecoveryCode, setUseRecoveryCode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const verify = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/auth/totp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(useRecoveryCode ? { recoveryCode: value } : { token: value }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Verification failed')
      const callbackUrl = new URLSearchParams(window.location.search).get('callbackUrl')
      window.location.href = callbackUrl?.startsWith('/') && !callbackUrl.startsWith('//') ? callbackUrl : '/app'
    } catch (verificationError) {
      setError(verificationError instanceof Error ? verificationError.message : 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-900 p-4 text-white">
      <form onSubmit={verify} className="w-full max-w-xs space-y-4 rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <Image src="/entrytwo-logo.svg" alt="entrytwo" width={128} height={32} className="mx-auto h-8 w-auto" />
        <div>
          <h1 className="text-lg font-semibold">Two-factor verification</h1>
          <p className="mt-1 text-xs text-zinc-400">{useRecoveryCode ? 'Enter one of your one-time recovery codes.' : 'Enter the six-digit code from your authenticator app.'}</p>
        </div>
        <input
          autoFocus
          value={value}
          onChange={event => setValue(useRecoveryCode ? event.target.value.toUpperCase().slice(0, 19) : event.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode={useRecoveryCode ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          placeholder={useRecoveryCode ? 'XXXX-XXXX-XXXX-XXXX' : '000000'}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-center font-mono text-sm tracking-widest focus:border-zinc-500 focus:outline-none"
        />
        {error && <div className="text-xs text-rose-400">{error}</div>}
        <button type="submit" disabled={loading || !value.trim()} className="w-full rounded bg-white px-3 py-2 text-sm font-medium text-black disabled:opacity-50">{loading ? 'Verifying...' : 'Verify'}</button>
        <button type="button" onClick={() => { setUseRecoveryCode(current => !current); setValue(''); setError('') }} className="w-full text-xs text-zinc-500 hover:text-zinc-300">
          {useRecoveryCode ? 'Use authenticator code' : 'Use a recovery code'}
        </button>
      </form>
    </div>
  )
}
