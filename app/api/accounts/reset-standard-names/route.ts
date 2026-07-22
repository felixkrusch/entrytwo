import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { requireUser } from '@/lib/authz'
import { accountsForLocale, isStandardAccountName, normalizeLocale, STANDARD_ACCOUNTS } from '@/lib/chartOfAccounts'
import { EventType } from '@prisma/client'

const BodySchema = z.object({
  locale: z.enum(['en', 'de']),
  /** If true, only rename accounts whose current name is still a standard EN/DE name. */
  onlyUnmodified: z.boolean().default(true),
})

export async function POST(request: Request) {
  const session = await requireUser(['ADMIN'])
  if (!session) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  try {
    const body = await request.json()
    const parsed = BodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }

    const locale = normalizeLocale(parsed.data.locale)
    const targets = accountsForLocale(locale, STANDARD_ACCOUNTS)
    const byCode = new Map(targets.map((a) => [a.code, a.name]))

    const existing = await prisma.account.findMany({
      where: { code: { in: [...byCode.keys()] } },
      select: { id: true, code: true, name: true },
    })

    let updated = 0
    let skipped = 0
    for (const acc of existing) {
      const nextName = byCode.get(acc.code)
      if (!nextName || nextName === acc.name) {
        skipped++
        continue
      }
      if (parsed.data.onlyUnmodified && !isStandardAccountName(acc.code, acc.name)) {
        skipped++
        continue
      }
      await prisma.account.update({
        where: { id: acc.id },
        data: { name: nextName },
      })
      updated++
    }

    await prisma.event.create({
      data: {
        eventType: EventType.SYSTEM,
        entityType: 'Account',
        entityId: 'standard-names',
        createdBy: session.user.id,
        payload: {
          action: 'RESET_STANDARD_ACCOUNT_NAMES',
          locale,
          onlyUnmodified: parsed.data.onlyUnmodified,
          updated,
          skipped,
        },
      },
    })

    return NextResponse.json({ success: true, updated, skipped, locale })
  } catch {
    return NextResponse.json({ error: 'Failed to reset account names' }, { status: 500 })
  }
}
