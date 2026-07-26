import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'

const DEFAULT_SNIPPETS = [
  { id: '1', name: 'Consulting', description: 'Professional consulting services', quantity: 1, unitPrice: 150 },
  { id: '2', name: 'Web Dev', description: 'Website development', quantity: 20, unitPrice: 100 },
  { id: '3', name: 'Design', description: 'Graphic design work', quantity: 10, unitPrice: 75 },
  { id: '4', name: 'Hosting', description: 'Monthly hosting service', quantity: 1, unitPrice: 29 },
  { id: '5', name: 'Support', description: 'Technical support (1hr)', quantity: 1, unitPrice: 85 },
]

export async function GET(request: Request) {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  try {
    const url = new URL(request.url)
    const kindFilter = url.searchParams.get('kind') || ''

    // Snippets (line + text) are stored in Template table purely for reuse.
    // They are separate from any "invoice layout templates".
    // We do not filter by isInvoiceTemplate; we filter out anything that looks like a full layout.
    const rows = await prisma.template.findMany({
      orderBy: { createdAt: 'asc' },
      take: 50,
    })

    if (rows.length === 0) {
      if (kindFilter === 'text') {
        return NextResponse.json({ snippets: [], source: 'default' })
      }
      return NextResponse.json({ snippets: DEFAULT_SNIPPETS.map(d => ({ ...d, kind: 'line' })), source: 'default' })
    }

    let snippets = rows
      .map((t: { id: string; name?: string; content?: unknown }) => {
        let c: Record<string, unknown> = {}
        const raw = t.content
        try {
          if (typeof raw === 'string') {
            c = JSON.parse(raw)
          } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            c = raw as Record<string, unknown>
          }
        } catch {}
        const hasLayoutShape = Array.isArray(c.lines) || typeof c.notes === 'string' || typeof c.terms === 'string'
        let k = (c.kind as string) || null
        if (!k) {
          if (hasLayoutShape) {
            // This is an old "full invoice layout template" row. Ignore for snippets.
            return null
          }
          k = 'line'
        }
        const desc = (c.description as string) || ''
        const txt = (c.text as string) || desc
        return {
          id: t.id,
          name: t.name || 'Snippet',
          description: desc,
          quantity: Number(c.quantity || 1),
          unitPrice: Number(c.unitPrice || 0),
          kind: k,
          text: txt,
        }
      })
      .filter(Boolean) as Array<{ id: string; name: string; description: string; quantity: number; unitPrice: number; kind: string; text: string }>

    if (kindFilter) {
      snippets = snippets.filter((s) => s.kind === kindFilter)
    }

    return NextResponse.json({ snippets, source: 'db' })
  } catch {
    const kindFilter = new URL(request.url).searchParams.get('kind') || ''
    if (kindFilter === 'text') {
      return NextResponse.json({ snippets: [], source: 'default' })
    }
    return NextResponse.json({ snippets: DEFAULT_SNIPPETS.map(d => ({ ...d, kind: 'line' })), source: 'default' })
  }
}

export async function POST(request: Request) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    const body = await request.json()
    const { name, description, quantity = 1, unitPrice = 0, kind = 'line', text } = body || {}

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    let contentObj: Record<string, unknown> = {}
    let desc = 'Invoice snippet'

    if (kind === 'text') {
      const t = (text || description || '').toString().slice(0, 2000)
      if (!t) {
        return NextResponse.json({ error: 'text is required for text snippets' }, { status: 400 })
      }
      contentObj = { kind: 'text', text: t }
      desc = 'Invoice text snippet'
    } else {
      if (!description) {
        return NextResponse.json({ error: 'description is required for line snippets' }, { status: 400 })
      }
      contentObj = {
        kind: 'line',
        description: String(description).slice(0, 200),
        quantity: Number(quantity) || 1,
        unitPrice: Number(unitPrice) || 0,
      }
      desc = 'Invoice line snippet'
    }

    const tpl = await prisma.template.create({
      data: {
        name: String(name).slice(0, 80),
        description: desc,
        // IMPORTANT: snippets are NOT "invoice layout templates".
        // We store them in the Template table for convenience but keep isInvoiceTemplate=false
        // so they never appear mixed with full layout templates (which we are removing).
        isInvoiceTemplate: false,
        content: JSON.stringify(contentObj),
      },
    })

    let c: Record<string, unknown> = {}
    try { c = JSON.parse(tpl.content || '{}') } catch {}
    return NextResponse.json({
      id: tpl.id,
      name: tpl.name,
      kind: c.kind || kind,
      description: (c.description as string) || '',
      quantity: Number(c.quantity || 1),
      unitPrice: Number(c.unitPrice || 0),
      text: (c.text as string) || '',
    }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to save snippet' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) {
    return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  }
  try {
    const url = new URL(request.url)
    const id = url.searchParams.get('id') || ''
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const existing = await prisma.template.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Snippet not found' }, { status: 404 })
    }

    await prisma.template.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete snippet' }, { status: 500 })
  }
}
