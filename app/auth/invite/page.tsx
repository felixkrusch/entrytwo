'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { signIn } from '@/lib/auth-client'

const CALLBACK_URL = '/app'

type AuthMethods = {
  magicLink: boolean
  google: boolean
  microsoft: boolean
  instantEmail: boolean
}

interface InviteInfo {
  valid: boolean
  email?: string
  role?: string
  expiresAt?: string
  error?: string
}

export default function InvitePage() {
  const t = useTranslations('app.auth.invite')
  const tSignin = useTranslations('app.auth.signin')
  const [token, setToken] = useState<string | null>(null)
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [methods, setMethods] = useState<AuthMethods | null>(null)
  const [sendingLink, setSendingLink] = useState(false)
  const [linkSent, setLinkSent] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tkn = params.get('token')
    setToken(tkn)

    fetch('/api/auth/methods')
      .then(r => r.json())
      .then((d: AuthMethods) => setMethods(d))
      .catch(() => setMethods({ magicLink: false, google: false, microsoft: false, instantEmail: true }))

    if (!tkn) {
      setInfo({ valid: false, error: t('missingToken') })
      setLoading(false)
      return
    }

    fetch(`/api/invitations/validate?token=${encodeURIComponent(tkn)}`)
      .then(r => r.json())
      .then((data: InviteInfo & { valid?: boolean }) => {
        if (data.valid) {
          setInfo({ valid: true, email: data.email, role: data.role, expiresAt: data.expiresAt })
        } else {
          setInfo({ valid: false, error: data.error || t('invalid') })
        }
      })
      .catch(() => setInfo({ valid: false, error: t('validateFailed') }))
      .finally(() => setLoading(false))
  }, [t])

  const startOAuth = (provider: string) => {
    setError('')
    signIn(provider, { callbackUrl: CALLBACK_URL }).catch(() => {
      setError(t('signInFailed'))
    })
  }

  const acceptWithEmail = async () => {
    if (!info?.email) return
    setSendingLink(true)
    setError('')
    try {
      if (methods?.magicLink) {
        const result = await signIn('email', {
          email: info.email,
          redirect: false,
          callbackUrl: CALLBACK_URL,
        })
        if (result && typeof result === 'object' && 'ok' in result && (result as { ok?: boolean }).ok) {
          setLinkSent(true)
          return
        }
        setError(t('signInFailed'))
        return
      }

      if (methods?.instantEmail) {
        const res = await fetch('/api/auth/dev', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: info.email }),
        })
        if (res.ok || res.redirected) {
          window.location.href = res.redirected && res.url ? res.url : CALLBACK_URL
          return
        }
        const data = await res.json().catch(() => ({}))
        setError(data.error || t('signInFailed'))
        return
      }

      setError(t('noProviders'))
    } catch {
      setError(t('signInFailed'))
    } finally {
      setSendingLink(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900 text-white">
        <div>{t('validating')}</div>
      </div>
    )
  }

  if (!info?.valid) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900 text-white">
        <div className="w-80 space-y-4 text-center">
          <img src="/entrytwo-logo.svg" alt="entrytwo" className="h-8 w-auto mx-auto" />
          <h1 className="text-xl font-semibold">{t('notValidTitle')}</h1>
          <p className="text-sm text-zinc-400">{info?.error || t('invalid')}</p>
          <p className="text-xs text-zinc-500">{t('contactInviter')}</p>
          <a href="/auth/signin" className="inline-block mt-2 text-sm underline">
            {t('goSignIn')}
          </a>
        </div>
      </div>
    )
  }

  if (linkSent) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900 text-white">
        <div className="w-80 space-y-4 text-center">
          <img src="/entrytwo-logo.svg" alt="entrytwo" className="h-8 w-auto mx-auto" />
          <h1 className="text-xl font-semibold">{tSignin('checkEmail')}</h1>
          <p className="text-sm text-zinc-400">{tSignin('magicSent', { email: info.email || '' })}</p>
          <p className="text-xs text-zinc-500">{tSignin('magicHint')}</p>
        </div>
      </div>
    )
  }

  const providers = [
    methods?.google && { id: 'google', label: tSignin('google') },
    methods?.microsoft && { id: 'microsoft-entra-id', label: tSignin('microsoft') },
  ].filter(Boolean) as { id: string; label: string }[]

  const hasEmail = !!(methods?.magicLink || methods?.instantEmail)

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-900 text-white">
      <div className="w-96 space-y-6">
        <div className="text-center">
          <img src="/entrytwo-logo.svg" alt="entrytwo" className="h-8 w-auto mx-auto mb-3" />
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-sm">
          <div className="text-zinc-400">{t('email')}</div>
          <div className="font-mono text-base mt-0.5 break-all">{info.email}</div>

          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-zinc-400">{t('role')}</div>
              <div className="mt-0.5 font-medium uppercase tracking-widest">{info.role}</div>
            </div>
            <div>
              <div className="text-zinc-400">{t('expires')}</div>
              <div className="mt-0.5">
                {info.expiresAt ? new Date(info.expiresAt).toLocaleString() : '—'}
              </div>
            </div>
          </div>
        </div>

        <p className="text-xs text-zinc-400 text-center">{t('mustMatchEmail')}</p>

        {providers.length > 0 && (
          <div className="space-y-2">
            {providers.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => startOAuth(p.id)}
                className="w-full py-2.5 rounded bg-white text-black hover:bg-zinc-200 active:bg-zinc-300 font-medium text-sm"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {hasEmail && (
          <button
            type="button"
            disabled={sendingLink}
            onClick={() => void acceptWithEmail()}
            className="w-full py-2.5 rounded bg-amber-500 text-black hover:bg-amber-400 font-medium text-sm disabled:opacity-50"
          >
            {sendingLink
              ? tSignin('sending')
              : methods?.magicLink
                ? t('continueMagic')
                : t('continueDev')}
          </button>
        )}

        {!providers.length && !hasEmail && (
          <div className="text-xs text-amber-400 text-center border border-amber-900/60 bg-amber-950/30 p-3 rounded">
            {t('noProviders')}
          </div>
        )}

        {error && <div className="text-center text-rose-400 text-sm">{error}</div>}

        <div className="text-center text-[10px] text-zinc-500">{t('afterSignIn')}</div>
      </div>
    </div>
  )
}
