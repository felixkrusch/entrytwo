'use client'

import { useEffect, useState } from 'react'
import { signIn } from '@/lib/auth-client'

const CALLBACK_URL = '/app'

const hasGoogle = !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || !!process.env.GOOGLE_CLIENT_ID
const hasGitHub = !!process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || !!process.env.GITHUB_CLIENT_ID
const hasMicrosoft = !!(process.env.NEXT_PUBLIC_MICROSOFT_ENTRA_ID_ID || process.env.MICROSOFT_ENTRA_ID_ID)

interface InviteInfo {
  valid: boolean
  email?: string
  role?: string
  expiresAt?: string
  error?: string
}

export default function InvitePage() {
  const [token, setToken] = useState<string | null>(null)
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('token')
    setToken(t)

    if (!t) {
      setInfo({ valid: false, error: 'Missing invitation token' })
      setLoading(false)
      return
    }

    fetch(`/api/invitations/validate?token=${encodeURIComponent(t)}`)
      .then(r => r.json())
      .then((data: any) => {
        if (data.valid) {
          setInfo({ valid: true, email: data.email, role: data.role, expiresAt: data.expiresAt })
        } else {
          setInfo({ valid: false, error: data.error || 'Invalid or expired invitation' })
        }
      })
      .catch(() => setInfo({ valid: false, error: 'Failed to validate invitation' }))
      .finally(() => setLoading(false))
  }, [])

  const startOAuth = (provider: string) => {
    setError('')
    signIn(provider, { callbackUrl: CALLBACK_URL }).catch(() => {
      setError('Sign-in failed to start')
    })
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900 text-white">
        <div>Validating invitation…</div>
      </div>
    )
  }

  if (!info?.valid) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900 text-white">
        <div className="w-80 space-y-4 text-center">
          <img src="/entrytwo-logo.svg" alt="entrytwo" className="h-8 w-auto mx-auto" />
          <h1 className="text-xl font-semibold">Invitation not valid</h1>
          <p className="text-sm text-zinc-400">{info?.error || 'This invitation link is invalid or has expired.'}</p>
          <p className="text-xs text-zinc-500">Contact the person who invited you for a new link.</p>
          <a href="/auth/signin" className="inline-block mt-2 text-sm underline">Go to sign in</a>
        </div>
      </div>
    )
  }

  const providers = [
    hasGoogle && { id: 'google', label: 'Continue with Google' },
    hasGitHub && { id: 'github', label: 'Continue with GitHub' },
    hasMicrosoft && { id: 'microsoft-entra-id', label: 'Continue with Microsoft' },
  ].filter(Boolean) as { id: string; label: string }[]

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-900 text-white">
      <div className="w-96 space-y-6">
        <div className="text-center">
          <img src="/entrytwo-logo.svg" alt="entrytwo" className="h-8 w-auto mx-auto mb-3" />
          <h1 className="text-2xl font-semibold tracking-tight">You’re invited</h1>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-sm">
          <div className="text-zinc-400">Email</div>
          <div className="font-mono text-base mt-0.5 break-all">{info.email}</div>

          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-zinc-400">Role</div>
              <div className="mt-0.5 font-medium uppercase tracking-widest">{info.role}</div>
            </div>
            <div>
              <div className="text-zinc-400">Expires</div>
              <div className="mt-0.5">{info.expiresAt ? new Date(info.expiresAt).toLocaleString() : '—'}</div>
            </div>
          </div>
        </div>

        <p className="text-xs text-zinc-400 text-center">
          Sign in with an allowed OAuth provider using exactly the email address above.
        </p>

        {providers.length > 0 ? (
          <div className="space-y-2">
            {providers.map(p => (
              <button
                key={p.id}
                onClick={() => startOAuth(p.id)}
                className="w-full py-2.5 rounded bg-white text-black hover:bg-zinc-200 active:bg-zinc-300 font-medium text-sm"
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-xs text-amber-400 text-center border border-amber-900/60 bg-amber-950/30 p-3 rounded">
            No OAuth providers are configured for invitations on this installation.
          </div>
        )}

        {error && <div className="text-center text-rose-400 text-sm">{error}</div>}

        <div className="text-center text-[10px] text-zinc-500">
          After signing in you will be taken to the app.
        </div>
      </div>
    </div>
  )
}
