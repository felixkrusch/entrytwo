import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
    console.error('Error updating recurring journal schedule', e)
    return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await prisma.recurringJournalEntry.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Error deleting recurring journal schedule', e)
    return NextResponse.json({ error: 'Failed to delete schedule' }, { status: 500 })
  }
}
