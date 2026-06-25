import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const createTaxRateSchema = z.object({
  name: z.string().min(1),
  rate: z.number().min(0).max(1),
  jurisdiction: z.string().optional(),
  taxType: z.string().optional(),
})

export async function GET() {
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
        payload: { action: 'TAX_RATE_CREATED', ...parsed.data },
      },
    })

    return NextResponse.json(rate, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to create tax rate' }, { status: 500 })
  }
}
