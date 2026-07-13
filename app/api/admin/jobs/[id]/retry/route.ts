import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { requireUser } from '@/lib/authz'
import { retryJob } from '@/lib/jobs'

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await requireUser(['ADMIN'])) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  const { id } = await context.params
  try {
    const job = await retryJob(id)
    return NextResponse.json({ ok: true, jobId: job.id, status: job.status })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Retry failed' }, { status: 500 })
  }
}
