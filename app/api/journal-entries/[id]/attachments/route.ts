import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { MAX_ATTACHMENTS_PER_UPLOAD, MAX_ATTACHMENT_BATCH_BYTES, storeAttachment, deleteAttachmentAsset, type StoredAttachment } from '@/lib/attachments'
import { requireUser } from '@/lib/authz'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireUser(['ADMIN', 'ACCOUNTANT'])
  if (!session) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  const { id } = await context.params

  const stored: StoredAttachment[] = []
  try {
    const declaredSize = Number(request.headers.get('content-length') || 0)
    if (declaredSize > MAX_ATTACHMENT_BATCH_BYTES) return NextResponse.json({ error: 'Attachment batch is too large' }, { status: 413 })
    const form = await request.formData()
    const files = form.getAll('file').filter((item): item is File => item instanceof File)
    if (!files.length || files.length > MAX_ATTACHMENTS_PER_UPLOAD) {
      return NextResponse.json({ error: `Choose between 1 and ${MAX_ATTACHMENTS_PER_UPLOAD} files` }, { status: 400 })
    }
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENT_BATCH_BYTES) {
      return NextResponse.json({ error: 'Attachment batch is too large' }, { status: 413 })
    }

    const entry = await prisma.journalEntry.findUnique({ where: { id }, select: { id: true } })
    if (!entry) return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 })

    for (const file of files) stored.push(await storeAttachment(file, session.user.id))

    const branchName = typeof form.get('branch') === 'string' ? String(form.get('branch')) : 'main'
    const created = await prisma.$transaction(async tx => {
      const attachments = await Promise.all(stored.map(attachment => tx.journalAttachment.create({
        data: { fileAssetId: attachment.id, journalEntryId: id, source: 'later-upload', createdBy: session.user.id },
        include: { fileAsset: true },
      })))
      const branch = await tx.accountingBranch.findUnique({ where: { name: branchName }, select: { headEventId: true } })
      const event = await tx.event.create({
        data: {
          eventType: 'JOURNAL_ATTACHMENT_ADDED',
          entityType: 'JournalEntry',
          entityId: id,
          parentEventId: branch?.headEventId || null,
          createdBy: session.user.id,
          payload: { attachmentIds: attachments.map(item => item.id), fileAssetIds: attachments.map(item => item.fileAssetId) },
        },
      })
      await tx.accountingBranch.updateMany({ where: { name: branchName }, data: { headEventId: event.id } })
      return attachments
    })

    return NextResponse.json({ attachments: created }, { status: 201 })
  } catch (error) {
    await Promise.all(stored.map(attachment => prisma.fileAsset.findUnique({ where: { id: attachment.id }, select: { id: true, storageKey: true } }).then(asset => asset ? deleteAttachmentAsset(asset) : undefined).catch(() => undefined)))
    logger.error('Journal attachment upload failed', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Attachment upload failed' }, { status: 400 })
  }
}
