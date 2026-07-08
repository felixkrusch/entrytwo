import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const rows = await prisma.template.findMany({
      where: { isInvoiceTemplate: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const templates = rows.map((t: { id: string; name: string; description: string | null; content: string | null }) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      content: t.content ? JSON.parse(t.content) : {},
    }))
    return NextResponse.json({ templates })
  } catch {
    return NextResponse.json({ templates: [] })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, description = '', lines = [], notes = '', terms = '', currency = 'EUR' } = body || {}
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

    const tpl = await prisma.template.create({
      data: {
        name: String(name).slice(0, 80),
        description: description ? String(description).slice(0, 200) : null,
        isInvoiceTemplate: true,
        content: JSON.stringify({ lines, notes, terms, currency }),
      },
    })
    return NextResponse.json({
      id: tpl.id,
      name: tpl.name,
      description: tpl.description,
      content: JSON.parse(tpl.content || '{}'),
    }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to save template' }, { status: 500 })
  }
}
