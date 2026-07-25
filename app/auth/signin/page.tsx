'use client'

import { useState, useEffect, FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { signIn } from '@/lib/auth-client'

const CALLBACK_URL = '/app'

type AuthMethods = {
  magicLink: boolean
  google: boolean
  microsoft: boolean
  oauth: string[]
  devCredentials: boolean
  instantEmail: boolean
}

const AUTH_ERROR_KEYS: Record<string, string> = {
  AccessDenied: 'errorAccessDenied',
  Configuration: 'errorConfiguration',
  Verification: 'errorVerification',
  OAuthAccountNotLinked: 'errorOAuthAccountNotLinked',
  Default: 'errorDefault',
}

export default function SignInPage() {
  const t = useTranslations('app.auth.signin')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [needsBootstrap, setNeedsBootstrap] = useState(false)
  const [error, setError] = useState('')
  const [bootstrapLanguage, setBootstrapLanguage] = useState<'en' | 'de'>('en')
  const [methods, setMethods] = useState<AuthMethods | null>(null)
  const [useMagicLink, setUseMagicLink] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token') || params.get('invitation')
    if (token) {
      window.location.replace(`/auth/invite?token=${encodeURIComponent(token)}`)
      return
    }

    const err = params.get('error')
    if (err) {
      const key = AUTH_ERROR_KEYS[err] || AUTH_ERROR_KEYS.Default
      try {
        setError(t(key as 'errorDefault'))
      } catch {
        setError(t('errorDefault'))
      }
    }

    fetch('/api/bootstrap/status')
      .then(r => r.json())
      .then(d => setNeedsBootstrap(!!d.needsBootstrap))
      .catch(() => setNeedsBootstrap(false))

    fetch('/api/auth/methods')
      .then(r => r.json())
      .then((d: AuthMethods) => {
        setMethods(d)
        // Prefer real magic link when SMTP is up; still allow instant in dev
        setUseMagicLink(!!d.magicLink && !d.instantEmail)
      })
      .catch(() => {
        setMethods({
          magicLink: false,
          google: false,
          microsoft: false,
          oauth: [],
          devCredentials: true,
          instantEmail: true,
        })
      })
  }, [t])

  const handleBootstrap = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
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
        setError(data.error || t('errorDefault'))
        return
      }

      const res = await fetch('/api/auth/dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (res.ok || res.redirected) {
        window.location.href = res.redirected && res.url ? res.url : CALLBACK_URL
      } else {
        window.location.href = CALLBACK_URL
      }
    } catch (err) {
      setError((err as Error)?.message || t('errorDefault'))
    } finally {
      setLoading(false)
    }
  }

  const sendMagicLink = async () => {
    const result = await signIn('email', { email, redirect: false, callbackUrl: CALLBACK_URL })
    if (result && typeof result === 'object' && 'ok' in result && (result as { ok?: boolean }).ok) {
      setSent(true)
      return
    }
    const errMsg =
      result && typeof result === 'object' && 'error' in result
        ? String((result as { error?: string }).error || '')
        : ''
    setError(errMsg || t('errorDefault'))
  }

  const sendDevSession = async () => {
    const res = await fetch('/api/auth/dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (res.ok || res.redirected) {
      window.location.href = res.redirected && res.url ? res.url : CALLBACK_URL
      return
    }
    const data = await res.json().catch(() => ({}))
    setError(data.error || t('errorDefault'))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const wantMagic = useMagicLink && methods?.magicLink
      if (wantMagic) {
        await sendMagicLink()
      } else if (methods?.instantEmail) {
        await sendDevSession()
      } else if (methods?.magicLink) {
        await sendMagicLink()
      } else {
        setError(t('errorNoEmailMethod'))
      }
    } catch (err) {
      setError((err as Error)?.message || t('errorDefault'))
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
            <h1 className="text-xl font-semibold">{t('firstAdminTitle')}</h1>
            <p className="text-sm text-zinc-400">{t('firstAdminDesc')}</p>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              required
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2"
            />
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{t('defaultLanguage')}</label>
              <select
                value={bootstrapLanguage}
                onChange={e => setBootstrapLanguage(e.target.value as 'en' | 'de')}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm"
              >
                <option value="en">English</option>
                <option value="de">Deutsch</option>
              </select>
              <p className="text-[10px] text-zinc-500 mt-1">{t('defaultLanguageHelp')}</p>
            </div>
            {error && <div className="text-rose-400 text-sm">{error}</div>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 rounded bg-amber-500 text-black disabled:opacity-50"
            >
              {loading ? t('sending') : t('createFirstAdmin')}
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (sent) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900 text-white">
        <div className="w-80 space-y-4">
          <img src="/entrytwo-logo.svg" alt="entrytwo" className="h-8 w-auto mb-2" />
          <h1 className="text-xl mb-2">{t('checkEmail')}</h1>
          <p className="text-zinc-400">{t('magicSent', { email })}</p>
          <p className="text-xs text-zinc-500">{t('magicHint')}</p>
          <button
            type="button"
            className="text-sm text-amber-400 underline"
            onClick={() => {
              setSent(false)
              setError('')
            }}
          >
            {t('useDifferentEmail')}
          </button>
        </div>
      </div>
    )
  }

  const hasOAuth = !!(methods?.google || methods?.microsoft)
  const showEmailToggle = !!(methods?.magicLink && methods?.instantEmail)

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-900 text-white">
      <div className="w-80">
        <img src="/entrytwo-logo.svg" alt="entrytwo" className="h-8 w-auto mb-6" />
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">{t('description')}</p>

          {methods?.google && (
            <button
              type="button"
              onClick={() => signIn('google', { callbackUrl: CALLBACK_URL })}
              className="w-full py-2 rounded bg-white text-black hover:bg-zinc-200 font-medium text-sm"
            >
              {t('google')}
            </button>
          )}

          {methods?.microsoft && (
            <button
              type="button"
              onClick={() => signIn('microsoft-entra-id', { callbackUrl: CALLBACK_URL })}
              className="w-full py-2 rounded bg-[#2f2f2f] text-white border border-zinc-600 hover:bg-zinc-800 font-medium text-sm"
            >
              {t('microsoft')}
            </button>
          )}

          {hasOAuth && (
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-700" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-zinc-900 px-2 text-zinc-500">{t('orContinue')}</span>
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
              autoComplete="email"
            />

            {showEmailToggle && (
              <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useMagicLink}
                  onChange={e => setUseMagicLink(e.target.checked)}
                  className="rounded border-zinc-600"
                />
                {t('preferMagicLink')}
              </label>
            )}

            {error && <div className="text-rose-400 text-sm">{error}</div>}

            <button
              type="submit"
              disabled={loading || !methods}
              className="w-full py-2 rounded bg-amber-500 text-black disabled:opacity-50 font-medium"
            >
              {loading
                ? t('sending')
                : useMagicLink && methods?.magicLink
                  ? t('send')
                  : methods?.instantEmail
                    ? t('continueDev')
                    : t('send')}
            </button>

            <p className="text-xs text-zinc-500">
              {useMagicLink && methods?.magicLink
                ? t('magicHelp')
                : methods?.instantEmail
                  ? t('devHelp')
                  : methods?.magicLink
                    ? t('magicHelp')
                    : t('errorNoEmailMethod')}
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
