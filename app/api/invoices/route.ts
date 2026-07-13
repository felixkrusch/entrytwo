import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { requireUser } from '@/lib/authz'
import { getCompanyProfile } from '@/lib/companyProfile'
import { commitJournalInTransaction } from '@/lib/accounting/atomicCommit'

const InvoiceLineSchema = z.object({
  description: z.string(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  taxRateId: z.string().optional().nullable(),
})

const InvoiceSchema = z.object({
  contactId: z.string(),
  status: z.enum(['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED']).default('SENT'),
  currency: z.string().length(3).default('EUR'),
  language: z.enum(['en', 'de']).default('en'),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lines: z.array(InvoiceLineSchema).min(1),
})

async function generateInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `INV-${year}-`
  await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_advisory_xact_lock(hashtext(${`invoice-number:${year}`})) IS NULL AS locked`

  // Find the highest existing number for this year and increment
  const latest = await tx.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true },
  })

  let next = 1
  if (latest?.invoiceNumber) {
    const numPart = latest.invoiceNumber.replace(prefix, '')
    const parsed = parseInt(numPart, 10)
    if (!isNaN(parsed)) next = parsed + 1
  }

  return `${prefix}${String(next).padStart(4, '0')}`
}

export async function GET(request: Request) {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
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
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' }
        ],
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
  const session = await requireUser(['ADMIN', 'ACCOUNTANT'])
  if (!session) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    const body = await request.json()
    const parsed = InvoiceSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid invoice data', details: parsed.error.format() },
        { status: 400 }
      )
    }

    const { contactId, status, currency: invCurrency, issueDate, dueDate, notes, terms, lines } = parsed.data
    const currency = (invCurrency || 'EUR').toUpperCase()

    const now = new Date()
    const dueDays = 30
    const finalIssueDate = issueDate ? new Date(issueDate) : now
    const finalDueDate = dueDate ? new Date(dueDate) : new Date(now.getTime() + dueDays * 24 * 60 * 60 * 1000)

    // Load tax rates for the provided ids
    const taxRateIds = Array.from(new Set(lines.map(l => l.taxRateId).filter((id): id is string => !!id)))
    const taxRates = taxRateIds.length
      ? await prisma.taxRate.findMany({ where: { id: { in: taxRateIds } } })
      : []
    const rateMap = new Map(taxRates.map(r => [r.id, Number(r.rate)]))

    // Server-side tax calculation (source of truth)
    let subtotal = 0
    let taxAmount = 0
    const enrichedLines = lines.map(line => {
      const net = line.quantity * line.unitPrice
      const rate = line.taxRateId ? rateMap.get(line.taxRateId) || 0 : 0
      const tax = net * rate
      subtotal += net
      taxAmount += tax
      return {
        ...line,
        lineTotal: net,
        taxAmount: tax,
      }
    })
    const total = subtotal + taxAmount

    // Find AR and Revenue accounts (robust fallbacks)
    let arAccount = await prisma.account.findFirst({
      where: {
        OR: [
          { code: '1100' },
          { name: { contains: 'receivable', mode: 'insensitive' } },
          { name: { contains: 'AR', mode: 'insensitive' } },
        ],
      },
    })
    if (!arAccount) {
      arAccount = await prisma.account.findFirst({ where: { type: 'ASSET' } })
    }

    let revenueAccount = await prisma.account.findFirst({
      where: {
        OR: [
          { code: '4000' },
          { name: { contains: 'revenue', mode: 'insensitive' } },
          { name: { contains: 'sales', mode: 'insensitive' } },
        ],
      },
    })
    if (!revenueAccount) {
      revenueAccount = await prisma.account.findFirst({ where: { type: 'REVENUE' } })
    }

    // Tax payable (output tax liability) – create if missing so double-entry is correct
    let taxPayableAccount = await prisma.account.findFirst({
      where: {
        OR: [
          { code: '2100' },
          { name: { contains: 'tax', mode: 'insensitive' } },
          { name: { contains: 'vat', mode: 'insensitive' } },
          { name: { contains: 'payable', mode: 'insensitive' } },
        ],
      },
    })
    if (!taxPayableAccount) {
      // Guard against malformed creation (historical bugs produced "codeTYPE" names)
      taxPayableAccount = await prisma.account.create({
        data: { code: '2100', name: 'Tax Payable (Output VAT/Sales Tax)', type: 'LIABILITY' },
      })
    }

    if (!arAccount || !revenueAccount || !taxPayableAccount) {
      return NextResponse.json({ error: 'Required accounts (AR / Revenue / Tax Payable) not found.' }, { status: 500 })
    }
    const baseCurrency = (await getCompanyProfile()).baseCurrency.toUpperCase()

    // Create Invoice + JournalEntry atomically
    const invoice = await prisma.$transaction(async (tx) => {
      const createdInvoice = await tx.invoice.create({
        data: {
          invoiceNumber: await generateInvoiceNumber(tx),
          contactId,
          status,
          currency,
          language: parsed.data.language || 'en',
          subtotal,
          taxAmount,
          total,
          issueDate: finalIssueDate,
          dueDate: finalDueDate,
          notes,
          terms,
          lines: {
            create: enrichedLines.map(line => ({
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              taxRateId: line.taxRateId || null,
              lineTotal: line.lineTotal,
              taxAmount: line.taxAmount,
            })),
          },
        },
        include: { contact: true, lines: { include: { taxRate: true } } },
      })

      // Build journal lines for proper double-entry (revenue recognition)
      const journalLineData: Array<{
        accountId: string
        debit: number
        credit: number
        currency: string
        contactId?: string
        description?: string
        taxRateId?: string | null
        taxIsInput?: boolean
      }> = [
        {
          accountId: arAccount!.id,
          debit: total,
          credit: 0,
          currency,
          contactId,
          description: `Invoice ${createdInvoice.invoiceNumber}`,
        },
        {
          accountId: revenueAccount!.id,
          debit: 0,
          credit: subtotal,
          currency,
          description: 'Revenue',
        },
      ]

      if (taxAmount > 0) {
        // Credit output tax liability account (not revenue). This is critical for correct double-entry.
        const primaryTaxRateId = taxRateIds[0] || null
        journalLineData.push({
          accountId: taxPayableAccount!.id,
          debit: 0,
          credit: taxAmount,
          currency,
          description: 'Output tax (VAT/Sales tax)',
          taxRateId: primaryTaxRateId,
          taxIsInput: false,
        })
      }

      const journalEntry = await commitJournalInTransaction(tx, {
        date: finalIssueDate,
        description: `Invoice ${createdInvoice.invoiceNumber}`,
        branch: 'main',
        baseCurrency,
        createdBy: session.user.id,
        idempotencyKey: `invoice-posting:${createdInvoice.id}`,
        eventPayload: { invoiceId: createdInvoice.id, invoiceNumber: createdInvoice.invoiceNumber },
        lines: journalLineData.map(line => ({
          ...line,
          fxRateToBase: currency === baseCurrency ? 1 : null,
          fxSource: currency === baseCurrency ? 'BASE_CURRENCY' : null,
          fxDate: finalIssueDate,
        })),
      })

      // Link the journal entry back to the invoice for traceability
      const updatedInvoice = await tx.invoice.update({
        where: { id: createdInvoice.id },
        data: { journalEntryId: journalEntry.id },
        include: { contact: true, lines: { include: { taxRate: true } } },
      })

      await tx.event.create({
        data: {
          eventType: 'INVOICE_CREATED',
          entityType: 'Invoice',
          entityId: updatedInvoice.id,
          payload: {
            invoiceNumber: updatedInvoice.invoiceNumber,
            contactId,
            journalEntryId: journalEntry.id,
            total: Number(total),
          },
        },
      })

      return updatedInvoice
    })

    return NextResponse.json(invoice, { status: 201 })
  } catch (error) {
    console.error('Error creating invoice:', error)
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 })
  }
}
