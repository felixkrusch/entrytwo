import { NextResponse } from 'next/server'
import { MAX_ATTACHMENTS_PER_UPLOAD, MAX_ATTACHMENT_BATCH_BYTES, storeAttachment } from '@/lib/attachments'
import { requireUser } from '@/lib/authz'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const session = await requireUser(['ADMIN', 'ACCOUNTANT'])
  if (!session) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })

  try {
    const declaredSize = Number(request.headers.get('content-length') || 0)
    if (declaredSize > MAX_ATTACHMENT_BATCH_BYTES) return NextResponse.json({ error: 'Attachment batch is too large' }, { status: 413 })
    const formData = await request.formData()
    const files = formData.getAll('file').filter((item): item is File => item instanceof File)
    if (!files.length) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    if (files.length > MAX_ATTACHMENTS_PER_UPLOAD) return NextResponse.json({ error: `Maximum ${MAX_ATTACHMENTS_PER_UPLOAD} files per upload` }, { status: 400 })
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENT_BATCH_BYTES) {
      return NextResponse.json({ error: 'Attachment batch is too large' }, { status: 413 })
    }

    const saved = []
    for (const file of files) {
      const attachment = await storeAttachment(file)
      saved.push({ ...attachment, name: attachment.originalName, savedPath: attachment.path })
    }
    return NextResponse.json({ success: true, saved })
  } catch (error) {
    console.error('Attachment save error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save attachment(s)' }, { status: 400 })
  }
}
