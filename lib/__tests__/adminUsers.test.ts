import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/users/route'
import { PATCH } from '@/app/api/users/[id]/route'

const { adminCheck } = vi.hoisted(() => ({ adminCheck: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireUser: adminCheck }))
vi.mock('@/lib/prisma', () => {
  const row = {
    id: 'user', email: 'test@example.test', name: null, role: 'ACCOUNTANT', disabled: false,
    createdAt: new Date('2026-01-01'), totpLastUsedStep: BigInt(42), totpSecret: 'synthetic',
  }
  const project = (select?: Record<string, boolean>) => select
    ? Object.fromEntries(Object.entries(row).filter(([key]) => select[key]))
    : row
  const user = {
    findMany: async ({ select }: { select?: Record<string, boolean> }) => [project(select)],
    findUnique: async () => row,
    update: async ({ select }: { select?: Record<string, boolean> }) => project(select),
  }
  return { prisma: { user, $transaction: async (f: (tx: unknown) => unknown) => f({
    user, $queryRaw: async () => [], event: { create: async () => ({}) },
  }) } }
})

describe('admin users API', () => {
  it('returns a user who has used TOTP without serializing or exposing the TOTP fields', async () => {
    adminCheck.mockResolvedValue({ user: { id: 'admin' } })
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{
      id: 'user', email: 'test@example.test', name: null, role: 'ACCOUNTANT', disabled: false, createdAt: '2026-01-01T00:00:00.000Z',
    }])
    expect(adminCheck).toHaveBeenCalledWith(['ADMIN'])
  })

  it('also returns a JSON-safe profile after an edit', async () => {
    adminCheck.mockResolvedValue({ user: { id: 'admin' } })
    const response = await PATCH(new NextRequest('https://entrytwo.test/api/users/user', {
      method: 'PATCH', body: JSON.stringify({ disabled: true }),
    }), { params: Promise.resolve({ id: 'user' }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 'user' })
  })

  it('still denies the list to non-admin callers', async () => {
    adminCheck.mockResolvedValue(null)
    expect((await GET()).status).toBe(403)
  })
})
