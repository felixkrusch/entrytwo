import { requireUser } from '@/lib/authz'
import { postExpenseClaim, transitionExpenseClaim } from '@/lib/expenseClaims'

const actions = new Set(['submit', 'approve', 'request-changes', 'reject', 'post'])

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser()
  if (!session) return Response.json({ error: 'Authentication required' }, { status: 401 })
  const { id } = await params
  try {
    const body = await request.json()
    const action = String(body.action || '')
    if (!actions.has(action)) return Response.json({ error: 'Unsupported claim action' }, { status: 400 })
    const actor = { id: session.user.id, role: session.user.role! }
    const claim = action === 'post'
      ? await postExpenseClaim(id, actor, typeof body.branch === 'string' ? body.branch : 'main')
      : await transitionExpenseClaim(id, action as 'submit' | 'approve' | 'request-changes' | 'reject', actor, typeof body.comment === 'string' ? body.comment : undefined)
    return Response.json(claim)
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Claim action failed' }, { status: 400 })
  }
}
