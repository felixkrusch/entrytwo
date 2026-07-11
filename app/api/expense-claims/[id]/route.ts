import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { canViewClaim, claimInclude, updateExpenseClaim } from '@/lib/expenseClaims'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser()
  if (!session) return Response.json({ error: 'Authentication required' }, { status: 401 })
  const { id } = await params
  const claim = await prisma.expenseClaim.findUnique({ where: { id }, include: claimInclude })
  if (!claim || !canViewClaim({ id: session.user.id, role: session.user.role! }, claim.claimantUserId)) return Response.json({ error: 'Claim not found' }, { status: 404 })
  return Response.json(claim)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser()
  if (!session) return Response.json({ error: 'Authentication required' }, { status: 401 })
  const { id } = await params
  try {
    const body = await request.json()
    const claim = await updateExpenseClaim(id, body, Number(body.revision), { id: session.user.id, role: session.user.role! })
    return Response.json(claim)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update claim'
    return Response.json({ error: message }, { status: message === 'REVISION_CONFLICT' ? 409 : 400 })
  }
}
