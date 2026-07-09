import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const InvoiceLineSchema = z.object({
  description: z.string(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  taxRateId: z.string().optional().nullable(),
})

const InvoiceUpdateSchema = z.object({
  status: z.enum(['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
  paidDate: z.string().datetime().optional().nullable(),
  contactId: z.string().optional(),
  currency: z.string().length(3).optional(),
  language: z.enum(['en', 'de']).optional(),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  lines: z.array(InvoiceLineSchema).optional(),
})

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        contact: true,
        lines: { include: { taxRate: true } },
        journalEntry: {
          include: {
            lines: {
              include: { account: { select: { code: true, name: true } } },
            },
          },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    return NextResponse.json(invoice)
  } catch (error) {
    console.error('Error fetching invoice:', error)
    return NextResponse.json({ error: 'Failed to fetch invoice' }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const parsed = InvoiceUpdateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid invoice data', details: parsed.error.format() },
      { status: 400 }
    )
  }

  try {
    const data = parsed.data

    // Simple status/paidDate update path (no lines)
    if (!data.lines) {
      const updateData: Record<string, unknown> = {}
      if (data.status) updateData.status = data.status
      if (data.paidDate !== undefined) updateData.paidDate = data.paidDate ? new Date(data.paidDate) : null

      const invoice = await prisma.invoice.update({
        where: { id },
        data: updateData,
      })
      return NextResponse.json(invoice)
    }

    // Full edit path (only allowed for DRAFT invoices)
    const existing = await prisma.invoice.findUnique({ where: { id }, include: { lines: true } })
    if (!existing) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }
    if (existing.status !== 'DRAFT') {
      return NextResponse.json({ error: 'Only DRAFT invoices can be edited. Cancel and create a new one for changes.' }, { status: 400 })
    }

    // Recompute totals from new lines (server truth)
    const taxRateIds = Array.from(new Set(data.lines.map(l => l.taxRateId).filter((x): x is string => !!x)))
    const taxRates = taxRateIds.length ? await prisma.taxRate.findMany({ where: { id: { in: taxRateIds } } }) : []
    const rateMap = new Map(taxRates.map(r => [r.id, Number(r.rate)]))

    let subtotal = 0
    let taxAmount = 0
    const enriched = data.lines.map(l => {
      const net = l.quantity * l.unitPrice
      const rate = l.taxRateId ? rateMap.get(l.taxRateId) || 0 : 0
      const tax = net * rate
      subtotal += net
      taxAmount += tax
      return { ...l, lineTotal: net, taxAmount: tax }
    })
    const total = subtotal + taxAmount

    const updated = await prisma.$transaction(async (tx) => {
      // Replace lines
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } })

      const inv = await tx.invoice.update({
        where: { id },
        data: {
          contactId: data.contactId || existing.contactId,
          currency: data.currency || existing.currency,
          language: data.language || existing.language || 'en',
          issueDate: data.issueDate ? new Date(data.issueDate) : existing.issueDate,
          dueDate: data.dueDate ? new Date(data.dueDate) : existing.dueDate,
          notes: data.notes !== undefined ? data.notes : existing.notes,
          terms: data.terms !== undefined ? data.terms : existing.terms,
          subtotal,
          taxAmount,
          total,
          status: data.status || existing.status,
          paidDate: data.paidDate !== undefined ? (data.paidDate ? new Date(data.paidDate) : null) : existing.paidDate,
          lines: {
            create: enriched.map(l => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              taxRateId: l.taxRateId || null,
              lineTotal: l.lineTotal,
              taxAmount: l.taxAmount,
            })),
          },
        },
        include: { contact: true, lines: { include: { taxRate: true } } },
      })

      // Update linked journal if present (recreate lines for accuracy on DRAFT edit)
      if (inv.journalEntryId) {
        await tx.journalLine.deleteMany({ where: { journalEntryId: inv.journalEntryId } })

        // Find accounts again
        const ar = await tx.account.findFirst({ where: { OR: [{ code: '1100' }, { name: { contains: 'receivable', mode: 'insensitive' } }] } })
        const rev = await tx.account.findFirst({ where: { OR: [{ code: '4000' }, { name: { contains: 'revenue', mode: 'insensitive' } }] } })
        const taxPay = await tx.account.findFirst({ where: { OR: [{ code: '2100' }, { name: { contains: 'tax', mode: 'insensitive' } }] } })

        const jlines: Array<{ journalEntryId: string; accountId: string; debit: number; credit: number; currency: string; contactId?: string; description?: string; taxRateId?: string | null; taxIsInput?: boolean }> = []
        if (ar) jlines.push({ journalEntryId: inv.journalEntryId, accountId: ar.id, debit: total, credit: 0, currency: inv.currency, contactId: inv.contactId, description: `Invoice ${inv.invoiceNumber}` })
        if (rev) jlines.push({ journalEntryId: inv.journalEntryId, accountId: rev.id, debit: 0, credit: subtotal, currency: inv.currency, description: 'Revenue' })
        if (taxAmount > 0 && taxPay) jlines.push({ journalEntryId: inv.journalEntryId, accountId: taxPay.id, debit: 0, credit: taxAmount, currency: inv.currency, description: 'Output tax', taxRateId: taxRateIds[0] || null, taxIsInput: false })

        await tx.journalLine.createMany({ data: jlines })
      }

      return inv
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Error updating invoice:', error)
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const inv = await prisma.invoice.findUnique({
      where: { id },
      include: { journalEntry: true },
    })
    if (!inv) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Only allow hard delete for pure DRAFTs that were never sent
    if (inv.status !== 'DRAFT') {
      return NextResponse.json({ error: 'Only DRAFT invoices can be permanently deleted. Use Cancel for others.' }, { status: 400 })
    }

    await prisma.$transaction(async (tx) => {
      // Delete journal lines + journal if present
      if (inv.journalEntryId) {
        await tx.journalLine.deleteMany({ where: { journalEntryId: inv.journalEntryId } })
        await tx.journalEntry.delete({ where: { id: inv.journalEntryId } })
      }
      // Delete lines + invoice
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } })
      await tx.invoice.delete({ where: { id } })
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting invoice:', error)
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 })
  }
}
