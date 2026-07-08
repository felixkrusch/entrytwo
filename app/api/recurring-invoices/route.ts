import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { z } from 'zod'

const RecurringSchema = z.object({
  name: z.string().min(1),
  contactId: z.string(),
  frequency: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
  interval: z.number().int().positive().default(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional().nullable(),
  autoSend: z.boolean().default(false),
  notes: z.string().optional().nullable(),
  templateData: z.object({
    currency: z.string().default('EUR'),
    lines: z.array(z.object({
      description: z.string(),
      quantity: z.number().positive(),
      unitPrice: z.number().nonnegative(),
      taxRateId: z.string().optional().nullable(),
    })),
    notes: z.string().optional().nullable(),
    terms: z.string().optional().nullable(),
  }),
})



export async function GET() {
  try {
    const list = await prisma.recurringInvoice.findMany({
      orderBy: { nextDueDate: 'asc' },
      include: { contact: { select: { id: true, name: true } } },
    })
    return NextResponse.json({ recurring: list })
  } catch {
    return NextResponse.json({ error: 'Failed to load recurring' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = RecurringSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data', details: parsed.error.format() }, { status: 400 })
    }
    const data = parsed.data

    const start = new Date(data.startDate)
    const rec = await prisma.recurringInvoice.create({
      data: {
        name: data.name,
        contactId: data.contactId,
        frequency: data.frequency,
        interval: data.interval,
        startDate: start,
        endDate: data.endDate ? new Date(data.endDate) : null,
        nextDueDate: start,
        autoSend: data.autoSend,
        notes: data.notes || null,
        templateData: data.templateData as unknown as Prisma.InputJsonValue,
        status: 'ACTIVE',
      },
    })
    return NextResponse.json(rec, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to load recurring' }, { status: 500 })
  }
}
