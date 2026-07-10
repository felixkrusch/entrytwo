import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { recordCommitOnBranch } from '@/lib/accounting/commit'
import { isAuthoritativeBankFeed } from '@/lib/fxSources'

const feedImportSchema = z.object({
  date: z.string(),
  description: z.string().optional(),
  settlementAccountCode: z.string(),   // e.g. "1100" Bank/Card - the account that actually moved in base
  counterAccountCode: z.string(),      // e.g. "5100", "5200", "2000" - where the foreign side is booked
  baseAmount: z.number(),
  baseCurrency: z.string().default('EUR'),
  foreignAmount: z.number(),
  foreignCurrency: z.string(),
  fxSource: z.string().optional(),     // prefer "BANK_FEED:<provider>:<ref>"
  fxDate: z.string().optional(),       // YYYY-MM-DD
  merchant: z.string().optional(),
  reference: z.string().optional(),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = feedImportSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid feed import data', details: parsed.error.format() }, { status: 400 })
    }

    const {
      date,
      description,
      settlementAccountCode,
      counterAccountCode,
      baseAmount,
      baseCurrency,
      foreignAmount,
      foreignCurrency,
      fxSource,
      fxDate,
      merchant,
      reference,
    } = parsed.data

    const settlementAccount = await prisma.account.findUnique({ where: { code: settlementAccountCode } })
    const counterAccount = await prisma.account.findUnique({ where: { code: counterAccountCode } })

    if (!settlementAccount || !counterAccount) {
      return NextResponse.json({ error: 'One or both accounts not found' }, { status: 400 })
    }

    const fxRateToBase = baseAmount > 0 ? baseAmount / foreignAmount : null
    const effectiveFxSource = fxSource || `BANK_FEED:import:${reference || 'manual'}`
    const effectiveFxDate = fxDate || date

    const branchForCommit = (body.branch || 'main') as string
    const br = await prisma.accountingBranch.findUnique({ where: { name: branchForCommit } })
    const parentHead = br?.headEventId || null

    const result = await prisma.$transaction(async (tx) => {
      // Business date (midnight UTC of the feed transaction day)
      const businessDate = new Date(date)
      businessDate.setUTCHours(0, 0, 0, 0)

      const created = await tx.journalEntry.create({
        data: {
          date: businessDate,
          description: description || `Feed import: ${merchant || foreignCurrency} ${foreignAmount}`,
          lines: {
            create: [
              {
                accountId: settlementAccount.id,
                credit: baseAmount,
                debit: 0,
                description: `Settlement via feed${reference ? ` (${reference})` : ''}`,
                currency: baseCurrency,
              },
              {
                accountId: counterAccount.id,
                debit: foreignAmount,
                credit: 0,
                description: merchant ? `Feed: ${merchant}` : 'Feed transaction',
                currency: foreignCurrency,
                fxRateToBase: fxRateToBase,
                fxSource: effectiveFxSource,
                fxDate: new Date(effectiveFxDate),
              },
            ],
          },
        },
        include: {
          lines: {
            include: {
              account: { select: { code: true, name: true } },
            },
          },
        },
      })

      const ev = await tx.event.create({
        data: {
          eventType: 'MANUAL_ADJUSTMENT',
          entityType: 'JournalEntry',
          entityId: created.id,
          parentEventId: parentHead,
          payload: {
            source: 'feed_import',
            description: created.description,
            lines: created.lines.map(l => ({
              account: l.account.code,
              debit: Number(l.debit),
              credit: Number(l.credit),
              currency: l.currency,
              fxRateToBase: l.fxRateToBase ? Number(l.fxRateToBase) : null,
              fxSource: l.fxSource,
            })),
          },
        },
      })

      await tx.journalEntry.update({
        where: { id: created.id },
        data: { introducedByEventId: ev.id }
      })

      // FX provisional policy: after authoritative feed import, look for prior provisional foreign lines
      // for the same merchant and create a small adjustment entry (delta + fees).
      // This keeps the original Day-0 entry untouched.
      if (merchant) {
        const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 120)
        const prior = await tx.journalLine.findMany({
          where: {
            currency: foreignCurrency,
            journalEntry: {
              date: { gte: since, lt: businessDate },
            },
          },
          include: { journalEntry: true },
          orderBy: { journalEntry: { date: 'desc' } },
          take: 30,
        })

        const m = merchant.toLowerCase()
        const match = prior.find(p =>
          !isAuthoritativeBankFeed(p.fxSource) &&
          ((p.journalEntry.description || '').toLowerCase().includes(m) || (p.description || '').toLowerCase().includes(m)) &&
          Math.abs((Number(p.debit) || Number(p.credit)) - foreignAmount) < Math.max(1, foreignAmount * 0.2)
        )

        if (match && fxRateToBase != null) {
          const prevRate = match.fxRateToBase != null ? Number(match.fxRateToBase) : null
          const prevBase = prevRate != null ? (Number(match.debit) || Number(match.credit)) * prevRate : null
          const delta = prevBase != null ? baseAmount - prevBase : 0

          if (Math.abs(delta) > 0.005 || (body as any).forceAdjustment) {
            const adjDesc = `FX + fee adjustment for ${match.journalEntry.entryNumber || match.journalEntry.id} - ${merchant}`
            const adj = await tx.journalEntry.create({
              data: {
                date: businessDate,
                description: adjDesc,
                lines: {
                  create: [
                    {
                      accountId: counterAccount.id,
                      debit: delta > 0 ? Math.abs(delta) : 0,
                      credit: delta < 0 ? Math.abs(delta) : 0,
                      description: `FX diff vs provisional for ${merchant}`,
                      currency: baseCurrency,
                    },
                    {
                      accountId: settlementAccount.id,
                      debit: delta < 0 ? Math.abs(delta) : 0,
                      credit: delta > 0 ? Math.abs(delta) : 0,
                      description: `FX adjustment settlement`,
                      currency: baseCurrency,
                    },
                  ],
                },
              },
            })

            const adjEv = await tx.event.create({
              data: {
                eventType: 'MANUAL_ADJUSTMENT',
                entityType: 'JournalEntry',
                entityId: adj.id,
                parentEventId: parentHead,
                payload: { source: 'fx_adjustment_from_feed', originalProvisionalId: match.journalEntryId, merchant },
              },
            })
            await tx.journalEntry.update({ where: { id: adj.id }, data: { introducedByEventId: adjEv.id } })
          }
        }
      }

      return { created, commitEventId: ev.id, branchForCommit }
    })

    const r = result as { created: { id: string }; commitEventId: string; branchForCommit?: string }
    const commitEventId = r.commitEventId
    const b = r.branchForCommit || branchForCommit

    if (commitEventId) {
      await recordCommitOnBranch(r.created.id, b, commitEventId)
    } else {
      await recordCommitOnBranch(r.created.id, b)
    }

    return NextResponse.json(r.created, { status: 201 })
  } catch (error) {
    console.error('Feed import error:', error)
    return NextResponse.json({ error: 'Failed to import feed' }, { status: 500 })
  }
}
