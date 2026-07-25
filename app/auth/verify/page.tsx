'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'

export default function VerifyRequestPage() {
  const t = useTranslations('app.auth.signin')

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-900 text-white">
      <div className="w-80 text-center space-y-4">
        <img src="/entrytwo-logo.svg" alt="entrytwo" className="h-8 w-auto mx-auto mb-2" />
        <h1 className="text-xl mb-2">{t('checkEmail')}</h1>
        <p className="text-zinc-400">{t('verifyBody')}</p>
        <p className="text-xs text-zinc-500">{t('magicHint')}</p>
        <Link href="/auth/signin" className="inline-block text-sm text-amber-400 underline">
          {t('backToSignIn')}
        </Link>
      </div>
    </div>
  )
}
