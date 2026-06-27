'use client'

import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'

export default function TOTPSetup() {
  const { data: session } = useSession()
  const t = useTranslations('app.auth.totp')

  if (!session?.user?.email) return null

  return (
    <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-950">
      <div className="font-medium mb-2">Two-Factor Authentication</div>
      <p className="text-xs text-zinc-400 mb-3">Add an extra layer of security to your account.</p>
      <button
        onClick={async () => {
          const res = await fetch('/api/auth/totp/setup')
          const data = await res.json()
          // Show QR code or secret
          alert(`Secret: ${data.secret}\nScan this in your authenticator app`)
        }}
        className="text-xs px-3 py-1 rounded bg-emerald-950 text-emerald-400 hover:bg-emerald-900"
      >
        {t('setup') || 'Enable TOTP'}
      </button>
    </div>
  )
}