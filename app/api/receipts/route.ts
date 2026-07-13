import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { deleteAttachmentAsset } from '@/lib/attachments'

export async function GET(request: Request) {
  const session = await requireUser()
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 20))
  const where = session.user.role === 'VIEWER' ? { createdById: session.user.id } : undefined
  const [assets, total] = await Promise.all([
    prisma.fileAsset.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.fileAsset.count({ where }),
  ])
  return NextResponse.json({
    receipts: assets.map(asset => ({ name: asset.originalName, url: `/api/files/${asset.id}`, fileAssetId: asset.id, size: asset.size, mtime: asset.createdAt.toISOString() })),
    total, page, limit,
  })
}

export async function DELETE(request: Request) {
  const session = await requireUser(['ADMIN'])
  if (!session) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'File asset id is required' }, { status: 400 })
  const asset = await prisma.fileAsset.findUnique({ where: { id }, include: { journals: { take: 1 }, claimReceipts: { take: 1 } } })
  if (!asset) return NextResponse.json({ error: 'File not found' }, { status: 404 })
  if (asset.journals.length || asset.claimReceipts.length) return NextResponse.json({ error: 'This document is attached to an accounting record and is retained for audit.' }, { status: 409 })
  await deleteAttachmentAsset({ id: asset.id, storageKey: asset.storageKey })
  return NextResponse.json({ ok: true })
}
