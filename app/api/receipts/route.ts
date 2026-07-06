import { NextResponse } from 'next/server'
import { readdir, stat, unlink } from 'fs/promises'
import { join } from 'path'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))

    const dir = join(process.cwd(), 'public', 'uploads', 'receipts')
    let files: string[] = []
    try {
      files = await readdir(dir)
    } catch {
      return NextResponse.json({ receipts: [], total: 0, page, limit })
    }

    const allItems = await Promise.all(
      files
        .filter((f) => !f.startsWith('.'))
        .map(async (name) => {
          const full = join(dir, name)
          const st = await stat(full).catch(() => null)
          return {
            name,
            url: `/uploads/receipts/${name}`,
            size: st ? st.size : 0,
            mtime: st ? st.mtime.toISOString() : null,
          }
        })
    )

    allItems.sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''))

    const total = allItems.length
    const start = (page - 1) * limit
    const receipts = allItems.slice(start, start + limit)

    return NextResponse.json({ receipts, total, page, limit })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to list receipts' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const file = searchParams.get('file')
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })
    const safe = file.replace(/[^a-zA-Z0-9_.-]/g, '')
    if (!safe) return NextResponse.json({ error: 'invalid file' }, { status: 400 })
    const dir = join(process.cwd(), 'public', 'uploads', 'receipts')
    const full = join(dir, safe)
    await unlink(full)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
