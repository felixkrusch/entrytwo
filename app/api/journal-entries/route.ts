import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { getVisibleJournalEntryIds, getVisibleJournalEntryIdsAtPoint } from '@/lib/accounting/ancestry'
import { isAuthoritativeBankFeed, normalizeToProvisional } from '@/lib/fxSources'
import { parseAttachmentInput } from '@/lib/attachments'
import { requireUser } from '@/lib/authz'
import { calculateFxBalance } from '@/lib/accounting/fxBalance'
import { getCompanyProfile } from '@/lib/companyProfile'
import { commitJournalAtomic } from '@/lib/accounting/atomicCommit'
import { logger } from '@/lib/logger'

const createEntrySchema = z.object({
  date: z.string().refine((d) => !isNaN(Date.parse(d)), { message: 'Invalid date format' }),
  description: z.string().optional(),
  attachments: z.array(z.object({
    path: z.string(),
    originalName: z.string(),
    mimeType: z.string(),
    size: z.number().int().min(0),
    sha256: z.string(),
  })).max(100).optional(),
  lines: z.array(z.object({
    accountId: z.string().uuid({ message: 'accountId must be a valid UUID' }),
    debit: z.number().min(0),
    credit: z.number().min(0),
    description: z.string().optional(),
    taxRateId: z.string().uuid().optional(),
    taxIsInput: z.boolean().optional(),
    currency: z.string().min(3).max(3).optional(),
    fxRateToBase: z.number().positive().optional(),
    fxSource: z.string().optional(),
    fxDate: z.string().refine((d) => !isNaN(Date.parse(d)), { message: 'Invalid fxDate' }).optional(),
    contactId: z.string().uuid().optional(),
  })).min(2)
})

