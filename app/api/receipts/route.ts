import { NextResponse } from 'next/server'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'

export async function GET() {
  try {
    const dir = join(process.cwd(), 'public', 'uploads', 'receipts')
    let files: string[] = []
    try {
      files = await readdir(dir)
    } catch {
      return NextResponse.json({ receipts: [] })
    }

    const items = await Promise.all(
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

    items.sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''))

    return NextResponse.json({ receipts: items })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to list receipts' }, { status: 500 })
  }
}
