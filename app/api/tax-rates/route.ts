import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { requireUser } from '@/lib/authz'

const createTaxRateSchema = z.object({
  name: z.string().min(1),
  rate: z.number().min(0).max(1),
  jurisdiction: z.string().optional(),
  taxType: z.string().optional(),
})

export async function GET() {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  try {
    const rates = await prisma.taxRate.findMany({
      orderBy: [{ jurisdiction: 'asc' }, { rate: 'desc' }],
    })
    return NextResponse.json(rates)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch tax rates' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const session = await requireUser(['ADMIN'])
  if (!session) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  try {
    const body = await request.json()
    const parsed = createTaxRateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }

    const rate = await prisma.taxRate.create({
      data: {
        name: parsed.data.name,
        rate: parsed.data.rate,
        jurisdiction: parsed.data.jurisdiction || '',
        taxType: parsed.data.taxType || 'STANDARD',
      },
    })

    await prisma.event.create({
      data: {
        eventType: 'MANUAL_ADJUSTMENT',
        entityType: 'TaxRate',
        entityId: rate.id,
        payload: { action: 'TAX_RATE_CREATED', ...parsed.data }, createdBy: session.user.id,
      },
    })

    return NextResponse.json(rate, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to create tax rate' }, { status: 500 })
  }
}
