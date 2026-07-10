import { describe, expect, it } from 'vitest'
import { CreateJournalBatchParams, isSafeAutonomous } from '../intent'

describe('statement journal batches', () => {
  it('accepts one balanced journal payload per statement transaction', () => {
    const parsed = CreateJournalBatchParams.safeParse({
      sourcePdfPath: '/uploads/receipts/statement.pdf',
      entries: [
        {
          date: '2026-07-01',
          description: 'Merchant purchase',
          lines: [
            { accountCode: '5200', debit: 10, credit: 0, currency: 'EUR' },
            { accountCode: '2100', debit: 0, credit: 10, currency: 'EUR' },
          ],
        },
        {
          date: '2026-07-02',
          description: 'Card fee',
          lines: [
            { accountCode: '6990', debit: 2, credit: 0, currency: 'EUR' },
            { accountCode: '2100', debit: 0, credit: 2, currency: 'EUR' },
          ],
        },
      ],
    })

    expect(parsed.success).toBe(true)
    expect(isSafeAutonomous('CREATE_JOURNAL_BATCH')).toBe(true)
  })

  it('rejects an empty statement batch', () => {
    expect(CreateJournalBatchParams.safeParse({ entries: [] }).success).toBe(false)
  })
})
