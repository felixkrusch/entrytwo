import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { requireUser } from '@/lib/authz'
import { logger } from '@/lib/logger'
import { getCompanyProfile } from '@/lib/companyProfile'

const ALLOWED_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const

const createAccountSchema = z.object({
  code: z.string().min(1).max(20).regex(/^[A-Za-z0-9._-]+$/, 'Code must be alphanumeric with optional . _ -'),
  name: z.string().min(1).max(100),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
})

// Hard guard against the historical "code + type" corruption pattern
// (e.g. "10102738334ASSET" appearing in both code and name).
// We never want to allow codes or names that look like concatenation of a code and an account type.
function isMalformedAccount(code: string, name: string, type: string): boolean {
  const upperCode = code.toUpperCase()
  const upperName = name.toUpperCase()
  const t = type.toUpperCase()
  if (ALLOWED_TYPES.includes(t as any) && upperCode.endsWith(t)) return true
  if (ALLOWED_TYPES.includes(t as any) && upperName.endsWith(t) && upperName.includes(upperCode)) return true
  // obvious concat without separator
  if (upperName.replace(/\s+/g, '') === upperCode + t) return true
  if (upperName.replace(/\s+/g, '') === t + upperCode) return true
  // name exactly equals code (common symptom of bad creation)
  if (upperName.replace(/\s+/g, '') === upperCode) return true
  return false
}

export async function GET(request: Request) {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  try {
    const url = new URL(request.url)
    const branchParam = url.searchParams.get('branch') || 'main'
    const asOf = url.searchParams.get('asOf') || url.searchParams.get('asof')

    // Git ancestry-based visibility (current head or pinned asOf)
    // Graceful fallback: if ancestry gives no visible ids (legacy data, or head with no journal ancestry yet), show everything for current view.
    let visibleEntryIds: string[] = []
    let restrictLines = false
    if (asOf) {
      const { getVisibleJournalEntryIdsAtPoint } = await import('@/lib/accounting/ancestry')
      visibleEntryIds = await getVisibleJournalEntryIdsAtPoint(asOf)
      restrictLines = true
    } else {
      const { getVisibleJournalEntryIds } = await import('@/lib/accounting/ancestry')
      const br = await prisma.accountingBranch.findUnique({ where: { name: branchParam } })
      visibleEntryIds = await getVisibleJournalEntryIds(br?.headEventId)
      restrictLines = visibleEntryIds.length > 0
    }

    const lineWhere: Record<string, unknown> = restrictLines && visibleEntryIds.length > 0
      ? { journalEntryId: { in: visibleEntryIds } }
      : {}  // show all lines for this account when no ancestry restriction applies yet

    const profile = await getCompanyProfile()
    const baseCurrency = (profile.baseCurrency || 'EUR').toUpperCase()

    const accounts = await prisma.account.findMany({
      orderBy: { code: 'asc' },
      include: {
        journalLines: {
          where: lineWhere,
          select: { debit: true, credit: true, currency: true, fxRateToBase: true }
        }
      }
    })

    const withBalances = accounts.map(acc => {
      let bal = 0
      for (const l of acc.journalLines) {
        const d = Number(l.debit)
        const c = Number(l.credit)
        const cur = (l.currency || baseCurrency).toUpperCase()
        let rate = 1
        if (cur !== baseCurrency) {
          const r = Number(l.fxRateToBase)
          if (isFinite(r) && r > 0) rate = r
        }
        const baseD = d * rate
        const baseC = c * rate
        if (['ASSET', 'EXPENSE'].includes(acc.type)) bal += baseD - baseC
        else bal += baseC - baseD
      }
      const visibleCount = acc.journalLines.length
      const { journalLines: _journalLines, ...rest } = acc
      void _journalLines

      // Flag obviously corrupted accounts from past bugs (e.g. code "1010ASSET", name same as code+type)
      const t = acc.type.toUpperCase()
      const cUp = acc.code.toUpperCase()
      const nUp = (acc.name || '').toUpperCase().replace(/\s+/g, '')
      const malformed = ALLOWED_TYPES.includes(t as any) && (
        cUp.endsWith(t) ||
        nUp === cUp + t ||
        nUp === cUp ||
        nUp === t + cUp
      )

      return {
        ...rest,
        _count: { journalLines: visibleCount },
        balance: parseFloat(bal.toFixed(2)),
        malformed
      }
    })

    return NextResponse.json(withBalances)
  } catch (error) {
    logger.error('Error fetching accounts', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: 'Failed to fetch accounts' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const session = await requireUser(['ADMIN'])
  if (!session) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  try {
    const body = await request.json()
    const parsed = createAccountSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid account data', details: parsed.error.format() },
        { status: 400 }
      )
    }

    const { code, name, type } = parsed.data

    if (isMalformedAccount(code, name, type)) {
      return NextResponse.json(
        { error: 'Invalid account code or name. Code must be a clean identifier (no type suffix). Name must be descriptive and different from the code.' },
        { status: 400 }
      )
    }

    const existing = await prisma.account.findUnique({ where: { code } })
    if (existing) {
      return NextResponse.json({ error: 'Account code already exists' }, { status: 409 })
    }

    const account = await prisma.account.create({
      data: { code, name, type },
      include: {
        _count: { select: { journalLines: true } }
      }
    })

    await prisma.event.create({
      data: {
        eventType: 'ACCOUNT_CREATED',
        entityType: 'Account',
        entityId: account.id,
        payload: { code, name, type }, createdBy: session.user.id,
      },
    })

    return NextResponse.json(account, { status: 201 })
  } catch (error: unknown) {
    const err = error as { code?: string }
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'Account code already exists' }, { status: 409 })
    }
    logger.error('Error creating account', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}
