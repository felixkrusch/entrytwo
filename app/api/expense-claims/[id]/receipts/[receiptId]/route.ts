import { requireUser } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { canEditClaim } from '@/lib/expenseClaims'
import { deleteAttachmentAsset } from '@/lib/attachments'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; receiptId: string }> }) {
  const session = await requireUser()
  if (!session) return Response.json({ error: 'Authentication required' }, { status: 401 })
  const { id, receiptId } = await params
  const claim = await prisma.expenseClaim.findUnique({ where: { id }, select: { claimantUserId: true, workflowStatus: true, postingStatus: true, revision: true } })
  if (!claim || !canEditClaim({ id: session.user.id, role: session.user.role! }, claim.claimantUserId)) return Response.json({ error: 'Claim not found' }, { status: 404 })
  if (claim.workflowStatus === 'APPROVED' || claim.postingStatus !== 'UNPOSTED') return Response.json({ error: 'Approved or posted claims cannot be edited' }, { status: 409 })
  const receipt = await prisma.expenseClaimReceipt.findFirst({ where: { id: receiptId, claimId: id }, include: { fileAsset: true } })
  if (!receipt) return Response.json({ error: 'Receipt not found' }, { status: 404 })
  const nextRevision = claim.revision + 1
  await prisma.$transaction([
    prisma.expenseClaimReceipt.delete({ where: { id: receiptId } }),
    prisma.expenseClaim.update({ where: { id }, data: { revision: nextRevision, workflowStatus: 'DRAFT', submittedAt: null, approvedRevision: null, approvedAt: null, approvedByUserId: null, reimbursementStatus: 'NOT_READY' } }),
    prisma.expenseClaimActivity.create({ data: { claimId: id, actorUserId: session.user.id, revision: nextRevision, action: claim.workflowStatus === 'SUBMITTED' ? 'REOPENED_AFTER_RECEIPT_REMOVAL' : 'RECEIPT_REMOVED', payload: { receiptId, originalName: receipt.fileAsset.originalName } } }),
  ])
  await deleteAttachmentAsset({ id: receipt.fileAsset.id, storageKey: receipt.fileAsset.storageKey })
  return Response.json({ ok: true })
}
