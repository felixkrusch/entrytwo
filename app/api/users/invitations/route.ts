import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authz'
import { prisma } from '@/lib/prisma'

export async function GET() {
  if (!await requireUser(['ADMIN'])) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  const invitations = await prisma.userInvitation.findMany({
    orderBy: { createdAt: 'desc' }, take: 100,
    select: { id: true, email: true, role: true, createdAt: true, expiresAt: true, acceptedAt: true },
  })
  const deliveryJobs = await prisma.durableJob.findMany({
    where: { idempotencyKey: { startsWith: 'invitation-email:' } },
    select: { idempotencyKey: true, status: true, lastError: true },
  })
  const byInvitation = new Map(deliveryJobs.map(job => [job.idempotencyKey.slice('invitation-email:'.length), job]))
  return NextResponse.json(invitations.map(invitation => ({ ...invitation, delivery: byInvitation.get(invitation.id) || null })))
}
