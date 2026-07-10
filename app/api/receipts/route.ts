import { NextResponse } from 'next/server'
import { readdir, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'

export async function GET(req: Request) {
  const session = await requireUser()
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  try {
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
    const dir = join(process.cwd(), 'public', 'uploads', 'receipts')
    const files = await readdir(dir).catch(() => [])
    const allItems = await Promise.all(files.filter(file => !file.startsWith('.')).map(async name => {
      const info = await stat(join(dir, name)).catch(() => null)
      return { name, url: `/uploads/receipts/${name}`, size: info?.size || 0, mtime: info?.mtime.toISOString() || null }
    }))
    allItems.sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''))
    const start = (page - 1) * limit
    return NextResponse.json({ receipts: allItems.slice(start, start + limit), total: allItems.length, page, limit })
  } catch {
    return NextResponse.json({ error: 'Failed to list receipts' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const session = await requireUser(['ADMIN'])
  if (!session) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  try {
    const file = new URL(req.url).searchParams.get('file')
    if (!file || !/^[a-zA-Z0-9_.-]+$/.test(file) || file.includes('..')) return NextResponse.json({ error: 'invalid file' }, { status: 400 })
    const path = `/uploads/receipts/${file}`
    const [attachmentRef, legacyRef] = await Promise.all([
      prisma.journalAttachment.findFirst({ where: { path }, select: { id: true } }),
      prisma.journalEntry.findFirst({ where: { sourcePdfPath: path }, select: { id: true } }),
    ])
    if (attachmentRef || legacyRef) {
      return NextResponse.json({ error: 'This document is attached to a journal entry and is retained for audit purposes.' }, { status: 409 })
    }
    await unlink(join(process.cwd(), 'public', 'uploads', 'receipts', file))
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
