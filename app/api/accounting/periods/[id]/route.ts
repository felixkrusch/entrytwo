import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'

const transitionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('close') }),
  z.object({ action: z.literal('reopen'), reason: z.string().trim().min(10).max(500) }),
])

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireUser(['ADMIN', 'ACCOUNTANT'])
  if (!session) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  const parsed = transitionSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid transition' }, { status: 400 })
  const { id } = await context.params
  const reopenReason = parsed.data.action === 'reopen' ? parsed.data.reason : null
  const period = await prisma.$transaction(async tx => {
    const current = await tx.accountingPeriod.findUnique({ where: { id } })
    if (!current) throw new Error('NOT_FOUND')
    const closing = parsed.data.action === 'close'
    const updated = await tx.accountingPeriod.update({
      where: { id },
      data: closing
        ? { status: 'CLOSED', closedAt: new Date(), closedById: session.user.id, reopenReason: null }
        : { status: 'OPEN', closedAt: null, closedById: null, reopenReason },
    })
    await tx.event.create({ data: {
      eventType: 'MANUAL_ADJUSTMENT', entityType: 'AccountingPeriod', entityId: id, createdBy: session.user.id,
      payload: { action: closing ? 'PERIOD_CLOSED' : 'PERIOD_REOPENED', name: current.name, reason: reopenReason },
    } })
    return updated
  }).catch(error => { if (error instanceof Error && error.message === 'NOT_FOUND') return null; throw error })
  return period ? NextResponse.json(period) : NextResponse.json({ error: 'Period not found' }, { status: 404 })
}
