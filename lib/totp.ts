import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const TOTP_PERIOD_SECONDS = 30

export function encodeBase32(input: Buffer) {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of input) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

export function decodeBase32(input: string) {
  const normalized = input.toUpperCase().replace(/=|\s|-/g, '')
  let bits = 0
  let value = 0
  const output: number[] = []
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character)
    if (index < 0) throw new Error('Invalid base32 secret')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(output)
}

export function generateTotpSecret() {
  return encodeBase32(randomBytes(20))
}

export function generateTotp(secret: string, timestamp = Date.now(), digits = 6) {
  const counter = Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest()
  const offset = digest[digest.length - 1] & 15
  const binary = ((digest[offset] & 127) << 24)
    | ((digest[offset + 1] & 255) << 16)
    | ((digest[offset + 2] & 255) << 8)
    | (digest[offset + 3] & 255)
  return String(binary % (10 ** digits)).padStart(digits, '0')
}

export function verifyTotp(secret: string, token: string, timestamp = Date.now(), window = 1) {
  if (!/^\d{6}$/.test(token)) return null
  const currentCounter = Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS)
  const submitted = Buffer.from(token)
  for (let offset = -window; offset <= window; offset++) {
    const expected = Buffer.from(generateTotp(secret, (currentCounter + offset) * TOTP_PERIOD_SECONDS * 1000))
    if (expected.length === submitted.length && timingSafeEqual(expected, submitted)) return BigInt(currentCounter + offset)
  }
  return null
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const value = randomBytes(8).toString('hex').toUpperCase()
    return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}`
  })
}

export function normalizeRecoveryCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function hashRecoveryCode(code: string, userId: string) {
  const pepper = process.env.AUTH_SECRET
  if (!pepper) throw new Error('AUTH_SECRET is required to protect recovery codes')
  return scryptSync(`${normalizeRecoveryCode(code)}:${pepper}`, userId, 32).toString('hex')
}
