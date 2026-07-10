import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { recordCommitOnBranch } from '@/lib/accounting/commit'

function advanceDate(date: Date, frequency: string, interval: number): Date {
  const d = new Date(date)
  switch (frequency) {
    case 'WEEKLY': d.setDate(d.getDate() + 7 * interval); break
    case 'MONTHLY': d.setMonth(d.getMonth() + interval); break
    case 'QUARTERLY': d.setMonth(d.getMonth() + 3 * interval); break
    case 'YEARLY': d.setFullYear(d.getFullYear() + interval); break
  }
  return d
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const rec = await prisma.recurringInvoice.findUnique({ where: { id }, include: { contact: true } })
    if (!rec) return NextResponse.json({ error: 'Recurring not found' }, { status: 404 })
    if (rec.status !== 'ACTIVE') return NextResponse.json({ error: 'Schedule is not active' }, { status: 400 })

    const now = new Date()
    if (rec.endDate && rec.nextDueDate > rec.endDate) {
      await prisma.recurringInvoice.update({ where: { id }, data: { status: 'CANCELLED' } })
      return NextResponse.json({ error: 'Schedule ended' }, { status: 400 })
    }

    type RecurringLine = {
      description?: string
      quantity?: number | string
      unitPrice?: number | string
      taxRateId?: string | null
    }
    const tpl = (rec.templateData as { currency?: string; notes?: string; terms?: string; lines?: RecurringLine[] }) || {}
    const currency = (tpl.currency || 'EUR').toUpperCase()
    const lines = Array.isArray(tpl.lines) ? tpl.lines : []

    if (!lines.length) {
      return NextResponse.json({ error: 'No lines in recurring template' }, { status: 400 })
    }

    // Load tax rates for server calc (same as main invoice creation)
    const taxRateIds: string[] = Array.from(
      new Set(
        lines
          .map((l) => l.taxRateId)
          .filter((x): x is string => typeof x === 'string' && x.length > 0)
      )
    )
    const taxRates = taxRateIds.length ? await prisma.taxRate.findMany({ where: { id: { in: taxRateIds } } }) : []
    const rateMap = new Map(taxRates.map(r => [r.id, Number(r.rate)]))

    let subtotal = 0
    let taxAmount = 0
    const enriched = lines.map((l) => {
      const q = Number(l.quantity) || 1
      const p = Number(l.unitPrice) || 0
      const net = q * p
      const rate = l.taxRateId ? rateMap.get(l.taxRateId) || 0 : 0
      const tax = net * rate
      subtotal += net
      taxAmount += tax
      return {
        description: l.description ?? '',
        quantity: q,
        unitPrice: p,
        taxRateId: l.taxRateId || null,
        lineTotal: net,
        taxAmount: tax,
      }
    })
    const total = subtotal + taxAmount

    // Find accounts (same logic as /api/invoices)
    let arAccount = await prisma.account.findFirst({
      where: { OR: [{ code: '1100' }, { name: { contains: 'receivable', mode: 'insensitive' } }] },
    })
    if (!arAccount) arAccount = await prisma.account.findFirst({ where: { type: 'ASSET' } })

    let revenueAccount = await prisma.account.findFirst({
      where: { OR: [{ code: '4000' }, { name: { contains: 'revenue', mode: 'insensitive' } }] },
    })
    if (!revenueAccount) revenueAccount = await prisma.account.findFirst({ where: { type: 'REVENUE' } })

    let taxPayableAccount = await prisma.account.findFirst({
      where: { OR: [{ code: '2100' }, { name: { contains: 'tax', mode: 'insensitive' } }] },
    })
    if (!taxPayableAccount) {
      // Guard against malformed creation (historical bugs produced "codeTYPE" names)
      taxPayableAccount = await prisma.account.create({
        data: { code: '2100', name: 'Tax Payable (Output VAT/Sales Tax)', type: 'LIABILITY' },
      })
    }

    if (!arAccount || !revenueAccount || !taxPayableAccount) {
      return NextResponse.json({ error: 'Required accounts not found' }, { status: 500 })
    }

    // Create Invoice + Journal (identical double-entry as normal creation)
    const invoice = await prisma.$transaction(async (tx) => {
      const invNum = await (async function generate() {
        const year = now.getFullYear()
        const prefix = `INV-${year}-`
        const latest = await tx.invoice.findFirst({
          where: { invoiceNumber: { startsWith: prefix } },
          orderBy: { invoiceNumber: 'desc' },
          select: { invoiceNumber: true },
        })
        let next = 1
        if (latest?.invoiceNumber) {
          const n = parseInt(latest.invoiceNumber.replace(prefix, ''), 10)
          if (!isNaN(n)) next = n + 1
        }
        return `${prefix}${String(next).padStart(4, '0')}`
      })()

      const created = await tx.invoice.create({
        data: {
          invoiceNumber: invNum,
          contactId: rec.contactId,
          status: 'DRAFT',
          currency,
          subtotal,
          taxAmount,
          total,
          issueDate: rec.nextDueDate,
          dueDate: new Date(rec.nextDueDate.getTime() + 30 * 86400000),
          notes: tpl.notes || rec.notes || null,
          terms: tpl.terms || null,
          lines: {
            create: enriched.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              taxRateId: l.taxRateId,
              lineTotal: l.lineTotal,
              taxAmount: l.taxAmount,
            })),
          },
        },
        include: { contact: true, lines: { include: { taxRate: true } } },
      })

      const journalLines: Array<{
        accountId: string
        debit: number
        credit: number
        currency: string
        description: string
        contactId?: string
        taxRateId?: string | null
        taxIsInput?: boolean | null
      }> = [
        { accountId: arAccount!.id, debit: total, credit: 0, currency, contactId: rec.contactId, description: `Invoice ${created.invoiceNumber}` },
        { accountId: revenueAccount!.id, debit: 0, credit: subtotal, currency, description: 'Revenue' },
      ]
      if (taxAmount > 0) {
        journalLines.push({
          accountId: taxPayableAccount!.id,
          debit: 0,
          credit: taxAmount,
          currency,
          description: 'Output tax (VAT/Sales tax)',
          taxRateId: taxRateIds[0] || null,
          taxIsInput: false,
        })
      }

      // Business date (midnight UTC of the invoice issue day)
      const businessDate = new Date(created.issueDate)
      businessDate.setUTCHours(0, 0, 0, 0)

      const je = await tx.journalEntry.create({
        data: {
          date: businessDate,
          description: `Invoice ${created.invoiceNumber} (recurring)`,
          lines: { create: journalLines },
        },
      })

      await tx.invoice.update({
        where: { id: created.id },
        data: { journalEntryId: je.id },
      })

      await tx.event.create({
        data: {
          eventType: 'INVOICE_CREATED',
          entityType: 'Invoice',
          entityId: created.id,
          payload: { invoiceNumber: created.invoiceNumber, recurringId: rec.id, source: 'recurring' },
        },
      })

      // Git Model: ancestry-aware commit on main
      await recordCommitOnBranch(je.id, 'main')

      return created
    })

    // Advance schedule
    const nextDue = advanceDate(rec.nextDueDate, rec.frequency, rec.interval)
    await prisma.recurringInvoice.update({
      where: { id: rec.id },
      data: {
        lastGeneratedAt: now,
        nextDueDate: nextDue,
      },
    })

    // Optional auto-send behavior (still auditable: draft already created)
    if (rec.autoSend) {
      // If email is configured, send PDF (delivery only; do not auto-mark SENT here)
      const hasEmail = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
      if (hasEmail && rec.contact?.email) {
        try {
          await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/invoices/${invoice.id}/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          })
        } catch {}
      }
      // Explicit markSent remains manual only (consistent with UI rule: "Mark Sent" = delivered)
    }

    return NextResponse.json({ invoiceId: invoice.id, nextDueDate: nextDue })
  } catch (e) {
    console.error('Recurring generate error', e)
    return NextResponse.json({ error: 'Failed to generate recurring invoice' }, { status: 500 })
  }
}
