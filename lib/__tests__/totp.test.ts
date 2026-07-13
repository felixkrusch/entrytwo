import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decodeBase32, encodeBase32, generateRecoveryCodes, generateTotp, hashRecoveryCode, verifyTotp } from '@/lib/totp'
import { createTotpSessionProof, verifyTotpSessionProof } from '@/lib/totpSession'

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const originalAuthSecret = process.env.AUTH_SECRET

describe('RFC 6238 TOTP', () => {
  it('encodes and decodes base32 secrets', () => {
    const input = Buffer.from('12345678901234567890')
    expect(encodeBase32(input)).toBe(RFC_SECRET)
    expect(decodeBase32(RFC_SECRET)).toEqual(input)
  })

  it.each([
    [59_000, '94287082'],
    [1_111_111_109_000, '07081804'],
    [1_111_111_111_000, '14050471'],
    [1_234_567_890_000, '89005924'],
    [2_000_000_000_000, '69279037'],
  ])('matches the RFC vector at %i ms', (timestamp, expected) => {
    expect(generateTotp(RFC_SECRET, timestamp, 8)).toBe(expected)
  })

  it('accepts a current six-digit code and rejects invalid input', () => {
    const timestamp = 1_700_000_000_000
    const token = generateTotp(RFC_SECRET, timestamp)
    expect(verifyTotp(RFC_SECRET, token, timestamp)).toBe(BigInt(Math.floor(timestamp / 30_000)))
    expect(verifyTotp(RFC_SECRET, '00000x', timestamp)).toBeNull()
  })
})

describe('TOTP recovery and session proofs', () => {
  beforeEach(() => { process.env.AUTH_SECRET = 'test-auth-secret-with-sufficient-entropy' })
  afterEach(() => { process.env.AUTH_SECRET = originalAuthSecret })

  it('generates unique formatted recovery codes and stable hashes', () => {
    const codes = generateRecoveryCodes()
    expect(new Set(codes).size).toBe(10)
    expect(codes.every(code => /^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/.test(code))).toBe(true)
    expect(hashRecoveryCode(codes[0], 'user-1')).toBe(hashRecoveryCode(codes[0].toLowerCase(), 'user-1'))
  })

  it('binds verification to the user, login session, and expiry', () => {
    const proof = createTotpSessionProof('user-1', 'session-1', 1_000_000)
    expect(verifyTotpSessionProof(proof.value, 'user-1', 'session-1', 1_000_000)).toBe(true)
    expect(verifyTotpSessionProof(proof.value, 'user-1', 'session-2', 1_000_000)).toBe(false)
    expect(verifyTotpSessionProof(proof.value, 'user-2', 'session-1', 1_000_000)).toBe(false)
    expect(verifyTotpSessionProof(proof.value, 'user-1', 'session-1', 1_000_000 + 13 * 60 * 60 * 1000)).toBe(false)
  })
})
