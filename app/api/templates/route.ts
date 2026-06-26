import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const templates = await prisma.template.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        lines: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return NextResponse.json(templates)
  } catch (error) {
    console.error('Error fetching templates:', error)
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, description, lines } = body as {
      name: string
      description?: string
      lines: Array<{ accountCode: string; debit?: number; credit?: number; taxRateId?: string }>
    }

    if (!name || !lines?.length) {
      return NextResponse.json({ error: 'Name and lines required' }, { status: 400 })
    }

    const template = await prisma.template.create({
      data: {
        name,
        description: description || '',
        lines: JSON.stringify(lines),
      },
    })

    return NextResponse.json(template, { status: 201 })
  } catch (error) {
    console.error('Error creating template:', error)
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}