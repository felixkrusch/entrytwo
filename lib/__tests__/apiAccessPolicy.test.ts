import { describe, expect, it } from 'vitest'
import { getApiAccessPolicy, isPublicApiPath, isRoleAllowed } from '@/lib/apiAccessPolicy'

describe('API access policy', () => {
  it('allows only explicit public, bootstrap, and signed webhook routes without a session', () => {
    expect(isPublicApiPath('/api/health')).toBe(true)
    expect(isPublicApiPath('/api/auth/session')).toBe(true)
    expect(isPublicApiPath('/api/bootstrap/status')).toBe(true)
    expect(isPublicApiPath('/api/onboarding')).toBe(true)
    expect(isPublicApiPath('/api/webhooks/stripe')).toBe(true)
    expect(isPublicApiPath('/api/webhooks/paypal')).toBe(true)
  })

  it('protects financial and configuration routes by default', () => {
    expect(isPublicApiPath('/api/invoices')).toBe(false)
    expect(isPublicApiPath('/api/reports/profit-loss')).toBe(false)
    expect(isPublicApiPath('/api/accounting/restore')).toBe(false)
    expect(getApiAccessPolicy('/api/unknown-future-route').access).toBe('authenticated')
  })

  it('classifies bank feeds and backups as admin-only', () => {
    expect(getApiAccessPolicy('/api/bank-feeds/connections').access).toBe('admin')
    expect(getApiAccessPolicy('/api/backup/export').access).toBe('admin')
  })

  it('distinguishes read access from financial mutations', () => {
    expect(getApiAccessPolicy('/api/invoices', 'GET').access).toBe('authenticated')
    expect(getApiAccessPolicy('/api/invoices', 'POST').access).toBe('accountant')
    expect(getApiAccessPolicy('/api/journal-entries', 'GET').access).toBe('authenticated')
    expect(getApiAccessPolicy('/api/journal-entries', 'POST').access).toBe('accountant')
    expect(getApiAccessPolicy('/api/settings', 'GET').access).toBe('authenticated')
    expect(getApiAccessPolicy('/api/settings', 'POST').access).toBe('admin')
    expect(getApiAccessPolicy('/api/accounts/abc', 'PATCH').access).toBe('admin')
  })

  it('enforces the role hierarchy without granting viewers mutation access', () => {
    expect(isRoleAllowed('admin', 'ADMIN')).toBe(true)
    expect(isRoleAllowed('admin', 'ACCOUNTANT')).toBe(false)
    expect(isRoleAllowed('accountant', 'ADMIN')).toBe(true)
    expect(isRoleAllowed('accountant', 'ACCOUNTANT')).toBe(true)
    expect(isRoleAllowed('accountant', 'VIEWER')).toBe(false)
    expect(isRoleAllowed('authenticated', 'VIEWER')).toBe(true)
  })
})
