import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
  const body = await request.json()
  const { description } = body

  // AI parsing would happen here - simplified placeholder
  let parsed = {
    contactName: '',
    amount: 0,
    currency: 'EUR',
    daysUntilDue: 30,
    notes: '',
  }

  // Simple extraction logic (would be LLM in production)
  const amountMatch = description.match(/(\$|€|£)(\d+(?:[,.]\d+)?)/)
  if (amountMatch) {
    parsed.amount = parseFloat(amountMatch[2].replace(',', '.'))
    parsed.currency = amountMatch[1] === '$' ? 'USD' : amountMatch[1] === '€' ? 'EUR' : 'GBP'
  }

  // Find contact by name
  const contact = await prisma.contact.findFirst({
    where: { name: { contains: parsed.contactName, mode: 'insensitive' } },
  })

  if (!contact) {
    return NextResponse.json({ error: 'Could not find contact' }, { status: 400 })
  }

  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + parsed.daysUntilDue)

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: `INV-${Date.now()}`,
      contactId: contact.id,
      status: 'DRAFT',
      currency: parsed.currency,
      subtotal: parsed.amount,
      taxAmount: 0,
      total: parsed.amount,
      issueDate: new Date(),
      dueDate,
      notes: parsed.notes,
      lines: {
        create: {
          description,
          quantity: 1,
          unitPrice: parsed.amount,
          lineTotal: parsed.amount,
        },
      },
    },
  })

  return NextResponse.json(invoice)
}
