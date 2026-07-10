import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { requireUser } from '@/lib/authz'

const updateAccountSchema = z.object({
  code: z.string().min(1).max(20).optional(),
  name: z.string().min(1).max(100).optional(),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']).optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireUser(['ADMIN'])
  if (!session) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
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

    // Prevent the historical "codeTYPE" / "name==code" corruption pattern on PATCH
    const current = await prisma.account.findUnique({ where: { id } })
    const finalCode = (data.code || current?.code || '').toUpperCase()
    const finalName = (data.name || current?.name || '')
    const finalType = (data.type || current?.type || '')
    if (current && (finalCode !== current.code.toUpperCase() || finalName !== current.name || finalType !== current.type)) {
      // import guard lives in the same module via a shared helper; duplicate the check here for safety
      const t = finalType.toUpperCase()
      const bad = (finalCode.endsWith(t) ||
                   finalName.toUpperCase().replace(/\s+/g, '') === finalCode + t ||
                   finalName.toUpperCase().replace(/\s+/g, '') === finalCode)
      if (bad) {
        return NextResponse.json({ error: 'Refusing update that would produce a malformed account (code must be clean; name must be descriptive).' }, { status: 400 })
      }
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
        payload: { action: 'ACCOUNT_UPDATED', changes: data }, createdBy: session.user.id,
      },
    })

    return NextResponse.json(account)
  } catch (error: unknown) {
    const err = error as { code?: string }
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'Code already exists' }, { status: 409 })
    }
    if (err.code === 'P2025') {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireUser(['ADMIN'])
  if (!session) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
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
        payload: { action: 'ACCOUNT_DELETED', code: account.code, name: account.name }, createdBy: session.user.id,
      },
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }
}
