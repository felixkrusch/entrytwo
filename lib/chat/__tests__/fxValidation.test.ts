import { beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { validateJournalIntent } from '../validation'

beforeAll(async () => {
  await prisma.account.createMany({
    data: [
      { code: '5950', name: 'AI', type: 'EXPENSE' },
      { code: '2100', name: 'Credit Cards', type: 'LIABILITY' },
    ],
    skipDuplicates: true,
  })
})

const lines = (source: string) => [
  { accountCode: '5950', debit: 30, credit: 0, currency: 'USD', fxRateToBase: 0.921, fxSource: source, fxDate: '2026-07-05' },
  { accountCode: '2100', debit: 0, credit: 27.63, currency: 'EUR' },
]

describe('receipt provisional FX validation', () => {
  it('accepts an LLM provisional rate supported by two source URLs', async () => {
    const result = await validateJournalIntent({ date: '2026-07-05', lines: lines('LLM_PROVISIONAL:https://source-one.example/rate;https://source-two.example/rate') }, 'main')
    expect(result.ok).toBe(true)
  })

  it('rejects an unsourced LLM rate', async () => {
    const result = await validateJournalIntent({ date: '2026-07-05', lines: lines('LLM_PROVISIONAL') }, 'main')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('two source URLs')
  })

  it('accepts a user-supplied base amount as MANUAL_PROVISIONAL', async () => {
    const result = await validateJournalIntent({ date: '2026-07-05', lines: lines('MANUAL_PROVISIONAL') }, 'main')
    expect(result.ok).toBe(true)
    expect(result.resolvedLines?.[0]).toMatchObject({ currency: 'USD', debit: 30, fxRateToBase: 0.921 })
  })
})
