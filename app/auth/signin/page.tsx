'use client'

import { signIn } from '@/lib/auth-client'
import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

const CALLBACK_URL = '/'

export default function SignInPage() {
  const t = useTranslations('app.auth.signin')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [needsBootstrap, setNeedsBootstrap] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/bootstrap/status')
      .then(r => r.json())
      .then(d => setNeedsBootstrap(d.needsBootstrap))
      .catch(() => setNeedsBootstrap(false))
  }, [])

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'ADMIN' }),
      })
      // Now sign in with redirect
      await signIn('credentials', { email, redirect: true, callbackUrl: CALLBACK_URL })
    } catch (err) {
      setError((err as Error)?.message || 'Failed')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const isProd = !!process.env.NEXT_PUBLIC_HAS_SMTP

      if (isProd) {
        const result = await signIn('email', { email, redirect: false, callbackUrl: CALLBACK_URL })
        if (result && typeof result === 'object' && 'ok' in result && result.ok) {
          setSent(true)
        } else {
          setError((result as { error?: string })?.error || 'Sign-in failed')
        }
      } else {
        // Dev mode: sign in via credentials
        await signIn('credentials', { email, redirect: true, callbackUrl: CALLBACK_URL })
      }
    } catch (err) {
      setError((err as Error)?.message || 'Sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  if (needsBootstrap) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900 text-white">
        <form onSubmit={handleBootstrap} className="space-y-4 w-80">
          <h1 className="text-xl font-semibold">{t('firstAdminTitle') || 'Create First Admin'}</h1>
          <p className="text-sm text-zinc-400">{t('firstAdminDesc') || 'No admin exists. Create the initial admin user.'}</p>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder={t('emailPlaceholder') || 'admin@company.com'}
            required
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2"
          />
          {error && <div className="text-rose-400 text-sm">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded bg-amber-500 text-black disabled:opacity-50"
          >
            {loading ? t('sending') : (t('createFirstAdmin') || 'Create Admin')}
          </button>
        </form>
      </div>
    )
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
