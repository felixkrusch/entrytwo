import { prisma } from '@/lib/prisma'
import { createAutonomousJournal } from '@/lib/accounting/autonomous'
import { advanceDate } from '@/lib/accounting/recurring'

type TemplateLine = {
  accountId: string
  debit?: number
  credit?: number
  description?: string | null
  taxRateId?: string | null
  taxIsInput?: boolean | null
  currency?: string
  fxRateToBase?: number | null
  fxSource?: string | null
  fxDate?: string | null
  contactId?: string | null
}

export async function generateRecurringJournalOccurrence(recurringId: string, dueAt: string) {
  const dueDate = new Date(dueAt)
  if (Number.isNaN(dueDate.getTime())) throw new Error('Invalid recurring occurrence date')
  const rec = await prisma.recurringJournalEntry.findUnique({ where: { id: recurringId } })
  if (!rec) throw new Error('Recurring journal schedule not found')
  if (rec.status !== 'ACTIVE') return
  if (rec.nextDueDate.getTime() !== dueDate.getTime()) return

  const template = rec.templateData as { currency?: string; description?: string; lines?: TemplateLine[] }
  const lines = Array.isArray(template.lines) ? template.lines : []
  const now = new Date()
  if (lines.length) {
    const currency = (template.currency || 'EUR').toUpperCase()
    await createAutonomousJournal({
      date: dueDate.toISOString(), description: template.description || rec.name, branch: 'main', createdBy: rec.createdBy,
      idempotencyKey: `recurring-journal:${rec.id}:${dueDate.toISOString()}`,
      lines: lines.map(line => ({
        accountId: line.accountId, debit: Number(line.debit) || 0, credit: Number(line.credit) || 0,
        description: line.description || undefined, currency: line.currency || currency,
        fxRateToBase: line.fxRateToBase != null ? Number(line.fxRateToBase) : null,
        fxSource: line.fxSource || null, fxDate: line.fxDate || null, taxRateId: line.taxRateId || null,
        taxIsInput: typeof line.taxIsInput === 'boolean' ? line.taxIsInput : null, contactId: line.contactId || null,
      })),
    })
  }
  const next = advanceDate(dueDate, rec.frequency, rec.interval)
  await prisma.recurringJournalEntry.updateMany({
    where: { id: rec.id, nextDueDate: dueDate, status: 'ACTIVE' },
    data: { nextDueDate: next, lastGeneratedAt: now, status: rec.endDate && next > rec.endDate ? 'CANCELLED' : 'ACTIVE' },
  })
}
