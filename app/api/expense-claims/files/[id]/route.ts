import { requireUser } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { canViewClaim } from '@/lib/expenseClaims'
import { readClaimFile } from '@/lib/claimFiles'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser()
  if (!session) return Response.json({ error: 'Authentication required' }, { status: 401 })
  const { id } = await params
  const receipt = await prisma.expenseClaimReceipt.findUnique({ where: { id }, include: { claim: { select: { claimantUserId: true } } } })
  if (!receipt || !canViewClaim({ id: session.user.id, role: session.user.role! }, receipt.claim.claimantUserId)) return Response.json({ error: 'Receipt not found' }, { status: 404 })
  try {
    const data = await readClaimFile(receipt.storageKey)
    return new Response(data, {
      headers: {
        'Content-Type': receipt.mimeType,
        'Content-Length': String(receipt.size),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(receipt.originalName)}`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return Response.json({ error: 'Receipt file is unavailable' }, { status: 404 })
  }
}