export async function GET(request: Request) {
  const session = await requireUser()
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  try {
    const baseCurrency = (await getCompanyProfile()).baseCurrency.toUpperCase()
    const { searchParams } = new URL(request.url)

    const accountCode = searchParams.get('accountCode') || searchParams.get('account')
    const search = (searchParams.get('search') || '').trim()
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(5, parseInt(searchParams.get('limit') || '25', 10)))
    const sortParam = searchParams.get('sort') || 'date:desc'
    const [sortField, sortDir] = sortParam.split(':')
    const dir = sortDir === 'asc' ? 'asc' : 'desc'

    // Order by business date first (the calendar day the entry belongs to).
    // Use createdAt as the stable secondary key for true reverse-chronological
    // ordering within the same day. This replaces the previous entryNumber
    // secondary key (which is often NULL on legacy data and caused jumping order).
    const orderBy: Record<string, string>[] = sortField === 'date'
      ? [{ date: dir }, { createdAt: dir }]
      : [{ [sortField]: dir }, { createdAt: dir }]

    // Git Model: branch + asOf
    // - If asOf: pinned view at that point (uses ancestry of the event at that point)
    // - Else: current view for the branch = entries visible in the ancestor chain of the branch's current head
    const branchParam = searchParams.get('branch') || undefined
    const asOf = searchParams.get('asOf') || searchParams.get('asof') || undefined
    const targetBranch = branchParam || 'main'

    let visibleEntryIds: string[] = []
    let restrictToVisible = false
    if (asOf) {
      visibleEntryIds = await getVisibleJournalEntryIdsAtPoint(asOf)
      restrictToVisible = true
    } else {
      const br = await prisma.accountingBranch.findUnique({ where: { name: targetBranch } })
      visibleEntryIds = await getVisibleJournalEntryIds(br?.headEventId)
      // Only restrict if ancestry gave us a non-empty set. For legacy data with no parents yet, show all for current view.
      restrictToVisible = visibleEntryIds.length > 0
    }

    const where: Record<string, unknown> = {}
    if (restrictToVisible) {
      if (visibleEntryIds.length > 0) {
        where.id = { in: visibleEntryIds }
      } else {
        where.id = 'no-visible-entries-match'
      }
    }
    // else: no ancestry restriction → show all (legacy current main or no head yet)

    if (from || to) {
      const dateFilter: Record<string, Date> = {}
      if (from) dateFilter.gte = new Date(from)
      if (to) dateFilter.lte = new Date(to)
      where.date = dateFilter
    }

    if (accountCode) {
      where.lines = {
        some: {
          account: { code: accountCode }
        }
      }
    }

    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        {
          lines: {
            some: {
              description: { contains: search, mode: 'insensitive' }
            }
          },
        }
      ]
    }

    const [total, entries] = await Promise.all([
      prisma.journalEntry.count({ where }),
      prisma.journalEntry.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          lines: {
            include: {
              account: { select: { code: true, name: true } },
              taxRate: { select: { id: true, jurisdiction: true, name: true, rate: true, taxType: true } },
              contact: { select: { id: true, name: true, type: true } }
            }
          },
          attachments: { orderBy: { createdAt: 'asc' }, include: { fileAsset: true } },
        }
      })
    ])

    // Resolve the creating user for each entry (accountability metadata).
    const creatorIds = Array.from(new Set(entries.map(e => e.createdBy).filter(Boolean))) as string[]
    const creators = creatorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, name: true, email: true },
        })
      : []
    const creatorMap = new Map(creators.map(u => [u.id, u]))

    // Map raw entries into the stable UI shape.
    // Adds: entryNumber (top-level), line.cleared, createdByUser, and a reversal cross-reference.
    const mappedEntries = entries.map(e => ({
      id: e.id,
      date: e.date,
      description: e.description,
      entryNumber: e.entryNumber,
      createdBy: e.createdBy,
      createdByUser: e.createdBy ? creatorMap.get(e.createdBy) || null : null,
      updatedAt: e.updatedAt,
      sourcePdfPath: e.attachments[0] ? `/api/files/${e.attachments[0].fileAssetId}` : null,
      attachments: e.attachments.map(attachment => ({
        id: attachment.id,
        fileAssetId: attachment.fileAssetId,
        path: `/api/files/${attachment.fileAssetId}`,
        originalName: attachment.fileAsset.originalName,
        mimeType: attachment.fileAsset.mimeType,
        size: attachment.fileAsset.size,
        sha256: attachment.fileAsset.sha256,
        source: attachment.source,
        createdAt: attachment.createdAt,
      })),
      reversalOfEntryNumber:
        typeof e.description === 'string' && e.description.startsWith('Reversal of')
          ? (e.description.match(/JE-\d{4}-\d{4}/)?.[0] || null)
          : null,
      lines: e.lines.map(l => ({
        id: l.id,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
        account: l.account,
        taxRate: l.taxRate,
        taxIsInput: l.taxIsInput,
        currency: l.currency,
        fxRateToBase: l.fxRateToBase,
        fxSource: l.fxSource,
        fxDate: l.fxDate,
        contact: l.contact,
        cleared: l.cleared ?? false,
      })),
    }))

    // If using ancestry filter, the "total" above is already the visible count for the view.
    // We keep page/limit for UI pagination of the visible set.

    return NextResponse.json({
      entries: mappedEntries,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      // Git model context echoed back
      branch: targetBranch,
      asOf: asOf || null,
      baseCurrency,
    })
  } catch (error) {
    logger.error('Error fetching journal entries', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: 'Failed to fetch journal entries' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const session = await requireUser(['ADMIN', 'ACCOUNTANT'])
  if (!session) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    const body = await request.json()
    const parsed = createEntrySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid data', details: parsed.error.format() },
        { status: 400 }
      )
    }

    const { date, description, lines } = parsed.data
    const attachments = parseAttachmentInput(parsed.data.attachments)

    const baseCurrency = (await getCompanyProfile()).baseCurrency.toUpperCase()

    // Resolve missing foreign rates before balance checks. Never treat a foreign amount as base currency.
    for (const l of lines) {
      const cur = (l.currency || baseCurrency).toUpperCase()
      if (cur === baseCurrency) continue
      if (l.fxRateToBase == null) {
        return NextResponse.json({ error: `A sourced provisional FX rate is required for ${cur}` }, { status: 400 })
      } else if (!isAuthoritativeBankFeed(l.fxSource)) {
        const source = l.fxSource || ''
        const sourceUrls = source.match(/https?:\/\/[^\s,;]+/g) || []
        if (!/^MANUAL(?:_PROVISIONAL)?$/i.test(source) && !(source.startsWith('LLM_PROVISIONAL:') && new Set(sourceUrls).size >= 2)) {
          return NextResponse.json({ error: `Provisional FX rate for ${cur} requires two source URLs or MANUAL_PROVISIONAL` }, { status: 400 })
        }
        l.fxSource = normalizeToProvisional(l.fxSource)
      }
    }

    const balance = calculateFxBalance(lines, baseCurrency)
    if (!balance.balanced) {
      return NextResponse.json(
        { error: 'Debits must equal credits (in base currency) and be greater than zero' },
        { status: 400 }
      )
    }

    const createdEntry = await commitJournalAtomic({
      date,
      description,
      branch: typeof body.branch === 'string' ? body.branch : 'main',
      baseCurrency,
      createdBy: session.user.id,
      idempotencyKey: request.headers.get('idempotency-key') || undefined,
      attachments: attachments.map(attachment => ({ ...attachment, source: 'journal-create' })),
      lines,
    })

    return NextResponse.json(createdEntry, { status: 201 })
  } catch (error: unknown) {
    logger.error('Error creating journal entry', { error: error instanceof Error ? error.message : String(error) })

    const err = error as { code?: string; message?: string }
    if (err?.code === 'P2025') {
      return NextResponse.json({ error: 'Referenced account, tax rate, or contact not found' }, { status: 404 })
    }
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'Duplicate entry conflict' }, { status: 409 })
    }

    if (err?.message?.includes('Debits must equal')) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }

    return NextResponse.json(
      { error: 'Failed to create journal entry' },
      { status: 500 }
    )
  }
}

// PATCH updates reconciliation state for a single journal line (cleared flag).
export async function PATCH(request: Request) {
  const session = await requireUser(['ADMIN', 'ACCOUNTANT'])
  if (!session) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    const body = await request.json()
    const lineId = typeof body?.lineId === 'string' ? body.lineId : undefined
    const cleared = typeof body?.cleared === 'boolean' ? body.cleared : undefined

    if (!lineId) {
      return NextResponse.json({ error: 'lineId is required' }, { status: 400 })
    }

    const updated = await prisma.journalLine.update({
      where: { id: lineId },
      data: { cleared: cleared ?? false },
      select: { id: true, cleared: true },
    })

    return NextResponse.json(updated)
  } catch (error) {
    logger.error('Error updating journal line', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to update journal line' }, { status: 500 })
  }
}
