import { describe, expect, it } from 'vitest'
import { normalizeEmail, oauthEmailIsAcceptable } from '@/lib/authAccess'

describe('authAccess', () => {
  it('normalizes emails', () => {
    expect(normalizeEmail('  FK@FelixKrusch.COM ')).toBe('fk@felixkrusch.com')
  })

  it('requires email on oauth profiles', () => {
    expect(oauthEmailIsAcceptable('google', {}, null).ok).toBe(false)
  })

  it('rejects google unverified email', () => {
    const result = oauthEmailIsAcceptable(
      'google',
      { email: 'a@b.com', email_verified: false },
      'a@b.com',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('EMAIL_NOT_VERIFIED')
  })

  it('accepts google verified email', () => {
    const result = oauthEmailIsAcceptable(
      'google',
      { email: 'A@B.com', email_verified: true },
      null,
    )
    expect(result).toEqual({ ok: true, email: 'a@b.com' })
  })

  it('accepts microsoft email when verified flag absent', () => {
    const result = oauthEmailIsAcceptable(
      'microsoft-entra-id',
      { preferred_username: 'user@contoso.com' },
      null,
    )
    expect(result).toEqual({ ok: true, email: 'user@contoso.com' })
  })
})
