import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

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

    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.journalEntry.create({
        data: {
          date: new Date(date),
          description: description || `Feed import: ${merchant || foreignCurrency} ${foreignAmount}`,
          lines: {
            create: [
              {
                // The actual movement on the bank/card account (authoritative base amount)
                accountId: settlementAccount.id,
                credit: baseAmount,           // typical for a card charge / outgoing
                debit: 0,
                description: `Settlement via feed${reference ? ` (${reference})` : ''}`,
                currency: baseCurrency,
              },
              {
                // The original foreign amount with authoritative rate from the feed
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

      await tx.event.create({
        data: {
          eventType: 'MANUAL_ADJUSTMENT',
          entityType: 'JournalEntry',
          entityId: created.id,
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

      return created
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    console.error('Feed import error:', error)
    return NextResponse.json({ error: 'Failed to import feed' }, { status: 500 })
  }
}
