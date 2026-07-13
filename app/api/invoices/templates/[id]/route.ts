import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const { id } = await params
  const t = await prisma.template.findUnique({ where: { id } })
  if (!t || !t.isInvoiceTemplate) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    id: t.id,
    name: t.name,
    description: t.description,
    content: t.content ? JSON.parse(t.content) : {},
  })
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  const { id } = await params
  const body = await request.json()
  const t = await prisma.template.findUnique({ where: { id } })
  if (!t || !t.isInvoiceTemplate) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { name, description, content } = body || {}
  const updated = await prisma.template.update({
    where: { id },
    data: {
      name: name ? String(name).slice(0, 80) : t.name,
      description: description !== undefined ? (description ? String(description).slice(0, 200) : null) : t.description,
      content: content ? JSON.stringify(content) : t.content,
    },
  })
  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    description: updated.description,
    content: updated.content ? JSON.parse(updated.content) : {},
  })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  const { id } = await params
  await prisma.template.delete({ where: { id } }).catch(() => {})
  return NextResponse.json({ success: true })
}
