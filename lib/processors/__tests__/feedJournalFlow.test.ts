import { describe, it, expect } from 'vitest'
import { upsertFeedTransaction } from '@/lib/processors/normalize'
import { prisma } from '@/lib/prisma'

describe('Stripe/PayPal feed + journal flow (integration)', () => {
  it('upserts FeedTransaction idempotently for processor events', async () => {
    // Create a minimal bank connection for testing
    const conn = await prisma.bankConnection.create({
      data: {
        accountId: (await prisma.account.findFirst())!.id,
        provider: 'stripe',
        externalId: 'test-conn-' + Date.now(),
      },
    })

    const tx1 = {
      externalId: 'evt_test_1',
      date: new Date(),
      description: 'Test charge',
      amount: 42.5,
      currency: 'USD',
      type: 'charge' as const,
      direction: 'in' as const,
      raw: { test: true },
    }

    const r1 = await upsertFeedTransaction(conn.id, tx1 as any)
    expect(r1.created).toBe(true)

    const r2 = await upsertFeedTransaction(conn.id, tx1 as any)
    expect(r2.created).toBe(false)

    // cleanup
    await prisma.feedTransaction.deleteMany({ where: { connectionId: conn.id } })
    await prisma.bankConnection.delete({ where: { id: conn.id } })
  })
})
