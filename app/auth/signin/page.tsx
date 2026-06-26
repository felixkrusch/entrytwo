'use client'

import { signIn } from '@/lib/auth-client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

const CALLBACK_URL = '/'

export default function SignInPage() {
  const t = useTranslations('auth.signin')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      // In dev mode (no SMTP), use credentials provider; in prod use email
      const provider = process.env.NEXT_PUBLIC_HAS_SMTP ? 'email' : 'dev-credentials'
      await signIn(provider, { email: email, redirect: false, callbackUrl: CALLBACK_URL })
      if (provider === 'email') {
        setSent(true)
      }
    } catch (err) {
      setError((err as Error)?.message || 'Sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900 text-white">
        <div className="text-center">
          <h1 className="text-xl mb-2">{t('checkEmail')}</h1>
          <p className="text-zinc-400">{t('magicSent', { email })}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-900 text-white">
      <form onSubmit={handleSubmit} className="space-y-4 w-80">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-zinc-400">{t('description')}</p>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder={t('emailPlaceholder')}
          required
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2"
        />
        {error && <div className="text-rose-400 text-sm">{error}</div>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 rounded bg-white text-black disabled:opacity-50"
        >
          {loading ? t('sending') : t('send')}
        </button>
        <p className="text-xs text-zinc-500">
          {process.env.NEXT_PUBLIC_HAS_SMTP 
            ? 'Check your email for a magic link' 
            : 'Development mode: enter any email to sign in'}
        </p>
      </form>
    </div>
  )
}
