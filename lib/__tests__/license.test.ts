import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma } = vi.hoisted(() => ({
  prisma: { setting: { findUnique: vi.fn(), upsert: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma }))

import { getLicenseStatus, verifyLicenseKey } from '@/lib/license'

describe('license activation', () => {
  beforeEach(() => {
    vi.stubEnv('LICENSE_VERIFY_URL', '')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('rejects empty and unrecognized keys offline', async () => {
    expect(await verifyLicenseKey('')).toBe(false)
    expect(await verifyLicenseKey('not-an-internal-key')).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.skipIf(!process.env.INTERNAL_LICENSE_TEST_KEY)('preserves the existing internal key offline', async () => {
    expect(await verifyLicenseKey(process.env.INTERNAL_LICENSE_TEST_KEY!)).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts paid keys verified for entrytwo', async () => {
    vi.stubEnv('LICENSE_VERIFY_URL', 'https://license.example.test/verify')
    vi.mocked(fetch).mockResolvedValue(Response.json({ valid: true, product: 'entrytwo' }))
    expect(await verifyLicenseKey('et1.test.signature')).toBe(true)
  })

  it('rejects paid keys issued for another product', async () => {
    vi.stubEnv('LICENSE_VERIFY_URL', 'https://license.example.test/verify')
    vi.mocked(fetch).mockResolvedValue(Response.json({ valid: true, product: 'invoices' }))
    expect(await verifyLicenseKey('et1.test.signature')).toBe(false)
  })

  it('requires a valid response even for verifier-approved internal activation', async () => {
    vi.stubEnv('LICENSE_VERIFY_URL', 'https://license.example.test/verify')
    vi.mocked(fetch).mockResolvedValue(Response.json({ valid: false, master: true }))
    expect(await verifyLicenseKey('test-support-key')).toBe(false)
  })

  it('fails closed when the verification service is unavailable', async () => {
    vi.useFakeTimers()
    vi.stubEnv('LICENSE_VERIFY_URL', 'https://license.example.test/verify')
    vi.mocked(fetch).mockRejectedValue(new Error('network unavailable'))
    expect(await verifyLicenseKey('et1.test.signature')).toBe(false)
  })

  it('preserves stored licenses without external reverification', async () => {
    prisma.setting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => ({
      value: { value: where.key === 'license.firstUseAt' ? '2020-01-01T00:00:00.000Z' : 'et1.saved.signature' },
    }))
    const status = await getLicenseStatus()
    expect(status.isLicensed).toBe(true)
    expect(status.acceptedKey).toBe('et1.saved.signature')
    expect(fetch).not.toHaveBeenCalled()
  })
})
