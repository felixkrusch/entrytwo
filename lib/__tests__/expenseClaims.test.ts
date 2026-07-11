import { describe, expect, it } from 'vitest'
import { canApproveClaim, canEditClaim, canViewClaim, claimInputSchema } from '@/lib/expenseClaims'

describe('expense claim permissions', () => {
  it('allows an admin to self-approve', () => {
    expect(canApproveClaim({ id: 'admin', role: 'ADMIN' }, 'admin')).toBe(true)
  })

  it('blocks an accountant from self-approving', () => {
    expect(canApproveClaim({ id: 'accountant', role: 'ACCOUNTANT' }, 'accountant')).toBe(false)
  })

  it('allows an accountant to approve another claimant', () => {
    expect(canApproveClaim({ id: 'accountant', role: 'ACCOUNTANT' }, 'claimant')).toBe(true)
  })

  it('keeps viewers scoped to their own claims', () => {
    expect(canViewClaim({ id: 'viewer', role: 'VIEWER' }, 'viewer')).toBe(true)
    expect(canViewClaim({ id: 'viewer', role: 'VIEWER' }, 'someone-else')).toBe(false)
    expect(canEditClaim({ id: 'viewer', role: 'VIEWER' }, 'viewer')).toBe(true)
  })
})

describe('expense claim input', () => {
  it('normalizes currencies and defaults personal payment', () => {
    const parsed = claimInputSchema.parse({
      claimantUserId: 'c46a7c3f-63a0-4ab7-ad93-3b43553d34f2',
      title: 'Client trip',
      lines: [{
        expenseDate: '2026-07-11',
        description: 'Train',
        accountId: '112f6d2e-b706-48cd-bfca-f1005d1e54c0',
        grossAmount: 45,
        currency: 'eur',
      }],
    })
    expect(parsed.lines[0].currency).toBe('EUR')
    expect(parsed.lines[0].paymentMethod).toBe('PERSONAL_FUNDS')
  })
})
