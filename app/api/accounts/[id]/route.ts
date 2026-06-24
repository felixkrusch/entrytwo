import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const updateAccountSchema = z.object({
  code: z.string().min(1).max(20).optional(),
  name: z.string().min(1).max(100).optional(),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']).optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const parsed = updateAccountSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }

    const data: { code?: string; name?: string; type?: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' } = {}
    if (parsed.data.code) data.code = parsed.data.code.toUpperCase()
    if (parsed.data.name) data.name = parsed.data.name
    if (parsed.data.type) data.type = parsed.data.type

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const account = await prisma.account.update({
      where: { id },
      data,
      include: { _count: { select: { journalLines: true } } },
    })

    await prisma.event.create({
      data: {
        eventType: 'MANUAL_ADJUSTMENT',
        entityType: 'Account',
        entityId: id,
        payload: { action: 'ACCOUNT_UPDATED', changes: data },
      },
    })

    return NextResponse.json(account)
  } catch (error: unknown) {
    const err = error as { code?: string }
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'Code already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const lineCount = await prisma.journalLine.count({ where: { accountId: id } })
    if (lineCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete account with existing journal entries' },
        { status: 400 }
      )
    }

    const account = await prisma.account.delete({ where: { id } })

    await prisma.event.create({
      data: {
        eventType: 'MANUAL_ADJUSTMENT',
        entityType: 'Account',
        entityId: id,
        payload: { action: 'ACCOUNT_DELETED', code: account.code, name: account.name },
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }
}
