import { NextResponse, NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { getRequestId } from '@/lib/correlation'

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
}).refine(value => value.startDate <= value.endDate, { message: 'End date must not precede start date' })

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) {
    const res = NextResponse.json({ error: 'Accountant access required', requestId }, { status: 403 })
    res.headers.set('x-request-id', requestId)
    return res
  }
  const data = await prisma.accountingPeriod.findMany({ orderBy: { startDate: 'desc' } })
  const res = NextResponse.json(data)
  res.headers.set('x-request-id', requestId)
  return res
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
  const session = await requireUser(['ADMIN', 'ACCOUNTANT'])
  if (!session) {
    const res = NextResponse.json({ error: 'Accountant access required', requestId }, { status: 403 })
    res.headers.set('x-request-id', requestId)
    return res
  }
  const parsed = createSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid period' }, { status: 400 })
  const overlap = await prisma.accountingPeriod.findFirst({
    where: { startDate: { lte: parsed.data.endDate }, endDate: { gte: parsed.data.startDate } },
  })
  if (overlap) return NextResponse.json({ error: `Period overlaps ${overlap.name}` }, { status: 409 })
  const period = await prisma.accountingPeriod.create({ data: parsed.data })
  return NextResponse.json(period, { status: 201 })
}
