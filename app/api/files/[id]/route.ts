import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { readAttachment } from '@/lib/attachments'
import { canAccessFileAsset } from '@/lib/fileAccess'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser()
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const { id } = await params
  const asset = await prisma.fileAsset.findUnique({
    where: { id },
    include: {
      journals: { select: { id: true }, take: 1 },
      claimReceipts: { select: { claim: { select: { claimantUserId: true } } }, take: 1 },
    },
  })
  if (!asset) return NextResponse.json({ error: 'File not found' }, { status: 404 })
  const claimOwner = asset.claimReceipts[0]?.claim.claimantUserId
  const allowed = canAccessFileAsset({
    userId: session.user.id,
    role: session.user.role!,
    createdById: asset.createdById,
    hasJournalReference: asset.journals.length > 0,
    claimOwnerId: claimOwner,
  })
  if (!allowed) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  try {
    const buffer = await readAttachment(asset.storageKey)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': asset.mimeType,
        'Content-Length': String(asset.size),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ error: 'File is unavailable' }, { status: 404 })
  }
}
