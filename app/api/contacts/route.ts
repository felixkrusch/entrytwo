import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { EventType } from '@prisma/client'

const ContactSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(200).optional(),
  type: z.enum(['CUSTOMER', 'VENDOR']),
  phone: z.string().max(50).optional(),
  addressStreet: z.string().max(200).optional(),
  addressCity: z.string().max(100).optional(),
  addressState: z.string().max(100).optional(),
  addressZip: z.string().max(20).optional(),
  addressCountry: z.string().length(2).optional(), // ISO 3166-1 alpha-2
  addressLine2: z.string().max(200).optional(),
  taxId: z.string().optional(),
  currency: z.string().optional(),
  notes: z.string().optional(),
})

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const search = url.searchParams.get('search') || ''
    const type = url.searchParams.get('type') || ''
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get('limit') || '20')))
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = {}

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { taxId: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (type && ['CUSTOMER', 'VENDOR'].includes(type)) {
      where.type = type
    }

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      prisma.contact.count({ where }),
    ])

    const contactsWithEntryCount = await Promise.all(
      contacts.map(async c => ({
        ...c,
        entryCount: await prisma.journalLine.count({ where: { contactId: c.id } }),
      }))
    )

    return NextResponse.json({
      contacts: contactsWithEntryCount,
      total,
      page,
      pages: Math.ceil(total / limit),
    })
  } catch (error) {
    console.error('Error fetching contacts:', error)
    return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = ContactSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid contact data', details: parsed.error.format() },
        { status: 400 }
      )
    }

    const { name, email, type, phone, addressStreet, addressCity, addressState, addressZip, addressCountry, addressLine2, taxId, currency, notes } = parsed.data

    const contact = await prisma.contact.create({
      data: {
        name,
        email,
        type,
        phone,
        addressStreet,
        addressCity,
        addressState,
        addressZip,
        addressCountry,
        addressLine2,
        taxId,
        currency,
        notes,
      },
    })

    await prisma.event.create({
      data: {
        eventType: EventType.CONTACT_CREATED,
        entityType: 'Contact',
        entityId: contact.id,
        payload: { name, email, type },
      },
    })

    return NextResponse.json({
      ...contact,
      entryCount: 0,
    }, { status: 201 })
  } catch (error) {
    console.error('Error creating contact:', error)
    return NextResponse.json({ error: 'Failed to create contact' }, { status: 500 })
  }
}