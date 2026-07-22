'use client'

import { useTranslations } from 'next-intl'

import AccountsPanel from '../../app/AccountsPanel'

export default function ChartOfAccountsAdminPage() {
  const tForm = useTranslations('app.chartForm')
  const t = useTranslations('app.adminPages')

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">{t('chartTitle')}</h1>
        <p className="text-sm text-zinc-400 mb-6">{tForm('subtitle')}</p>
        <AccountsPanel />
      </div>
    </div>
  )
}
