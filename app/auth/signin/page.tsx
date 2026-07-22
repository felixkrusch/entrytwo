'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { signIn } from '@/lib/auth-client'

const CALLBACK_URL = '/app'

// Detect available OAuth providers at build time
const hasGoogle = !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
const hasGitHub = !!process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID

export default function SignInPage() {
  const t = useTranslations('app.auth.signin')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [needsBootstrap, setNeedsBootstrap] = useState(false)
  const [error, setError] = useState('')
  const [bootstrapLanguage, setBootstrapLanguage] = useState<'en' | 'de'>('en')

  useEffect(() => {
    // If an invitation token is present, redirect to the dedicated invite page
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token') || params.get('invitation')
    if (token) {
      const inviteUrl = `/auth/invite?token=${encodeURIComponent(token)}`
      window.location.replace(inviteUrl)
      return
    }

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
      // Full onboarding: admin + company language + localized standard CoA
      const onboard = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          companyName: 'My Company',
          baseCurrency: 'EUR',
          defaultLanguage: bootstrapLanguage,
        }),
      })
      if (!onboard.ok) {
        const data = await onboard.json().catch(() => ({}))
        setError(data.error || 'Bootstrap failed')
        return
      }

      // Dev/session sign-in after first admin exists
      const res = await fetch('/api/auth/dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (res.ok || res.redirected) {
        const target = res.redirected && res.url ? res.url : CALLBACK_URL
        window.location.href = target
      } else {
        // Onboarding succeeded; user can sign in normally
        window.location.href = CALLBACK_URL
      }
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
        const result = await (await import('@/lib/auth-client')).signIn('email', { email, redirect: false, callbackUrl: CALLBACK_URL })
        if (result && typeof result === 'object' && 'ok' in result && result.ok) {
          setSent(true)
        } else {
          setError((result as { error?: string })?.error || 'Sign-in failed')
        }
      } else {
        // Dev mode: call dev sign-in endpoint that creates session directly
        const res = await fetch('/api/auth/dev', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        if (res.ok || res.redirected) {
          const target = res.redirected && res.url ? res.url : CALLBACK_URL
          window.location.href = target
        } else {
          setError('Sign-in failed')
        }
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
        <div className="w-80">
          <img src="/entrytwo-logo.svg" alt="entrytwo" className="h-8 w-auto mb-6" />
          <form onSubmit={handleBootstrap} className="space-y-4">
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
            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                {t('defaultLanguage') || 'Default language'}
              </label>
              <select
                value={bootstrapLanguage}
                onChange={e => setBootstrapLanguage(e.target.value as 'en' | 'de')}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm"
              >
                <option value="en">English (default)</option>
                <option value="de">Deutsch</option>
              </select>
              <p className="text-[10px] text-zinc-500 mt-1">
                {t('defaultLanguageHelp') ||
                  'Sets the app UI and standard chart of accounts for this installation.'}
              </p>
            </div>
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
      </div>
    )
  }

  if (sent) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900 text-white">
        <div className="w-80">
          <img src="/entrytwo-logo.svg" alt="entrytwo" className="h-8 w-auto mb-6" />
          <h1 className="text-xl mb-2">{t('checkEmail')}</h1>
          <p className="text-zinc-400">{t('magicSent', { email })}</p>
        </div>
      </div>
    )
  }

return (
    <div className="flex h-screen items-center justify-center bg-zinc-900 text-white">
      <div className="w-80">
        <img src="/entrytwo-logo.svg" alt="entrytwo" className="h-8 w-auto mb-6" />
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">{t('description')}</p>

          {hasGoogle && (
            <button
              type="button"
              onClick={() => signIn('google', { callbackUrl: CALLBACK_URL })}
              className="w-full py-2 rounded bg-red-600 text-white hover:bg-red-700"
            >
              {t('google')}
            </button>
          )}

          {hasGitHub && (
            <button
              type="button"
              onClick={() => signIn('github', { callbackUrl: CALLBACK_URL })}
              className="w-full py-2 rounded bg-gray-800 text-white hover:bg-gray-900"
            >
              {t('github')}
            </button>
          )}

          {(hasGoogle || hasGitHub) && (
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-700"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-zinc-900 px-2 text-zinc-500">{t('orContinue') || 'or continue with email'}</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
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
      </div>
    </div>
  )
}