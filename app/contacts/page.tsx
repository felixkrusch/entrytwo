'use client'

import { useTranslations } from 'next-intl'

export default function ContactsPage() {
  const t = useTranslations('app.panels')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t('contacts?.title') || 'Contacts'}</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Manage customers and vendors.
        </p>
      </div>

      <div className="text-zinc-500">
        Contacts module coming soon. The data model exists (Contact with name, email, type).
      </div>
    </div>
  )
}