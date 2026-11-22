import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { getApiAccessPolicy } from '@/lib/apiAccessPolicy'
import { isMalformedAccount } from '@/lib/chartOfAccounts'

const root = process.cwd()

describe('chart of accounts creation', () => {
  it('keeps account creation admin-only on POST while GET stays authenticated', () => {
    expect(getApiAccessPolicy('/api/accounts', 'POST').access).toBe('admin')
    expect(getApiAccessPolicy('/api/accounts', 'GET').access).toBe('authenticated')
    expect(getApiAccessPolicy('/api/accounts/abc', 'PATCH').access).toBe('admin')
    expect(getApiAccessPolicy('/api/accounts/abc', 'DELETE').access).toBe('admin')
  })

  it('keeps the POST handler behind requireUser ADMIN', () => {
    const source = readFileSync(join(root, 'app/api/accounts/route.ts'), 'utf8')
    expect(source).toMatch(/export async function POST/)
    expect(source).toContain("requireUser(['ADMIN'])")
  })

  it('gates the chart admin page to ADMIN', () => {
    const proxy = readFileSync(join(root, 'proxy.ts'), 'utf8')
    expect(proxy).toContain("pathname.startsWith('/admin') && request.auth.user.role !== 'ADMIN'")
    expect(readFileSync(join(root, 'app/admin/chart-of-accounts/page.tsx'), 'utf8')).toContain('allowCreate')
  })

  it('posts new accounts from the admin chart UI only', () => {
    const panel = readFileSync(join(root, 'app/app/AccountsPanel.tsx'), 'utf8')
    expect(panel).toContain("fetch('/api/accounts'")
    expect(panel).toContain("method: 'POST'")
    expect(panel).toContain('allowCreate')
    expect(readFileSync(join(root, 'app/app/layout.tsx'), 'utf8')).not.toMatch(/<AccountsPanel[^>]*allowCreate/)
  })

  it('rejects the historical code+type corruption pattern', () => {
    expect(isMalformedAccount('1010ASSET', 'Bank', 'ASSET')).toBe(true)
    expect(isMalformedAccount('1010', '1010ASSET', 'ASSET')).toBe(true)
    expect(isMalformedAccount('1010', '1010', 'ASSET')).toBe(true)
    expect(isMalformedAccount('1010', 'ASSET1010', 'ASSET')).toBe(true)
    expect(isMalformedAccount('1010', 'Bank Account - Checking', 'ASSET')).toBe(false)
    expect(isMalformedAccount('6100', 'Software', 'EXPENSE')).toBe(false)
  })
})
