'use client'

import { useTranslations } from 'next-intl'

export default function VerifyRequestPage() {
  const t = useTranslations('auth.signin')

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-900 text-white">
      <div className="text-center">
        <h1 className="text-xl mb-2">{t('checkEmail')}</h1>
        <p className="text-zinc-400">Follow the link in your email to sign in.</p>
      </div>
    </div>
  )
}