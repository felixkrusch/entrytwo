import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { isAuthoritativeBankFeed } from '@/lib/fxSources'
import { requireUser } from '@/lib/authz'
import { commitJournalAtomic } from '@/lib/accounting/atomicCommit'

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
  const session = await requireUser(['ADMIN', 'ACCOUNTANT'])
  if (!session) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
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

    const branchForCommit = typeof body.branch === 'string' ? body.branch : 'main'
    const businessDate = new Date(date)
    businessDate.setUTCHours(0, 0, 0, 0)
    const requestKey = request.headers.get('idempotency-key') || `feed-import:${reference || `${date}:${settlementAccountCode}:${baseAmount}`}`

    const prior = merchant ? await prisma.journalLine.findMany({
      where: { currency: foreignCurrency, journalEntry: { date: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 120), lt: businessDate } } },
      include: { journalEntry: true }, orderBy: { journalEntry: { date: 'desc' } }, take: 30,
    }) : []

    const created = await commitJournalAtomic({
      date: businessDate,
      description: description || `Feed import: ${merchant || foreignCurrency} ${foreignAmount}`,
      branch: branchForCommit,
      baseCurrency,
      createdBy: session.user.id,
      eventType: 'MANUAL_ADJUSTMENT',
      idempotencyKey: requestKey,
      eventPayload: { source: 'feed_import', merchant, reference },
      lines: [
        { accountId: settlementAccount.id, credit: baseAmount, debit: 0, description: `Settlement via feed${reference ? ` (${reference})` : ''}`, currency: baseCurrency },
        { accountId: counterAccount.id, debit: foreignAmount, credit: 0, description: merchant ? `Feed: ${merchant}` : 'Feed transaction', currency: foreignCurrency, fxRateToBase, fxSource: effectiveFxSource, fxDate: effectiveFxDate },
      ],
    })

    const normalizedMerchant = merchant?.toLowerCase()
    const match = normalizedMerchant ? prior.find(line =>
      !isAuthoritativeBankFeed(line.fxSource)
      && ((line.journalEntry.description || '').toLowerCase().includes(normalizedMerchant) || (line.description || '').toLowerCase().includes(normalizedMerchant))
      && Math.abs((Number(line.debit) || Number(line.credit)) - foreignAmount) < Math.max(1, foreignAmount * 0.2)
    ) : undefined
    if (match && fxRateToBase != null) {
      const previousRate = match.fxRateToBase != null ? Number(match.fxRateToBase) : null
      const previousBase = previousRate != null ? (Number(match.debit) || Number(match.credit)) * previousRate : null
      const delta = previousBase != null ? baseAmount - previousBase : 0
      if (Math.abs(delta) > 0.005 || body.forceAdjustment === true) {
        await commitJournalAtomic({
          date: businessDate, branch: branchForCommit, baseCurrency, createdBy: session.user.id,
          description: `FX + fee adjustment for ${match.journalEntry.entryNumber || match.journalEntry.id} - ${merchant}`,
          eventType: 'MANUAL_ADJUSTMENT', idempotencyKey: `${requestKey}:fx-adjustment`,
          eventPayload: { source: 'fx_adjustment_from_feed', originalProvisionalId: match.journalEntryId, merchant },
          lines: [
            { accountId: counterAccount.id, debit: delta > 0 ? Math.abs(delta) : 0, credit: delta < 0 ? Math.abs(delta) : 0, description: `FX diff vs provisional for ${merchant}`, currency: baseCurrency },
            { accountId: settlementAccount.id, debit: delta < 0 ? Math.abs(delta) : 0, credit: delta > 0 ? Math.abs(delta) : 0, description: 'FX adjustment settlement', currency: baseCurrency },
          ],
        })
      }
    }

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    console.error('Feed import error:', error)
    return NextResponse.json({ error: 'Failed to import feed' }, { status: 500 })
  }
}
