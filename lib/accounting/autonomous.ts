// lib/accounting/autonomous.ts
// Git Model: helper to create journal entries autonomously at high confidence
// Uses ancestry: parent to current head of target branch, advance head.

import { isAuthoritativeBankFeed, normalizeToProvisional } from '@/lib/fxSources'
import { commitJournalAtomic } from './atomicCommit'
import { getCompanyProfile } from '@/lib/companyProfile'

export interface AutonomousJournalInput {
  date: string
  description: string
  lines: Array<{
    accountId: string
    debit: number
    credit: number
    description?: string
    currency?: string
    fxRateToBase?: number | null
    fxSource?: string | null
    fxDate?: string | null
    taxRateId?: string | null
    taxIsInput?: boolean | null
    contactId?: string | null
  }>
  aiMetadata?: {
    confidence?: number
    model?: string
    reasoning?: string
  }
  branch?: string
  attachments?: Array<{ id: string }>
  createdBy?: string | null       // attributing user (null for system/AI)
  idempotencyKey?: string
}

export async function createAutonomousJournal(input: AutonomousJournalInput) {
  const baseCurrency = (await getCompanyProfile()).baseCurrency.toUpperCase()
  const attachments = input.attachments || []
  return commitJournalAtomic({
    date: input.date,
    description: input.description,
    branch: input.branch,
    baseCurrency,
    createdBy: input.createdBy,
    eventType: 'AI_AUTONOMOUS_ENTRY',
    idempotencyKey: input.idempotencyKey,
    attachments: attachments.map(attachment => ({ id: attachment.id, source: 'chat' })),
    eventPayload: { ai: input.aiMetadata || {} },
    lines: input.lines.map(line => {
      const currency = (line.currency || baseCurrency).toUpperCase()
      let fxSource = line.fxSource || null
      if (currency !== baseCurrency && !isAuthoritativeBankFeed(fxSource)) fxSource = normalizeToProvisional(fxSource)
      else if (!fxSource && line.fxRateToBase != null) fxSource = 'AI_AUTONOMOUS'
      return { ...line, currency, fxSource }
    }),
  })
}
