import { requireUser } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { canEditClaim } from '@/lib/expenseClaims'
import { deleteClaimFile, storeClaimFile, validateClaimFileSelection } from '@/lib/claimFiles'
import { MAX_ATTACHMENTS_PER_UPLOAD, MAX_ATTACHMENT_BATCH_BYTES } from '@/lib/attachments'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser()
  if (!session) return Response.json({ error: 'Authentication required' }, { status: 401 })
  const { id } = await params
  const claim = await prisma.expenseClaim.findUnique({ where: { id }, select: { claimantUserId: true, workflowStatus: true, postingStatus: true, revision: true } })
  if (!claim || !canEditClaim({ id: session.user.id, role: session.user.role! }, claim.claimantUserId)) return Response.json({ error: 'Claim not found' }, { status: 404 })
  if (claim.workflowStatus === 'APPROVED' || claim.postingStatus !== 'UNPOSTED') return Response.json({ error: 'Approved or posted claims cannot be edited' }, { status: 409 })

  const form = await request.formData()
  const files = form.getAll('file').filter((item): item is File => item instanceof File)
  if (files.length > MAX_ATTACHMENTS_PER_UPLOAD || files.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENT_BATCH_BYTES) return Response.json({ error: 'Attachment batch exceeds the configured limits' }, { status: 413 })
  try {
    validateClaimFileSelection(files)
    const storedFiles = []
    const seenHashes = new Set<string>()
    for (const file of files) {
      const stored = await storeClaimFile(file)
      if (seenHashes.has(stored.sha256)) {
        await deleteClaimFile(stored.storageKey)
        continue
      }
      seenHashes.add(stored.sha256)
      storedFiles.push(stored)
    }
    const existing = await prisma.expenseClaimReceipt.findMany({ where: { claimId: id, sha256: { in: storedFiles.map(file => file.sha256) } }, select: { sha256: true } })
    const existingHashes = new Set(existing.map(receipt => receipt.sha256))
    const newFiles = storedFiles.filter(file => !existingHashes.has(file.sha256))
    await Promise.all(storedFiles.filter(file => existingHashes.has(file.sha256)).map(file => deleteClaimFile(file.storageKey)))
    const nextRevision = claim.revision + 1
    const saved = await prisma.$transaction(async tx => {
      const created = []
      for (const stored of newFiles) {
        const duplicate = await tx.expenseClaimReceipt.findFirst({ where: { sha256: stored.sha256, claimId: { not: id } }, select: { id: true } })
        created.push(await tx.expenseClaimReceipt.create({ data: { claimId: id, uploadedByUserId: session.user.id, ...stored, source: 'claim-upload', duplicateStatus: duplicate ? 'POSSIBLE_DUPLICATE' : 'CLEAR' } }))
      }
      if (created.length) {
        await tx.expenseClaim.update({ where: { id }, data: { revision: nextRevision, workflowStatus: 'DRAFT', submittedAt: null, approvedRevision: null, approvedAt: null, approvedByUserId: null, reimbursementStatus: 'NOT_READY' } })
        await tx.expenseClaimActivity.create({ data: { claimId: id, actorUserId: session.user.id, revision: nextRevision, action: claim.workflowStatus === 'SUBMITTED' ? 'REOPENED_WITH_RECEIPTS' : 'RECEIPTS_ADDED', payload: { count: created.length, receiptIds: created.map(item => item.id) } } })
      }
      return created
    }).catch(async error => {
      await Promise.all(newFiles.map(file => deleteClaimFile(file.storageKey)))
      throw error
    })
    return Response.json({ saved })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Receipt upload failed' }, { status: 400 })
  }
}
