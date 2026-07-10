import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { MAX_ATTACHMENTS_PER_UPLOAD, MAX_ATTACHMENT_BATCH_BYTES, storeAttachment, type StoredAttachment } from '@/lib/attachments'
import { requireUser } from '@/lib/authz'
import { unlink } from 'fs/promises'
import { basename, join } from 'path'

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

    const entry = await prisma.journalEntry.findUnique({ where: { id }, select: { id: true, sourcePdfPath: true } })
    if (!entry) return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 })

    for (const file of files) stored.push(await storeAttachment(file))

    const branchName = typeof form.get('branch') === 'string' ? String(form.get('branch')) : 'main'
    const created = await prisma.$transaction(async tx => {
      const attachments = await Promise.all(stored.map(attachment => tx.journalAttachment.create({
        data: { ...attachment, journalEntryId: id, source: 'later-upload', createdBy: session.user.id },
      })))
      if (!entry.sourcePdfPath && attachments[0]) {
        await tx.journalEntry.update({ where: { id }, data: { sourcePdfPath: attachments[0].path } })
      }
      const branch = await tx.accountingBranch.findUnique({ where: { name: branchName }, select: { headEventId: true } })
      const event = await tx.event.create({
        data: {
          eventType: 'JOURNAL_ATTACHMENT_ADDED',
          entityType: 'JournalEntry',
          entityId: id,
          parentEventId: branch?.headEventId || null,
          createdBy: session.user.id,
          payload: { attachmentIds: attachments.map(item => item.id), files: attachments.map(item => ({ path: item.path, sha256: item.sha256, size: item.size })) },
        },
      })
      await tx.accountingBranch.updateMany({ where: { name: branchName }, data: { headEventId: event.id } })
      return attachments
    })

    return NextResponse.json({ attachments: created }, { status: 201 })
  } catch (error) {
    await Promise.all(stored.map(attachment => unlink(join(process.cwd(), 'public', 'uploads', 'receipts', basename(attachment.path))).catch(() => {})))
    console.error('Journal attachment upload failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Attachment upload failed' }, { status: 400 })
  }
}
