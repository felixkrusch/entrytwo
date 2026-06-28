import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const ContactUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  type: z.enum(['CUSTOMER', 'VENDOR']).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  addressStreet: z.string().max(200).optional().nullable(),
  addressCity: z.string().max(100).optional().nullable(),
  addressState: z.string().max(100).optional().nullable(),
  addressZip: z.string().max(20).optional().nullable(),
  addressCountry: z.string().length(2).optional().nullable(),
  addressLine2: z.string().max(200).optional().nullable(),
  taxId: z.string().optional().nullable(),
  currency: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const parsed = ContactUpdateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid contact data', details: parsed.error.format() },
      { status: 400 }
    )
  }

  try {
    const data = parsed.data
    const updateData: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        updateData[key] = value
      }
    }
    
    const contact = await prisma.contact.update({
      where: { id },
      data: updateData,
    })

    const entryCount = await prisma.journalLine.count({ where: { contactId: contact.id } })

    return NextResponse.json({ ...contact, entryCount })
  } catch {
    return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const entryCount = await prisma.journalLine.count({ where: { contactId: id } })
    if (entryCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete contact with journal entries' },
        { status: 400 }
      )
    }

    await prisma.contact.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 })
  }
}
