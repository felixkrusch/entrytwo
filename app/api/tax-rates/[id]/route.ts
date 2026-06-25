import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    await prisma.taxRate.delete({ where: { id } })

    await prisma.event.create({
      data: {
        eventType: 'MANUAL_ADJUSTMENT',
        entityType: 'TaxRate',
        entityId: id,
        payload: { action: 'TAX_RATE_DELETED' },
      },
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete tax rate' }, { status: 500 })
  }
}
