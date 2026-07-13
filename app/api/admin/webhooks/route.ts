import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'

export async function GET() {
  if (!await requireUser(['ADMIN'])) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  const [events, jobs] = await Promise.all([
    prisma.webhookEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.durableJob.findMany({ where: { type: { startsWith: 'WEBHOOK_' } }, orderBy: { createdAt: 'desc' }, take: 100, include: { attemptHistory: { orderBy: { startedAt: 'desc' }, take: 5 } } }),
  ])
  return NextResponse.json({ events, jobs })
}
