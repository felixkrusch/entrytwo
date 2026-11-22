import PDFDocument from 'pdfkit'
import { describe, expect, it, vi } from 'vitest'
import { generateInvoicePDF } from '../pdf/invoice'
import { companyBankRecord, readCompanyBank } from '../companyBank'

const { findSettings } = vi.hoisted(() => ({ findSettings: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  invoice: { findUnique: async () => ({
    invoiceNumber: 'TEST-1', contact: { name: 'Test Customer' }, lines: [],
    currency: 'EUR', status: 'DRAFT', dueDate: new Date('2026-07-15'), subtotal: 30, total: 30,
  }) },
  setting: { findMany: findSettings },
} }))

describe('company bank details', () => {
  it.each(['77712890', '0077712890'])('preserves the exact account number %s through JSON storage', accountNumber => {
    const draft = { ...companyBankRecord({ account: '7712890', iban: 'TEST' }), accountNumber }
    const saved = JSON.parse(JSON.stringify(draft))
    expect(readCompanyBank(saved)).toMatchObject({ accountNumber, iban: 'TEST' })
  })

  it('reads legacy aliases but never revives one after the canonical field is cleared', () => {
    const old = { account: '7712890', transit: '021000021' }
    expect(readCompanyBank({ value: old })).toMatchObject({ accountNumber: old.account, routing: old.transit })
    expect(readCompanyBank({ ...old, accountNumber: '', routing: '' })).toMatchObject({ accountNumber: '', routing: '' })
  })

  it.each(['0077712890', ''])('renders only the saved account number on the PDF (%j)', async accountNumber => {
    findSettings.mockResolvedValue([{ key: 'company.bank', value: { accountNumber, account: '7712890', routing: '000000001' } }])
    const drawText = vi.spyOn(PDFDocument.prototype, 'text')
    try {
      const pdf = await generateInvoicePDF('test-invoice')
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
      expect(drawText.mock.calls.map(([text]) => text).filter(text => typeof text === 'string' && text.startsWith('Account  ')))
        .toEqual(accountNumber ? [`Account  ${accountNumber}`] : [])
    } finally {
      drawText.mockRestore()
    }
  })
})
