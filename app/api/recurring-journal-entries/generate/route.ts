import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createAutonomousJournal } from '@/lib/accounting/autonomous'
import { advanceDate } from '@/lib/accounting/recurring'

interface RecurringTemplateLine {
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

interface RecurringTemplateData {
  currency?: string
  description?: string
  lines?: RecurringTemplateLine[]
}

// Generate all due recurring journal entries. Safe to call from a cron job or manually.
// For each ACTIVE schedule whose nextDueDate <= now (and before endDate), create the
// journal entry, then advance nextDueDate. If autoPost is false, the generated entry is
// still a normal posted entry (there is no DRAFT state for journal entries) — the user
// reviews via the journal list. `autoPost` controls whether generation is attempted at all.
export async function POST() {
  try {
    const now = new Date()
    const due = await prisma.recurringJournalEntry.findMany({
      where: {
        status: 'ACTIVE',
        nextDueDate: { lte: now },
      },
    })

    const created: string[] = []
    for (const rec of due) {
      const tpl = (rec.templateData as RecurringTemplateData) || {}
      const lines = Array.isArray(tpl.lines) ? tpl.lines : []
      if (!lines.length) {
        // Nothing to book; advance to avoid an infinite due state.
        await prisma.recurringJournalEntry.update({
          where: { id: rec.id },
          data: { nextDueDate: advanceDate(rec.nextDueDate, rec.frequency, rec.interval), lastGeneratedAt: now },
        })
        continue
      }

      const currency = (tpl.currency || 'EUR').toUpperCase()
      const description = tpl.description || rec.name

      const entry = await createAutonomousJournal({
        date: rec.nextDueDate.toISOString(),
        description,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description || undefined,
          currency: l.currency || currency,
          fxRateToBase: l.fxRateToBase != null ? Number(l.fxRateToBase) : null,
          fxSource: l.fxSource || null,
          fxDate: l.fxDate || null,
          taxRateId: l.taxRateId || null,
          taxIsInput: typeof l.taxIsInput === 'boolean' ? l.taxIsInput : null,
          contactId: l.contactId || null,
        })),
        branch: 'main',
        createdBy: rec.createdBy,
        sourcePdfPath: null,
      })
      created.push(entry.id)

      // Advance schedule
      const next = advanceDate(rec.nextDueDate, rec.frequency, rec.interval)
      const ended = rec.endDate ? next > rec.endDate : false
      await prisma.recurringJournalEntry.update({
        where: { id: rec.id },
        data: {
          nextDueDate: next,
          lastGeneratedAt: now,
          status: ended ? 'CANCELLED' : rec.status,
        },
      })
    }

    return NextResponse.json({ generated: created.length, ids: created })
  } catch (e) {
    console.error('Error generating recurring journal entries', e)
    return NextResponse.json({ error: 'Failed to generate' }, { status: 500 })
  }
}
