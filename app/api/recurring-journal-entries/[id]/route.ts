import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { logger } from '@/lib/logger'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    const { id } = await params
    const body = await request.json()
    const status = typeof body?.status === 'string' ? body.status : undefined
    if (!status || !['ACTIVE', 'PAUSED', 'CANCELLED'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    const updated = await prisma.recurringJournalEntry.update({
      where: { id },
      data: { status },
    })
    return NextResponse.json({ schedule: updated })
  } catch (e) {
    logger.error('Error updating recurring journal schedule', { error: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    const { id } = await params
    await prisma.recurringJournalEntry.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    logger.error('Error deleting recurring journal schedule', { error: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'Failed to delete schedule' }, { status: 500 })
  }
}
