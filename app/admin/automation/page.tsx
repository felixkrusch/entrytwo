'use client'

import { useTranslations } from 'next-intl'

import TemplatesPanel from '@/app/app/TemplatesPanel'

export default function AutomationPage() {
  const t = useTranslations('app.adminPages')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t('automationTitle')}</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Transaction templates and recurring schedules. Use &ldquo;Repeat on a schedule&rdquo; when creating a journal entry to build a recurring plan.
        </p>
      </div>

      <TemplatesPanel />
    </div>
  )
}
