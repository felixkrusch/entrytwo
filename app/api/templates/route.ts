import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { logger } from '@/lib/logger'

export async function GET() {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  try {
    const templates = await prisma.template.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        content: true,
        isInvoiceTemplate: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return NextResponse.json(templates)
  } catch (error) {
    logger.error('Error fetching templates', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    const body = await request.json()
    const { name, description, content } = body as {
      name: string
      description?: string
      content?: unknown
    }

    if (!name) {
      return NextResponse.json({ error: 'Name required' }, { status: 400 })
    }

    const template = await prisma.template.create({
      data: {
        name,
        description: description || '',
        content: typeof content === 'string' ? content : JSON.stringify(content || {}),
      },
    })

    return NextResponse.json(template, { status: 201 })
  } catch (error) {
    logger.error('Error creating template', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}
