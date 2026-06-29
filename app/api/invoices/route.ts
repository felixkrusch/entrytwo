import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { EventType } from '@prisma/client'

const InvoiceLineSchema = z.object({
  description: z.string(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  taxRateId: z.string().optional().nullable(),
})

const InvoiceSchema = z.object({
  contactId: z.string(),
  status: z.enum(['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED']).default('DRAFT'),
  currency: z.string().length(3).default('EUR'),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lines: z.array(InvoiceLineSchema).min(1),
})

function generateInvoiceNumber(): string {
  const year = new Date().getFullYear()
  const random = Math.floor(1000 + Math.random() * 9000)
  return `INV-${year}-${String(random).padStart(4, '0')}`
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const status = url.searchParams.get('status') || ''
    const contactId = url.searchParams.get('contactId') || ''
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get('limit') || '20')))
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = {}
    if (status && ['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED'].includes(status)) {
      where.status = status
    }
    if (contactId) {
      where.contactId = contactId
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { issueDate: 'desc' },
        include: {
          contact: true,
          lines: { include: { taxRate: true } },
        },
      }),
      prisma.invoice.count({ where }),
    ])

    return NextResponse.json({
      invoices,
      total,
      page,
      pages: Math.ceil(total / limit),
    })
  } catch (error) {
    console.error('Error fetching invoices:', error)
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = InvoiceSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid invoice data', details: parsed.error.format() },
        { status: 400 }
      )
    }

    const { contactId, status, currency, issueDate, dueDate, notes, terms, lines } = parsed.data

    const now = new Date()
    const dueDays = 30
    const finalIssueDate = issueDate ? new Date(issueDate) : now
    const finalDueDate = dueDate ? new Date(dueDate) : new Date(now.getTime() + dueDays * 24 * 60 * 60 * 1000)

    const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
    const taxAmount = 0 // Simplified - would calculate per tax rate

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: generateInvoiceNumber(),
        contactId,
        status,
        currency,
        subtotal,
        taxAmount,
        total: subtotal + taxAmount,
        issueDate: finalIssueDate,
        dueDate: finalDueDate,
        notes,
        terms,
        lines: {
          create: lines.map(line => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxRateId: line.taxRateId,
            lineTotal: line.quantity * line.unitPrice,
          })),
        },
      },
      include: { contact: true, lines: { include: { taxRate: true } } },
    })

    await prisma.event.create({
      data: {
        eventType: EventType.INVOICE_CREATED,
        entityType: 'Invoice',
        entityId: invoice.id,
        payload: { invoiceNumber: invoice.invoiceNumber, contactId },
      },
    })

    return NextResponse.json(invoice, { status: 201 })
  } catch (error) {
    console.error('Error creating invoice:', error)
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 })
  }
}