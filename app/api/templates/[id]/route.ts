import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { logger } from '@/lib/logger'

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    const { id } = await context.params
    await prisma.template.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error('Error deleting template', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}
