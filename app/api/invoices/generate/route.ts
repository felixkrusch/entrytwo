import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
  const body = await request.json()
  const { description } = body

  // Simple extraction logic (would be LLM in production)
  const amountMatch = description.match(/(\$|€|£)(\d+(?:[,.]\d+)?)/)
  if (!amountMatch) {
    return NextResponse.json({ error: 'Could not parse amount from description' }, { status: 400 })
  }

  const amount = parseFloat(amountMatch[2].replace(',', '.'))
  const currency = amountMatch[1] === '$' ? 'USD' : amountMatch[1] === '€' ? 'EUR' : 'GBP'

  // Find contact by name (placeholder - would extract name in production)
  const contact = await prisma.contact.findFirst({
    where: { type: 'CUSTOMER' },
  })

  if (!contact) {
    return NextResponse.json({ error: 'No customer found' }, { status: 400 })
  }

  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 30)

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: `INV-${Date.now()}`,
      contactId: contact.id,
      status: 'DRAFT',
      currency,
      subtotal: amount,
      taxAmount: 0,
      total: amount,
      issueDate: new Date(),
      dueDate,
      notes: description,
      lines: {
        create: {
          description,
          quantity: 1,
          unitPrice: amount,
          lineTotal: amount,
        },
      },
    },
  })

  return NextResponse.json(invoice)
}
