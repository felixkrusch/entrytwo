import { getLlmConfigStatus } from '@/lib/llm'
import { requireUser } from '@/lib/authz'

export async function GET() {
  if (!await requireUser(['ADMIN'])) return Response.json({ error: 'Admin access required' }, { status: 403 })
  const status = getLlmConfigStatus()
  return Response.json(status)
}
