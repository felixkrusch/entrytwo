import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { claimInclude, createExpenseClaim } from '@/lib/expenseClaims'

export async function GET(request: NextRequest) {
  const session = await requireUser()
  if (!session) return Response.json({ error: 'Authentication required' }, { status: 401 })
  const role = session.user.role!
  const status = request.nextUrl.searchParams.get('status')
  const mine = request.nextUrl.searchParams.get('mine') === 'true'
  const where = {
    ...(role === 'VIEWER' || mine ? { claimantUserId: session.user.id } : {}),
    ...(status && status !== 'ALL' ? { workflowStatus: status as 'DRAFT' | 'SUBMITTED' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' } : {}),
  }
  const [claims, users, accounts] = await Promise.all([
    prisma.expenseClaim.findMany({ where, include: claimInclude, orderBy: { updatedAt: 'desc' }, take: 100 }),
    prisma.user.findMany({ where: role === 'VIEWER' ? { id: session.user.id } : undefined, select: { id: true, name: true, email: true, role: true }, orderBy: { email: 'asc' } }),
    prisma.account.findMany({ where: { type: { in: ['EXPENSE', 'LIABILITY'] } }, select: { id: true, code: true, name: true, type: true }, orderBy: { code: 'asc' } }),
  ])
  return Response.json({ claims, users, accounts, actor: { id: session.user.id, role } })
}

export async function POST(request: Request) {
  const session = await requireUser()
  if (!session) return Response.json({ error: 'Authentication required' }, { status: 401 })
  try {
    const claim = await createExpenseClaim(await request.json(), { id: session.user.id, role: session.user.role! })
    return Response.json(claim, { status: 201 })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not create claim' }, { status: 400 })
  }
}
