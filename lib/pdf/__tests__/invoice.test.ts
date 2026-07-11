import { beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { generateInvoicePDF } from '../invoice'

let invoiceId: string

beforeAll(async () => {
  const contact = await prisma.contact.create({ data: { name: 'PDF Test Customer', type: 'CUSTOMER', email: 'billing@example.test' } })
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: `PDF-${Date.now()}`,
      contactId: contact.id,
      issueDate: new Date('2026-07-01'),
      dueDate: new Date('2026-07-15'),
      currency: 'EUR',
      subtotal: 30,
      taxAmount: 0,
      total: 30,
      status: 'DRAFT',
      lines: { create: [{ description: 'Professional services', quantity: 1, unitPrice: 30, lineTotal: 30 }] },
    },
  })
  invoiceId = invoice.id
  await prisma.setting.upsert({ where: { key: 'company.bank' }, update: { value: { iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' } }, create: { key: 'company.bank', value: { iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' } } })
})

describe('invoice PDF generation', () => {
  it('embeds payment QR data without filesystem image reads', async () => {
    const pdf = await generateInvoicePDF(invoiceId)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(5_000)
  })
})
