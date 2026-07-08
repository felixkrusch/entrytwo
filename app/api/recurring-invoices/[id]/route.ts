import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const UpdateSchema = z.object({
  name: z.string().optional(),
  frequency: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']).optional(),
  interval: z.number().int().positive().optional(),
  endDate: z.string().datetime().optional().nullable(),
  autoSend: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']).optional(),
  notes: z.string().optional().nullable(),
  templateData: z.any().optional(),
})

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const r = await prisma.recurringInvoice.findUnique({
    where: { id },
    include: { contact: { select: { id: true, name: true } } },
  })
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(r)
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid' }, { status: 400 })
  }
  const data = parsed.data

  const update: Record<string, unknown> = {}
  if (data.name) update.name = data.name
  if (data.frequency) update.frequency = data.frequency
  if (data.interval) update.interval = data.interval
  if (data.endDate !== undefined) update.endDate = data.endDate ? new Date(data.endDate) : null
  if (data.autoSend !== undefined) update.autoSend = data.autoSend
  if (data.status) update.status = data.status
  if (data.notes !== undefined) update.notes = data.notes
  if (data.templateData) update.templateData = data.templateData

  const rec = await prisma.recurringInvoice.update({ where: { id }, data: update })
  return NextResponse.json(rec)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await prisma.recurringInvoice.delete({ where: { id } }).catch(() => {})
  return NextResponse.json({ success: true })
}
